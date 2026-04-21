import type { NextFunction, Request, Response } from 'express';
import type { Knex } from 'knex';
import express = require('express');

import type {
  ApiErrorResponse,
  BankConfirmInput,
  BankHoldInput,
  BankIgnoreInput,
  BankImportInput,
  BankImportResult,
  BankMatchResult,
  CreateFromBankRowInput,
  BankRejectInput,
  BankReserveInput,
  BankReviewDecision,
  BankTransaction,
  BankTransactionConflict,
  BankTransactionResponse,
  BankTransactionsListResponse,
  BankTransactionsQuery,
  BankUploadsListResponse,
  BankUploadSummary,
} from '@shared/contracts';
import type {
  BankTransactionRow as DbBankTransactionRow,
  BankUploadRow,
  ReconciliationReservationRow,
} from '../types/db';
import { isValidDateOnly, normalizeDateOnly } from '../utils/date.js';
import { buildFingerprint, normalizeDescription } from '../services/bankTransactions/normalize.js';
import {
  confirmMatch,
  runMatcher,
  writeBankTransactionEvent,
} from '../services/bankTransactions/matcher.js';
import {
  acquireReservation,
  releaseReservation,
} from '../services/bankTransactions/reservations.js';
import { createFromBankRow } from '../services/bankTransactions/create.js';
import { resetRowState } from '../services/bankTransactions/resolution.js';

const db = require('../db');
const auth = require('../middleware/auth.js');
const requireRole = require('../middleware/roles.js');

type JoinedBankTransactionRow = DbBankTransactionRow & {
  account_id: number;
  fund_id: number;
};

type ApiBankTransactionWithFingerprint = BankTransaction & {
  fingerprint: string;
};

const router = express.Router();
router.use(auth);

function toNumber(value: string | number | null | undefined) {
  return Number.parseFloat(String(value ?? 0));
}

function toBankTransaction(row: JoinedBankTransactionRow): ApiBankTransactionWithFingerprint {
  return {
    id: row.id,
    upload_id: row.upload_id,
    account_id: row.account_id,
    fund_id: row.fund_id,
    row_index: row.row_index,
    bank_transaction_id: row.bank_transaction_id,
    bank_posted_date: normalizeDateOnly(row.bank_posted_date),
    bank_effective_date: row.bank_effective_date ? normalizeDateOnly(row.bank_effective_date) : null,
    raw_description: row.raw_description,
    sender_name: row.sender_name ?? null,
    sender_email: row.sender_email ?? null,
    bank_description_2: row.bank_description_2 ?? null,
    normalized_description: row.normalized_description,
    amount: toNumber(row.amount),
    fingerprint: row.fingerprint,
    status: row.status,
    journal_entry_id: row.journal_entry_id,
    reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at ? String(row.reviewed_at) : null,
    review_decision: row.review_decision,
    imported_at: String(row.imported_at),
    last_modified_at: String(row.last_modified_at),
    lifecycle_status: row.lifecycle_status,
    match_status: row.match_status,
    creation_status: row.creation_status,
    review_status: row.review_status,
    match_source: row.match_source,
    creation_source: row.creation_source,
    suggested_match_id: row.suggested_match_id,
    matched_journal_entry_id: row.matched_journal_entry_id,
    disposition: row.disposition,
  };
}

function stripFingerprint(item: ApiBankTransactionWithFingerprint): BankTransaction {
  const { fingerprint: _fingerprint, ...rest } = item;
  return rest;
}

function toConflict(row: Pick<DbBankTransactionRow, 'id' | 'bank_posted_date' | 'raw_description' | 'amount' | 'status'>): BankTransactionConflict {
  return {
    id: row.id,
    bank_posted_date: normalizeDateOnly(row.bank_posted_date),
    raw_description: row.raw_description,
    amount: toNumber(row.amount),
    status: row.status,
  };
}

async function attachConflicts(items: ApiBankTransactionWithFingerprint[]) {
  const needsReview = items.filter((item) => item.status === 'needs_review');
  if (needsReview.length === 0) return items;

  const fingerprints = Array.from(new Set(needsReview.map((item) => item.fingerprint)));
  const rows = await db('bank_transactions')
    .whereIn('fingerprint', fingerprints)
    .select('id', 'fingerprint', 'bank_posted_date', 'raw_description', 'amount', 'status')
    .orderBy('id', 'asc') as Array<DbBankTransactionRow & { fingerprint: string }>;

  const byFingerprint = new Map<string, Array<DbBankTransactionRow & { fingerprint: string }>>();
  rows.forEach((row) => {
    const existing = byFingerprint.get(row.fingerprint) || [];
    existing.push(row);
    byFingerprint.set(row.fingerprint, existing);
  });

  return items.map((item) => {
    if (item.status !== 'needs_review') return item;
    const candidates = byFingerprint.get(item.fingerprint) || [];
    const match = candidates.find((candidate) => candidate.id !== item.id);
    return match ? { ...item, conflict: toConflict(match) } : item;
  });
}

