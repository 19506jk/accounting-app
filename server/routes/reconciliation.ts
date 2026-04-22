import type { NextFunction, Request, Response } from 'express';
import type { Knex } from 'knex';
import express = require('express');
import Decimal from 'decimal.js';

import type {
  ApiErrorResponse,
  CloseReconciliationResponse,
  CreateReconciliationInput,
  CreateReconciliationResponse,
  MessageResponse,
  ReconciliationDetail,
  ReconciliationItem,
  ReconciliationItemToggleResponse,
  ReconciliationReportResponse,
  ReconciliationResponse,
  ReconciliationsResponse,
  ReconciliationStatus,
  ReconciliationSummary,
  ReconciliationSummaryCounts,
  UpdateReconciliationInput,
} from '@shared/contracts';
import type {
  AccountRow,
  RecItemRow,
  ReconciliationDetailRow,
  ReconciliationItemRow,
  ReconciliationRow,
  ReconciliationSummaryRow,
} from '../types/db';
import { addDaysDateOnly, compareDateOnly, isValidDateOnly, normalizeDateOnly } from '../utils/date.js';
import { buildReconciliationReport } from '../services/reports.js';
import { reconciliationReopenPreflight } from '../services/bankTransactions/preflight.js';

const db = require('../db');
const auth = require('../middleware/auth.js');
const requireRole = require('../middleware/roles.js');

const router = express.Router();
router.use(auth);

const dec = (v: Decimal.Value) => new Decimal(v ?? 0);

async function calcBalance(
  reconciliationId: number | string,
  openingBalance: string | number,
  accountType: string
): Promise<Decimal> {
  const result = await db('rec_items as ri')
    .join('journal_entries as je', 'je.id', 'ri.journal_entry_id')
    .join('transactions as t', 't.id', 'je.transaction_id')
    .where('ri.reconciliation_id', reconciliationId)
    .where('ri.is_cleared', true)
    .where('t.is_voided', false)
    .select(
      db.raw('COALESCE(SUM(je.debit),  0) AS total_debits'),
      db.raw('COALESCE(SUM(je.credit), 0) AS total_credits')
    )
    .first() as { total_debits: string | number; total_credits: string | number } | undefined;

  const debits = dec(result?.total_debits ?? 0);
  const credits = dec(result?.total_credits ?? 0);
  const opening = dec(openingBalance);

  if (accountType === 'ASSET') {
    return opening.plus(debits).minus(credits);
  }

  return opening.minus(debits).plus(credits);
}

async function calcSummary(reconciliationId: number | string): Promise<ReconciliationSummaryCounts> {
  const stats = await db('rec_items as ri')
    .join('journal_entries as je', 'je.id', 'ri.journal_entry_id')
    .join('transactions as t', 't.id', 'je.transaction_id')
    .where('ri.reconciliation_id', reconciliationId)
    .where('t.is_voided', false)
    .select(
      db.raw('COUNT(*) as total_items'),
      db.raw('COUNT(*) FILTER (WHERE ri.is_cleared = true) as cleared_items'),
      db.raw('COALESCE(SUM(je.debit)  FILTER (WHERE ri.is_cleared = true), 0) as cleared_debits'),
      db.raw('COALESCE(SUM(je.credit) FILTER (WHERE ri.is_cleared = true), 0) as cleared_credits')
    )
    .first() as {
      total_items: string;
      cleared_items: string;
      cleared_debits: string | number;
      cleared_credits: string | number;
    };

  return {
    total_items: parseInt(stats.total_items, 10),
    cleared_items: parseInt(stats.cleared_items, 10),
    uncleared_items: parseInt(stats.total_items, 10) - parseInt(stats.cleared_items, 10),
    cleared_debits: parseFloat(dec(stats.cleared_debits).toFixed(2)),
    cleared_credits: parseFloat(dec(stats.cleared_credits).toFixed(2)),
  };
}

async function loadItems(
  trx: Knex.Transaction | null,
  reconciliationId: number,
  accountId: number,
  statementDate: string
): Promise<number> {
  const queryDb = trx ?? db;
  const entries = await queryDb('journal_entries as je')
    .join('transactions as t', 't.id', 'je.transaction_id')
    .leftJoin('rec_items as ri', (join: Knex.JoinClause) => {
      join.on('ri.journal_entry_id', '=', 'je.id')
        .andOn('ri.reconciliation_id', '=', db.raw('?', [reconciliationId]));
    })
    .where('je.account_id', accountId)
    .where('je.is_reconciled', false)
    .where('t.date', '<=', statementDate)
    .where('t.is_voided', false)
    .whereNull('ri.id')
    .select('je.id') as Array<{ id: number }>;

  if (entries.length === 0) return 0;

  await queryDb('rec_items').insert(
    entries.map((e) => ({
      reconciliation_id: reconciliationId,
      journal_entry_id: e.id,
      is_cleared: false,
      created_at: queryDb.fn.now(),
      updated_at: queryDb.fn.now(),
    }))
  );

  return entries.length;
}