function parseIntegerId(value: string, field: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    const err = new Error(`${field} must be a positive integer`) as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }
  return parsed;
}

function parseCsvValues(value: unknown) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap((entry) => String(entry).split(',')).map((v) => v.trim()).filter(Boolean);
  return String(value).split(',').map((v) => v.trim()).filter(Boolean);
}

function parseReasonNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed;
}

async function getJoinedTransaction(
  queryDb: Knex | Knex.Transaction,
  bankTransactionId: number
) {
  return queryDb('bank_transactions as bt')
    .join('bank_uploads as bu', 'bu.id', 'bt.upload_id')
    .where('bt.id', bankTransactionId)
    .select('bt.*', 'bu.account_id', 'bu.fund_id')
    .first() as Promise<JoinedBankTransactionRow | undefined>;
}

router.post(
  '/import',
  requireRole('admin', 'editor'),
  async (
    req: Request<{}, BankImportResult | ApiErrorResponse, BankImportInput>,
    res: Response<BankImportResult | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { account_id, fund_id, filename, rows } = req.body || {};
      if (!Number.isInteger(account_id) || account_id <= 0) {
        return res.status(400).json({ error: 'account_id is required' });
      }
      if (!Number.isInteger(fund_id) || fund_id <= 0) {
        return res.status(400).json({ error: 'fund_id is required' });
      }
      if (!filename || !String(filename).trim()) {
        return res.status(400).json({ error: 'filename is required' });
      }
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: 'rows must contain at least one item' });
      }

      const preparedRows = rows.map((row, index) => {
        const rowNumber = index + 1;
        const bankPostedDate = String(row?.bank_posted_date || '');
        if (!isValidDateOnly(bankPostedDate)) {
          throw Object.assign(new Error(`Row ${rowNumber}: invalid bank_posted_date`), { statusCode: 400 });
        }

        const rawDescription = String(row?.raw_description || '').trim();
        if (!rawDescription) {
          throw Object.assign(new Error(`Row ${rowNumber}: raw_description is required`), { statusCode: 400 });
        }

        const amount = Number(row?.amount);
        if (!Number.isFinite(amount) || amount === 0) {
          throw Object.assign(new Error(`Row ${rowNumber}: amount must be a non-zero number`), { statusCode: 400 });
        }

        const bankEffectiveDate = row?.bank_effective_date ? String(row.bank_effective_date) : null;
        if (bankEffectiveDate && !isValidDateOnly(bankEffectiveDate)) {
          throw Object.assign(new Error(`Row ${rowNumber}: invalid bank_effective_date`), { statusCode: 400 });
        }

        const normalizedDescription = normalizeDescription(rawDescription);
        const fingerprint = buildFingerprint(normalizedDescription, amount, bankPostedDate);
        const bankTransactionId = row?.bank_transaction_id ? String(row.bank_transaction_id).trim() : null;
        const senderName = row?.sender_name ? String(row.sender_name).trim() : null;
        const senderEmail = row?.sender_email ? String(row.sender_email).trim() : null;
        const bankDescription2 = row?.bank_description_2 ? String(row.bank_description_2).trim() : null;

        return {
          row_index: index,
          bank_transaction_id: bankTransactionId || null,
          bank_posted_date: bankPostedDate,
          bank_effective_date: bankEffectiveDate,
          raw_description: rawDescription,
          sender_name: senderName || null,
          sender_email: senderEmail || null,
          bank_description_2: bankDescription2 || null,
          normalized_description: normalizedDescription,
          amount: Number(amount.toFixed(2)),
          fingerprint,
        };
      });

      const result = await db.transaction(async (trx: any) => {
        const [upload] = await trx('bank_uploads')
          .insert({
            account_id,
            fund_id,
            uploaded_by: req.user?.id ?? null,
            filename: String(filename).trim(),
            row_count: rows.length,
            imported_at: trx.fn.now(),
          })
          .returning('*') as BankUploadRow[];
        if (!upload) throw new Error('Failed to create bank upload');

        const incomingIds = Array.from(new Set(preparedRows.map((row) => row.bank_transaction_id).filter(Boolean))) as string[];
        const incomingFingerprints = Array.from(new Set(preparedRows.map((row) => row.fingerprint)));

        const existingIds = incomingIds.length > 0
          ? await trx('bank_transactions')
            .whereIn('bank_transaction_id', incomingIds)
            .pluck('bank_transaction_id') as string[]
          : [];

        const existingFingerprints = incomingFingerprints.length > 0
          ? await trx('bank_transactions')
            .whereIn('fingerprint', incomingFingerprints)
            .pluck('fingerprint') as string[]
          : [];

        const seenBankTransactionIds = new Set(existingIds);
        const seenFingerprints = new Set(existingFingerprints);
        const toInsert: Array<Record<string, unknown>> = [];
        let skipped = 0;
        let needsReview = 0;

        preparedRows.forEach((row) => {
          if (row.bank_transaction_id && seenBankTransactionIds.has(row.bank_transaction_id)) {
            skipped += 1;
            return;
          }

          const status = seenFingerprints.has(row.fingerprint) ? 'needs_review' : 'imported';
          if (status === 'needs_review') {
            needsReview += 1;
          } else {
            seenFingerprints.add(row.fingerprint);
          }

          if (row.bank_transaction_id) {
            seenBankTransactionIds.add(row.bank_transaction_id);
          }

          toInsert.push({
            upload_id: upload.id,
            row_index: row.row_index,
            bank_transaction_id: row.bank_transaction_id,
            bank_posted_date: row.bank_posted_date,
            bank_effective_date: row.bank_effective_date,
            raw_description: row.raw_description,
            sender_name: row.sender_name,
            sender_email: row.sender_email,
            bank_description_2: row.bank_description_2,
            normalized_description: row.normalized_description,
            amount: row.amount.toFixed(2),
            fingerprint: row.fingerprint,
            status,
            imported_at: trx.fn.now(),
            last_modified_at: trx.fn.now(),
          });
        });

        for (let index = 0; index < toInsert.length; index += 500) {
          await trx('bank_transactions').insert(toInsert.slice(index, index + 500));
        }

        return {
          upload_id: upload.id,
          inserted: toInsert.length,
          skipped,
          needs_review: needsReview,
          warnings: [],
        } as BankImportResult;
      });

      return res.status(201).json(result);
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 400) {
        return res.status(400).json({ error: (err as Error).message });
      }
      return next(err);
    }
  }
);

router.get(
  '/',
  async (
    req: Request<{}, BankTransactionsListResponse, unknown, BankTransactionsQuery>,
    res: Response<BankTransactionsListResponse>,
    next: NextFunction
  ) => {
    try {
      const query = db('bank_transactions as bt')
        .join('bank_uploads as bu', 'bu.id', 'bt.upload_id')
        .select('bt.*', 'bu.account_id', 'bu.fund_id');

      const statuses = parseCsvValues(req.query.status);
      if (statuses.length === 1) query.where('bt.status', statuses[0]);
      if (statuses.length > 1) query.whereIn('bt.status', statuses);

      if (req.query.upload_id) query.where('bt.upload_id', req.query.upload_id);
      if (req.query.account_id) query.where('bu.account_id', req.query.account_id);

      const lifecycleStatuses = parseCsvValues(req.query.lifecycle_status);
      if (lifecycleStatuses.length === 1) query.where('bt.lifecycle_status', lifecycleStatuses[0]);
      if (lifecycleStatuses.length > 1) query.whereIn('bt.lifecycle_status', lifecycleStatuses);

      const matchStatuses = parseCsvValues(req.query.match_status);
      if (matchStatuses.length === 1) query.where('bt.match_status', matchStatuses[0]);
      if (matchStatuses.length > 1) query.whereIn('bt.match_status', matchStatuses);

      const reviewStatuses = parseCsvValues(req.query.review_status);
      if (reviewStatuses.length === 1) query.where('bt.review_status', reviewStatuses[0]);
      if (reviewStatuses.length > 1) query.whereIn('bt.review_status', reviewStatuses);

      const dispositions = parseCsvValues(req.query.disposition);
      if (dispositions.length === 1) query.where('bt.disposition', dispositions[0]);
      if (dispositions.length > 1) query.whereIn('bt.disposition', dispositions);

      const rows = await query
        .orderBy('bt.imported_at', 'desc')
        .orderBy('bt.id', 'desc') as JoinedBankTransactionRow[];

      const withConflicts = await attachConflicts(rows.map(toBankTransaction));
      return res.json({ items: withConflicts.map(stripFingerprint) });
    } catch (err) {
      return next(err);
    }
  }
);