router.get(
  '/',
  async (_req: Request, res: Response<ReconciliationsResponse>, next: NextFunction) => {
    try {
      const reconciliations = await db('reconciliations as r')
        .join('accounts as a', 'a.id', 'r.account_id')
        .leftJoin('users as u', 'u.id', 'r.created_by')
        .select(
          'r.id',
          'r.account_id',
          'a.name  as account_name',
          'a.code  as account_code',
          'r.statement_date',
          'r.statement_balance',
          'r.opening_balance',
          'r.is_closed',
          'r.created_at',
          'u.name  as created_by_name'
        )
        .orderBy('r.statement_date', 'desc') as ReconciliationSummaryRow[];

      res.json({ reconciliations: reconciliations as ReconciliationSummary[] });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id',
  async (
    req: Request<{ id: string }>,
    res: Response<ReconciliationResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;

      const recon = await db('reconciliations as r')
        .join('accounts as a', 'a.id', 'r.account_id')
        .where('r.id', id)
        .select(
          'r.id',
          'r.account_id',
          'a.name  as account_name',
          'a.code  as account_code',
          'a.type  as account_type',
          'r.statement_date',
          'r.statement_balance',
          'r.opening_balance',
          'r.is_closed',
          'r.created_at'
        )
        .first() as ReconciliationDetailRow | undefined;

      if (!recon) return res.status(404).json({ error: 'Reconciliation not found' });

      const items = await db('rec_items as ri')
        .join('journal_entries as je', 'je.id', 'ri.journal_entry_id')
        .join('transactions as t', 't.id', 'je.transaction_id')
        .join('funds as f', 'f.id', 'je.fund_id')
        .where('ri.reconciliation_id', id)
        .where('t.is_voided', false)
        .select(
          'ri.id',
          'ri.journal_entry_id',
          'ri.is_cleared',
          't.date',
          't.description',
          't.reference_no',
          'f.name  as fund_name',
          'je.debit',
          'je.credit'
        )
        .orderBy('t.date', 'asc') as ReconciliationItemRow[];

      const clearedBalance = await calcBalance(id, recon.opening_balance, recon.account_type);
      const difference = dec(recon.statement_balance).minus(clearedBalance);
      const summary = await calcSummary(id);

      const status: ReconciliationStatus = difference.isZero() ? 'BALANCED' : 'UNBALANCED';

      const reconciliation: ReconciliationDetail = {
        ...recon,
        statement_date: normalizeDateOnly(recon.statement_date),
        created_at: String(recon.created_at),
        statement_balance: parseFloat(String(recon.statement_balance)),
        opening_balance: parseFloat(String(recon.opening_balance)),
        cleared_balance: parseFloat(clearedBalance.toFixed(2)),
        difference: parseFloat(difference.toFixed(2)),
        status,
        summary,
        items: items.map((item) => ({
          ...item,
          date: String(item.date),
          debit: parseFloat(String(item.debit)),
          credit: parseFloat(String(item.credit)),
        })) as ReconciliationItem[],
      };

      res.json({ reconciliation });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id/report',
  async (
    req: Request<{ id: string }>,
    res: Response<ReconciliationReportResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const report = await buildReconciliationReport(req.params.id);
      if (!report) return res.status(404).json({ error: 'Reconciliation not found' });
      res.json({ report });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requireRole('admin', 'editor'),
  async (
    req: Request<{}, CreateReconciliationResponse | ApiErrorResponse, CreateReconciliationInput>,
    res: Response<CreateReconciliationResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { account_id, statement_date, statement_balance, opening_balance } = req.body || {};

      if (!account_id || !statement_date || statement_balance === undefined) {
        return res.status(400).json({
          error: 'account_id, statement_date, and statement_balance are required',
        });
      }
      if (!isValidDateOnly(statement_date)) {
        return res.status(400).json({ error: 'statement_date is not a valid date (YYYY-MM-DD)' });
      }

      const account = await db('accounts').where({ id: account_id, is_active: true }).first() as AccountRow | undefined;
      if (!account) {
        return res.status(404).json({ error: 'Account not found or inactive' });
      }

      if (!['ASSET', 'LIABILITY'].includes(account.type)) {
        return res.status(400).json({
          error: 'Only ASSET or LIABILITY accounts can be reconciled',
        });
      }

      const openRecon = await db('reconciliations')
        .where({ account_id, is_closed: false })
        .first() as ReconciliationRow | undefined;

      if (openRecon) {
        return res.status(409).json({
          error: `Account already has an open reconciliation (#${openRecon.id}). Close it before starting a new one.`,
        });
      }

      const lastClosed = await db('reconciliations')
        .where({ account_id, is_closed: true })
        .orderBy('statement_date', 'desc')
        .first() as ReconciliationRow | undefined;

      const lastClosedDate = lastClosed ? normalizeDateOnly(lastClosed.statement_date) : '';
      if (lastClosed && compareDateOnly(statement_date, lastClosedDate) <= 0) {
        return res.status(400).json({
          error: `Statement date must be after the last closed reconciliation (${lastClosedDate})`,
        });
      }

      if (lastClosed) {
        const expectedOpening = dec(lastClosed.statement_balance);
        const providedOpening = dec(opening_balance ?? 0);
        if (!expectedOpening.equals(providedOpening)) {
          return res.status(400).json({
            error: `Opening balance must equal the previous closing balance of $${expectedOpening.toFixed(2)}`,
            expected: parseFloat(expectedOpening.toFixed(2)),
          } as ApiErrorResponse & { expected: number });
        }
      }

      const result = await db.transaction(async (trx: Knex.Transaction) => {
        const [recon] = await trx('reconciliations')
          .insert({
            account_id,
            statement_date,
            statement_balance: dec(statement_balance).toFixed(2),
            opening_balance: dec(opening_balance ?? 0).toFixed(2),
            is_closed: false,
            created_by: req.user!.id,
            created_at: trx.fn.now(),
            updated_at: trx.fn.now(),
          })
          .returning('*') as ReconciliationRow[];
        if (!recon) throw new Error('Failed to create reconciliation');

        const loaded = await loadItems(trx, recon.id, account_id, statement_date);
        return { recon, loaded };
      });

      res.status(201).json({
        reconciliation: result.recon as ReconciliationSummary,
        items_loaded: result.loaded,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/:id',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }, { reconciliation: ReconciliationRow } | ApiErrorResponse, UpdateReconciliationInput>,
    res: Response<{ reconciliation: ReconciliationRow } | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const { statement_balance, statement_date } = req.body || {};

      const recon = await db('reconciliations').where({ id }).first() as ReconciliationRow | undefined;
      if (!recon) return res.status(404).json({ error: 'Reconciliation not found' });
      if (recon.is_closed) {
        return res.status(409).json({ error: 'Cannot edit a closed reconciliation' });
      }

      const currentDate = normalizeDateOnly(recon.statement_date);
      const newDate = statement_date || currentDate;
      if (statement_date && !isValidDateOnly(statement_date)) {
        return res.status(400).json({ error: 'statement_date is not a valid date (YYYY-MM-DD)' });
      }
      const newBalance = statement_balance !== undefined
        ? dec(statement_balance).toFixed(2)
        : recon.statement_balance;

      await db.transaction(async (trx: Knex.Transaction) => {
        await trx('reconciliations').where({ id }).update({
          statement_balance: newBalance,
          statement_date: newDate,
          updated_at: trx.fn.now(),
        });

        if (statement_date && statement_date !== currentDate) {
          const futureEntryIds = await trx('rec_items as ri')
            .join('journal_entries as je', 'je.id', 'ri.journal_entry_id')
            .join('transactions as t', 't.id', 'je.transaction_id')
            .where('ri.reconciliation_id', id)
            .where('t.date', '>', newDate)
            .pluck('ri.id') as number[];

          if (futureEntryIds.length > 0) {
            await trx('rec_items').whereIn('id', futureEntryIds).delete();
          }

          await loadItems(trx, parseInt(id, 10), recon.account_id, newDate);
        }
      });

      const updated = await db('reconciliations').where({ id }).first() as ReconciliationRow | undefined;
      if (!updated) return res.status(404).json({ error: 'Reconciliation not found' });
      res.json({ reconciliation: updated });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/items/:itemId/clear',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string; itemId: string }>,
    res: Response<ReconciliationItemToggleResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { id, itemId } = req.params;

      const recon = await db('reconciliations').where({ id }).first() as ReconciliationRow | undefined;
      if (!recon) return res.status(404).json({ error: 'Reconciliation not found' });
      if (recon.is_closed) {
        return res.status(409).json({ error: 'Cannot modify a closed reconciliation' });
      }

      const item = await db('rec_items as ri')
        .join('journal_entries as je', 'je.id', 'ri.journal_entry_id')
        .join('transactions as t', 't.id', 'je.transaction_id')
        .where({ 'ri.id': itemId, 'ri.reconciliation_id': id })
        .where('t.is_voided', false)
        .select('ri.*')
        .first() as RecItemRow | undefined;

      if (!item) return res.status(404).json({ error: 'Item not found in this reconciliation' });

      const [updated] = await db('rec_items')
        .where({ id: itemId })
        .update({
          is_cleared: !item.is_cleared,
          updated_at: db.fn.now(),
        })
        .returning('*') as RecItemRow[];
      if (!updated) throw new Error('Failed to update reconciliation item');

      const account = await db('accounts').where({ id: recon.account_id }).first() as AccountRow | undefined;
      if (!account) return res.status(404).json({ error: 'Account not found' });
      const clearedBalance = await calcBalance(id, recon.opening_balance, account.type);
      const difference = dec(recon.statement_balance).minus(clearedBalance);

      res.json({
        item: {
          ...updated,
          created_at: String(updated.created_at),
          updated_at: String(updated.updated_at),
        },
        cleared_balance: parseFloat(clearedBalance.toFixed(2)),
        difference: parseFloat(difference.toFixed(2)),
        status: difference.isZero() ? 'BALANCED' : 'UNBALANCED',
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/close',
  requireRole('admin'),
  async (
    req: Request<{ id: string }>,
    res: Response<CloseReconciliationResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;

      const recon = await db('reconciliations').where({ id }).first() as ReconciliationRow | undefined;
      if (!recon) return res.status(404).json({ error: 'Reconciliation not found' });
      if (recon.is_closed) {
        return res.status(409).json({ error: 'Reconciliation is already closed' });
      }

      const account = await db('accounts').where({ id: recon.account_id }).first() as AccountRow | undefined;
      if (!account) return res.status(404).json({ error: 'Account not found' });
      const clearedBalance = await calcBalance(id, recon.opening_balance, account.type);
      const difference = dec(recon.statement_balance).minus(clearedBalance);

      if (!difference.isZero()) {
        return res.status(400).json({
          error: `Cannot close — reconciliation is not balanced. Difference: $${difference.toFixed(2)}`,
          difference: parseFloat(difference.toFixed(2)),
        } as ApiErrorResponse & { difference: number });
      }

      const previousClosed = await db('reconciliations')
        .where({ account_id: recon.account_id, is_closed: true })
        .where('statement_date', '<', normalizeDateOnly(recon.statement_date))
        .orderBy('statement_date', 'desc')
        .first() as ReconciliationRow | undefined;
      const periodStart = previousClosed
        ? addDaysDateOnly(normalizeDateOnly(previousClosed.statement_date), 1)
        : '0001-01-01';

      const unresolved = await db('bank_transactions')
        .join('bank_uploads', 'bank_uploads.id', 'bank_transactions.upload_id')
        .where('bank_uploads.account_id', recon.account_id)
        .where('bank_transactions.bank_posted_date', '>=', periodStart)
        .where('bank_transactions.bank_posted_date', '<=', normalizeDateOnly(recon.statement_date))
        .where('bank_transactions.lifecycle_status', 'open')
        .whereNot(function (this: Knex.QueryBuilder) {
          this.orWhere({
            match_status: 'confirmed',
            creation_status: 'none',
            review_status: 'reviewed',
          });
          this.orWhere({
            creation_status: 'created',
            review_status: 'reviewed',
          });
          this.orWhere({ disposition: 'ignored' });
        })
        .select(
          'bank_transactions.id',
          'bank_transactions.bank_posted_date',
          'bank_transactions.raw_description',
          'bank_transactions.amount',
          'bank_transactions.disposition',
          'bank_transactions.match_status',
          'bank_transactions.creation_status',
          'bank_transactions.review_status'
        ) as Array<Record<string, unknown>>;

      if (unresolved.length > 0) {
        return res.status(409).json({
          error: 'Reconciliation period has unresolved bank transactions',
          unresolved_count: unresolved.length,
          unresolved,
        } as ApiErrorResponse & { unresolved_count: number; unresolved: Record<string, unknown>[] });
      }

      await db.transaction(async (trx: Knex.Transaction) => {
        await trx('reconciliations').where({ id }).update({
          is_closed: true,
          updated_at: trx.fn.now(),
        });

        const clearedEntryIds = await trx('rec_items as ri')
          .join('journal_entries as je', 'je.id', 'ri.journal_entry_id')
          .join('transactions as t', 't.id', 'je.transaction_id')
          .where({ 'ri.reconciliation_id': id, 'ri.is_cleared': true })
          .where('t.is_voided', false)
          .pluck('ri.journal_entry_id') as number[];

        if (clearedEntryIds.length > 0) {
          await trx('journal_entries')
            .whereIn('id', clearedEntryIds)
            .update({
              is_reconciled: true,
              updated_at: trx.fn.now(),
            });

          await trx('bank_transactions')
            .whereIn('matched_journal_entry_id', clearedEntryIds)
            .where({ lifecycle_status: 'open', match_status: 'confirmed' })
            .update({
              lifecycle_status: 'locked',
              last_modified_at: trx.fn.now(),
            });
        }
      });

      const summary = await calcSummary(id);

      res.json({
        message: 'Reconciliation closed successfully',
        summary,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/reopen',
  requireRole('admin'),
  async (
    req: Request<{ id: string }>,
    res: Response<{ reconciliation: ReconciliationRow } | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const reconciliationId = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(reconciliationId) || reconciliationId <= 0) {
        return res.status(400).json({ error: 'id must be a positive integer' });
      }

      const recon = await db('reconciliations')
        .where({ id: reconciliationId })
        .first() as ReconciliationRow | undefined;
      if (!recon) return res.status(404).json({ error: 'Reconciliation not found' });
      if (!recon.is_closed) {
        return res.status(409).json({ error: 'Reconciliation is already open' });
      }

      const latestClosed = await db('reconciliations')
        .where({ account_id: recon.account_id, is_closed: true })
        .max('statement_date as max_statement_date')
        .first() as { max_statement_date: Date | string | null } | undefined;
      const reconDate = normalizeDateOnly(recon.statement_date);
      const maxClosedDate = latestClosed?.max_statement_date ? normalizeDateOnly(latestClosed.max_statement_date) : null;
      if (maxClosedDate && reconDate !== maxClosedDate) {
        return res.status(409).json({ error: 'Only the most recent closed period can be reopened' });
      }

      const openForAccount = await db('reconciliations')
        .where({ account_id: recon.account_id, is_closed: false })
        .whereNot({ id: reconciliationId })
        .first() as ReconciliationRow | undefined;
      if (openForAccount) {
        return res.status(409).json({ error: 'An open reconciliation already exists for this account' });
      }

      const preflight = await reconciliationReopenPreflight(reconciliationId, db);
      if (preflight.blocked) {
        return res.status(409).json({
          error: 'Reopen blocked by active bank match claims',
          conflicts: preflight.conflicts,
        } as ApiErrorResponse & { conflicts: unknown[] });
      }

      await db.transaction(async (trx: Knex.Transaction) => {
        await trx('reconciliations')
          .where({ id: reconciliationId })
          .update({
            is_closed: false,
            updated_at: trx.fn.now(),
          });

        const clearedEntryIds = await trx('rec_items as ri')
          .join('journal_entries as je', 'je.id', 'ri.journal_entry_id')
          .join('transactions as t', 't.id', 'je.transaction_id')
          .where({ 'ri.reconciliation_id': reconciliationId, 'ri.is_cleared': true })
          .where('t.is_voided', false)
          .pluck('ri.journal_entry_id') as number[];

        if (clearedEntryIds.length > 0) {
          await trx('journal_entries')
            .whereIn('id', clearedEntryIds)
            .update({
              is_reconciled: false,
              updated_at: trx.fn.now(),
            });

          await trx('bank_transactions')
            .whereIn('matched_journal_entry_id', clearedEntryIds)
            .where({ lifecycle_status: 'locked', match_status: 'confirmed' })
            .update({
              lifecycle_status: 'open',
              last_modified_at: trx.fn.now(),
            });
        }
      });

      const updated = await db('reconciliations')
        .where({ id: reconciliationId })
        .first() as ReconciliationRow | undefined;
      if (!updated) {
        return res.status(404).json({ error: 'Reconciliation not found' });
      }

      return res.json({ reconciliation: updated });
    } catch (err) {
      return next(err);
    }
  }
);

router.delete(
  '/:id',
  requireRole('admin'),
  async (
    req: Request<{ id: string }>,
    res: Response<MessageResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;

      const recon = await db('reconciliations').where({ id }).first() as ReconciliationRow | undefined;
      if (!recon) return res.status(404).json({ error: 'Reconciliation not found' });
      if (recon.is_closed) {
        return res.status(409).json({
          error: 'Cannot delete a closed reconciliation — it is part of the audit trail',
        });
      }

      await db('reconciliations').where({ id }).delete();

      res.json({ message: 'Reconciliation deleted successfully' });
    } catch (err) {
      next(err);
    }
  }
);

export = router;