router.get(
  '/uploads',
  async (
    _req: Request,
    res: Response<BankUploadsListResponse>,
    next: NextFunction
  ) => {
    try {
      const uploads = await db('bank_uploads as bu')
        .join('accounts as a', 'a.id', 'bu.account_id')
        .join('funds as f', 'f.id', 'bu.fund_id')
        .select(
          'bu.id',
          'bu.account_id',
          'a.name as account_name',
          'bu.fund_id',
          'f.name as fund_name',
          'bu.uploaded_by',
          'bu.filename',
          'bu.row_count',
          'bu.imported_at'
        )
        .orderBy('bu.imported_at', 'desc')
        .orderBy('bu.id', 'desc') as Array<BankUploadSummary & { imported_at: string | Date }>;

      return res.json({
        uploads: uploads.map((upload) => ({
          ...upload,
          imported_at: String(upload.imported_at),
        })),
      });
    } catch (err) {
      return next(err);
    }
  }
);

router.get(
  '/:id',
  async (
    req: Request<{ id: string }>,
    res: Response<BankTransactionResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const row = await db('bank_transactions as bt')
        .join('bank_uploads as bu', 'bu.id', 'bt.upload_id')
        .where('bt.id', req.params.id)
        .select('bt.*', 'bu.account_id', 'bu.fund_id')
        .first() as JoinedBankTransactionRow | undefined;

      if (!row) {
        return res.status(404).json({ error: 'Bank transaction not found' });
      }

      const [withConflict] = await attachConflicts([toBankTransaction(row)]);
      if (!withConflict) {
        return res.status(404).json({ error: 'Bank transaction not found' });
      }

      return res.json({ item: stripFingerprint(withConflict) });
    } catch (err) {
      return next(err);
    }
  }
);

router.put(
  '/:id/review',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }, BankTransactionResponse | ApiErrorResponse, BankReviewDecision>,
    res: Response<BankTransactionResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { decision } = req.body || {};
      if (decision !== 'confirmed_new' && decision !== 'mark_as_duplicate') {
        return res.status(400).json({ error: 'decision must be confirmed_new or mark_as_duplicate' });
      }

      const existing = await db('bank_transactions')
        .where({ id: req.params.id })
        .first() as DbBankTransactionRow | undefined;

      if (!existing) {
        return res.status(404).json({ error: 'Bank transaction not found' });
      }

      if (existing.status !== 'needs_review') {
        return res.status(409).json({ error: 'Bank transaction already reviewed' });
      }

      const nextStatus = decision === 'mark_as_duplicate' ? 'archived' : 'imported';

      const updated = await db('bank_transactions')
        .where({ id: req.params.id, status: 'needs_review' })
        .update({
          status: nextStatus,
          reviewed_by: req.user?.id ?? null,
          reviewed_at: db.fn.now(),
          review_decision: decision,
          last_modified_at: db.fn.now(),
        })
        .returning('id') as Array<{ id: number }>;

      if (updated.length === 0) {
        return res.status(409).json({ error: 'Bank transaction already reviewed' });
      }

      const row = await db('bank_transactions as bt')
        .join('bank_uploads as bu', 'bu.id', 'bt.upload_id')
        .where('bt.id', req.params.id)
        .select('bt.*', 'bu.account_id', 'bu.fund_id')
        .first() as JoinedBankTransactionRow | undefined;

      if (!row) {
        return res.status(404).json({ error: 'Bank transaction not found' });
      }

      return res.json({ item: stripFingerprint(toBankTransaction(row)) });
    } catch (err) {
      return next(err);
    }
  }
);

router.post(
  '/:id/scan',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }>,
    res: Response<BankMatchResult | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const bankTransactionId = parseIntegerId(req.params.id, 'id');
      const result = await db.transaction(async (trx: Knex.Transaction) => (
        runMatcher(bankTransactionId, req.user?.id ?? null, trx)
      ));
      return res.json(result);
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode) {
        return res.status(statusCode).json({ error: (err as Error).message });
      }
      return next(err);
    }
  }
);

router.post(
  '/:id/reserve',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }, BankTransactionResponse | ApiErrorResponse, BankReserveInput>,
    res: Response<BankTransactionResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const bankTransactionId = parseIntegerId(req.params.id, 'id');
      const journalEntryId = parseIntegerId(String(req.body?.journal_entry_id || ''), 'journal_entry_id');

      const item = await db.transaction(async (trx: Knex.Transaction) => {
        const existing = await getJoinedTransaction(trx, bankTransactionId);
        if (!existing) {
          const err = new Error('Bank transaction not found') as Error & { statusCode?: number };
          err.statusCode = 404;
          throw err;
        }
        if (existing.match_status !== 'suggested' && existing.match_status !== 'none') {
          const err = new Error('Bank transaction is not reservable in its current state') as Error & { statusCode?: number };
          err.statusCode = 409;
          throw err;
        }

        const reservation = await acquireReservation(journalEntryId, bankTransactionId, req.user?.id ?? null, trx);
        if (!reservation.acquired) {
          const err = new Error('Journal entry already reserved') as Error & { statusCode?: number };
          err.statusCode = 409;
          throw err;
        }

        for (const releasedId of reservation.released) {
          await writeBankTransactionEvent({
            trx,
            bankTransactionId,
            eventType: 'reservation_released',
            actorType: 'user',
            actorId: req.user?.id ?? null,
            payload: { journal_entry_id: releasedId },
          });
        }

        await writeBankTransactionEvent({
          trx,
          bankTransactionId,
          eventType: 'reservation_acquired',
          actorType: 'user',
          actorId: req.user?.id ?? null,
          payload: { journal_entry_id: journalEntryId },
        });

        const updated = await getJoinedTransaction(trx, bankTransactionId);
        if (!updated) {
          const err = new Error('Bank transaction not found') as Error & { statusCode?: number };
          err.statusCode = 404;
          throw err;
        }
        return updated;
      });

      return res.json({ item: stripFingerprint(toBankTransaction(item)) });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode) {
        return res.status(statusCode).json({ error: (err as Error).message });
      }
      return next(err);
    }
  }
);

router.post(
  '/:id/confirm',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }, BankTransactionResponse | ApiErrorResponse, BankConfirmInput>,
    res: Response<BankTransactionResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const bankTransactionId = parseIntegerId(req.params.id, 'id');
      const journalEntryId = parseIntegerId(String(req.body?.journal_entry_id || ''), 'journal_entry_id');

      const item = await db.transaction(async (trx: Knex.Transaction) => {
        const confirmed = await confirmMatch(
          bankTransactionId,
          journalEntryId,
          'human',
          req.user?.id ?? null,
          trx
        );
        if (!confirmed) {
          const err = new Error('Failed to confirm bank transaction match') as Error & { statusCode?: number };
          err.statusCode = 409;
          throw err;
        }
        const joined = await getJoinedTransaction(trx, bankTransactionId);
        if (!joined) {
          const err = new Error('Bank transaction not found') as Error & { statusCode?: number };
          err.statusCode = 404;
          throw err;
        }
        return joined;
      });

      return res.json({ item: stripFingerprint(toBankTransaction(item)) });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode) {
        return res.status(statusCode).json({ error: (err as Error).message });
      }
      return next(err);
    }
  }
);

router.post(
  '/:id/reject',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }, BankTransactionResponse | ApiErrorResponse, BankRejectInput>,
    res: Response<BankTransactionResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const bankTransactionId = parseIntegerId(req.params.id, 'id');
      const journalEntryId = parseIntegerId(String(req.body?.journal_entry_id || ''), 'journal_entry_id');

      const item = await db.transaction(async (trx: Knex.Transaction) => {
        const existing = await getJoinedTransaction(trx, bankTransactionId);
        if (!existing) {
          const err = new Error('Bank transaction not found') as Error & { statusCode?: number };
          err.statusCode = 404;
          throw err;
        }
        if (existing.match_status === 'confirmed') {
          const err = new Error('Cannot reject a confirmed match') as Error & { statusCode?: number };
          err.statusCode = 409;
          throw err;
        }

        await trx('bank_transaction_rejections')
          .insert({
            bank_transaction_id: bankTransactionId,
            journal_entry_id: journalEntryId,
            rejected_by: req.user?.id ?? null,
            rejected_at: trx.fn.now(),
          })
          .onConflict(['bank_transaction_id', 'journal_entry_id'])
          .ignore();

        if (existing.suggested_match_id === journalEntryId) {
          await trx('bank_transactions')
            .where({ id: bankTransactionId })
            .update({
              suggested_match_id: null,
              match_status: 'none',
              last_modified_at: trx.fn.now(),
            });
        }

        await releaseReservation(journalEntryId, bankTransactionId, trx);

        await writeBankTransactionEvent({
          trx,
          bankTransactionId,
          eventType: 'match_dismissed',
          actorType: 'user',
          actorId: req.user?.id ?? null,
          payload: { journal_entry_id: journalEntryId },
        });

        const updated = await getJoinedTransaction(trx, bankTransactionId);
        if (!updated) {
          const err = new Error('Bank transaction not found') as Error & { statusCode?: number };
          err.statusCode = 404;
          throw err;
        }
        return updated;
      });

      return res.json({ item: stripFingerprint(toBankTransaction(item)) });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode) {
        return res.status(statusCode).json({ error: (err as Error).message });
      }
      return next(err);
    }
  }
);

router.post(
  '/:id/release',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }>,
    res: Response<BankTransactionResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const bankTransactionId = parseIntegerId(req.params.id, 'id');

      const item = await db.transaction(async (trx: Knex.Transaction) => {
        const existing = await getJoinedTransaction(trx, bankTransactionId);
        if (!existing) {
          const err = new Error('Bank transaction not found') as Error & { statusCode?: number };
          err.statusCode = 404;
          throw err;
        }

        const reservation = await trx('reconciliation_reservations')
          .where({ bank_transaction_id: bankTransactionId })
          .where('expires_at', '>', trx.fn.now())
          .first() as ReconciliationReservationRow | undefined;

        if (!reservation) {
          return existing;
        }

        await releaseReservation(reservation.journal_entry_id, bankTransactionId, trx);

        await writeBankTransactionEvent({
          trx,
          bankTransactionId,
          eventType: 'reservation_released',
          actorType: 'user',
          actorId: req.user?.id ?? null,
          payload: { journal_entry_id: reservation.journal_entry_id },
        });

        const updated = await getJoinedTransaction(trx, bankTransactionId);
        if (!updated) {
          const err = new Error('Bank transaction not found') as Error & { statusCode?: number };
          err.statusCode = 404;
          throw err;
        }
        return updated;
      });

      return res.json({ item: stripFingerprint(toBankTransaction(item)) });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode) {
        return res.status(statusCode).json({ error: (err as Error).message });
      }
      return next(err);
    }
  }
);

router.delete(
  '/:id/rejections',
  requireRole('admin'),
  async (
    req: Request<{ id: string }>,
    res: Response<BankTransactionResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const bankTransactionId = parseIntegerId(req.params.id, 'id');

      const item = await db.transaction(async (trx: Knex.Transaction) => {
        const existing = await getJoinedTransaction(trx, bankTransactionId);
        if (!existing) {
          const err = new Error('Bank transaction not found') as Error & { statusCode?: number };
          err.statusCode = 404;
          throw err;
        }

        await trx('bank_transaction_rejections')
          .where({ bank_transaction_id: bankTransactionId })
          .delete();

        await writeBankTransactionEvent({
          trx,
          bankTransactionId,
          eventType: 'rejection_history_cleared',
          actorType: 'admin',
          actorId: req.user?.id ?? null,
        });

        const updated = await getJoinedTransaction(trx, bankTransactionId);
        if (!updated) {
          const err = new Error('Bank transaction not found') as Error & { statusCode?: number };
          err.statusCode = 404;
          throw err;
        }
        return updated;
      });

      return res.json({ item: stripFingerprint(toBankTransaction(item)) });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode) {
        return res.status(statusCode).json({ error: (err as Error).message });
      }
      return next(err);
    }
  }
);

router.post(
  '/:id/hold',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }, BankTransactionResponse | ApiErrorResponse, BankHoldInput>,
    res: Response<BankTransactionResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const bankTransactionId = parseIntegerId(req.params.id, 'id');
      const reasonNote = parseReasonNote(req.body?.reason_note);

      const item = await db.transaction(async (trx: Knex.Transaction) => {
        const existing = await getJoinedTransaction(trx, bankTransactionId);
        if (!existing) return null;

        if (
          existing.lifecycle_status !== 'open'
          || existing.disposition !== 'none'
          || existing.creation_status === 'created'
          || existing.match_status === 'confirmed'
        ) {
          const err = new Error('Bank transaction cannot be held in its current state') as Error & { statusCode?: number };
          err.statusCode = 409;
          throw err;
        }

        await trx('bank_transactions')
          .where({ id: bankTransactionId })
          .update({
            disposition: 'hold',
            last_modified_at: trx.fn.now(),
          });

        await writeBankTransactionEvent({
          trx,
          bankTransactionId,
          eventType: 'hold_set',
          actorType: 'user',
          actorId: req.user?.id ?? null,
          reasonNote,
        });

        return getJoinedTransaction(trx, bankTransactionId);
      });

      if (!item) {
        return res.status(404).json({ error: 'Bank transaction not found' });
      }
      return res.json({ item: stripFingerprint(toBankTransaction(item)) });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode) {
        return res.status(statusCode).json({ error: (err as Error).message });
      }
      return next(err);
    }
  }
);

router.post(
  '/:id/release-hold',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }>,
    res: Response<BankTransactionResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const bankTransactionId = parseIntegerId(req.params.id, 'id');

      const item = await db.transaction(async (trx: Knex.Transaction) => {
        const existing = await getJoinedTransaction(trx, bankTransactionId);
        if (!existing) return null;
        if (existing.disposition !== 'hold') {
          const err = new Error('Bank transaction is not on hold') as Error & { statusCode?: number };
          err.statusCode = 409;
          throw err;
        }

        await resetRowState(bankTransactionId, trx);
        await writeBankTransactionEvent({
          trx,
          bankTransactionId,
          eventType: 'hold_released',
          actorType: 'user',
          actorId: req.user?.id ?? null,
        });

        await runMatcher(bankTransactionId, req.user?.id ?? null, trx);
        return getJoinedTransaction(trx, bankTransactionId);
      });

      if (!item) {
        return res.status(404).json({ error: 'Bank transaction not found' });
      }
      return res.json({ item: stripFingerprint(toBankTransaction(item)) });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode) {
        return res.status(statusCode).json({ error: (err as Error).message });
      }
      return next(err);
    }
  }
);

router.post(
  '/:id/ignore',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }, BankTransactionResponse | ApiErrorResponse, BankIgnoreInput>,
    res: Response<BankTransactionResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const bankTransactionId = parseIntegerId(req.params.id, 'id');
      const reasonNote = parseReasonNote(req.body?.reason_note);

      const item = await db.transaction(async (trx: Knex.Transaction) => {
        const existing = await getJoinedTransaction(trx, bankTransactionId);
        if (!existing) return null;

        if (
          existing.lifecycle_status !== 'open'
          || existing.disposition !== 'none'
          || existing.creation_status === 'created'
          || existing.match_status === 'confirmed'
        ) {
          const err = new Error('Bank transaction cannot be ignored in its current state') as Error & { statusCode?: number };
          err.statusCode = 409;
          throw err;
        }

        const reservation = await trx('reconciliation_reservations')
          .where({ bank_transaction_id: bankTransactionId })
          .where('expires_at', '>', trx.fn.now())
          .first() as ReconciliationReservationRow | undefined;
        if (reservation) {
          await releaseReservation(reservation.journal_entry_id, bankTransactionId, trx);
        }

        await trx('bank_transactions')
          .where({ id: bankTransactionId })
          .update({
            disposition: 'ignored',
            last_modified_at: trx.fn.now(),
          });

        await writeBankTransactionEvent({
          trx,
          bankTransactionId,
          eventType: 'row_ignored',
          actorType: 'user',
          actorId: req.user?.id ?? null,
          reasonNote,
        });

        return getJoinedTransaction(trx, bankTransactionId);
      });

      if (!item) {
        return res.status(404).json({ error: 'Bank transaction not found' });
      }
      return res.json({ item: stripFingerprint(toBankTransaction(item)) });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode) {
        return res.status(statusCode).json({ error: (err as Error).message });
      }
      return next(err);
    }
  }
);

router.post(
  '/:id/unignore',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }>,
    res: Response<BankTransactionResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const bankTransactionId = parseIntegerId(req.params.id, 'id');
      const item = await db.transaction(async (trx: Knex.Transaction) => {
        const existing = await getJoinedTransaction(trx, bankTransactionId);
        if (!existing) return null;
        if (existing.disposition !== 'ignored') {
          const err = new Error('Bank transaction is not ignored') as Error & { statusCode?: number };
          err.statusCode = 409;
          throw err;
        }

        await resetRowState(bankTransactionId, trx);
        await writeBankTransactionEvent({
          trx,
          bankTransactionId,
          eventType: 'row_ignore_reversed',
          actorType: 'user',
          actorId: req.user?.id ?? null,
        });
        return getJoinedTransaction(trx, bankTransactionId);
      });

      if (!item) {
        return res.status(404).json({ error: 'Bank transaction not found' });
      }
      return res.json({ item: stripFingerprint(toBankTransaction(item)) });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode) {
        return res.status(statusCode).json({ error: (err as Error).message });
      }
      return next(err);
    }
  }
);

router.post(
  '/:id/create',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }, BankTransactionResponse | ApiErrorResponse, CreateFromBankRowInput & { bill_id?: number }>,
    res: Response<BankTransactionResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const bankTransactionId = parseIntegerId(req.params.id, 'id');
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'bill_id')) {
        return res.status(400).json({ error: 'bill_id is not supported in this endpoint' });
      }

      const item = await db.transaction(async (trx: Knex.Transaction) => {
        const existing = await getJoinedTransaction(trx, bankTransactionId);
        if (!existing) return null;
        if (
          existing.lifecycle_status !== 'open'
          || existing.match_status === 'confirmed'
          || existing.disposition === 'ignored'
          || existing.creation_status !== 'none'
        ) {
          const err = new Error('Bank transaction cannot create a new journal entry in its current state') as Error & { statusCode?: number };
          err.statusCode = 409;
          throw err;
        }

        const created = await createFromBankRow(
          {
            ...req.body,
            bank_account_id: existing.account_id,
            fund_id: existing.fund_id,
          },
          req.user!.id,
          trx
        );

        await trx('bank_transactions')
          .where({ id: bankTransactionId })
          .update({
            creation_status: 'created',
            creation_source: 'human',
            review_status: 'reviewed',
            status: 'created_new',
            journal_entry_id: created.bank_je_id,
            last_modified_at: trx.fn.now(),
          });

        await writeBankTransactionEvent({
          trx,
          bankTransactionId,
          eventType: 'create_new_confirmed',
          actorType: 'user',
          actorId: req.user?.id ?? null,
          payload: {
            journal_entry_id: created.bank_je_id,
            transaction_id: created.transaction_id,
          },
        });
        return getJoinedTransaction(trx, bankTransactionId);
      });

      if (!item) {
        return res.status(404).json({ error: 'Bank transaction not found' });
      }
      return res.json({ item: stripFingerprint(toBankTransaction(item)) });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode || (err as { status?: number }).status;
      if (statusCode) {
        return res.status(statusCode).json({ error: (err as Error).message });
      }
      return next(err);
    }
  }
);

router.post(
  '/:id/approve-match',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }>,
    res: Response<BankTransactionResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const bankTransactionId = parseIntegerId(req.params.id, 'id');
      const item = await db.transaction(async (trx: Knex.Transaction) => {
        const existing = await getJoinedTransaction(trx, bankTransactionId);
        if (!existing) return null;
        if (
          existing.match_status !== 'confirmed'
          || existing.match_source !== 'system'
          || existing.review_status !== 'pending'
        ) {
          const err = new Error('Bank transaction is not eligible for match approval') as Error & { statusCode?: number };
          err.statusCode = 409;
          throw err;
        }

        await trx('bank_transactions')
          .where({ id: bankTransactionId })
          .update({
            review_status: 'reviewed',
            last_modified_at: trx.fn.now(),
          });

        await writeBankTransactionEvent({
          trx,
          bankTransactionId,
          eventType: 'match_reviewed',
          actorType: 'user',
          actorId: req.user?.id ?? null,
        });

        return getJoinedTransaction(trx, bankTransactionId);
      });

      if (!item) {
        return res.status(404).json({ error: 'Bank transaction not found' });
      }
      return res.json({ item: stripFingerprint(toBankTransaction(item)) });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode) {
        return res.status(statusCode).json({ error: (err as Error).message });
      }
      return next(err);
    }
  }
);

router.post(
  '/:id/override-match',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }>,
    res: Response<BankTransactionResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const bankTransactionId = parseIntegerId(req.params.id, 'id');
      const item = await db.transaction(async (trx: Knex.Transaction) => {
        const existing = await getJoinedTransaction(trx, bankTransactionId);
        if (!existing) return null;
        if (existing.match_status !== 'confirmed' || existing.match_source !== 'system') {
          const err = new Error('Bank transaction is not eligible for override') as Error & { statusCode?: number };
          err.statusCode = 409;
          throw err;
        }

        await resetRowState(bankTransactionId, trx);
        await writeBankTransactionEvent({
          trx,
          bankTransactionId,
          eventType: 'match_cleared',
          actorType: 'user',
          actorId: req.user?.id ?? null,
        });
        return getJoinedTransaction(trx, bankTransactionId);
      });

      if (!item) {
        return res.status(404).json({ error: 'Bank transaction not found' });
      }
      return res.json({ item: stripFingerprint(toBankTransaction(item)) });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode) {
        return res.status(statusCode).json({ error: (err as Error).message });
      }
      return next(err);
    }
  }
);

export = router;
