import type { NextFunction, Request, Response } from 'express';
import express = require('express');

import type {
  ApiErrorResponse,
  BankImportInput,
  BankImportResult,
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
} from '../types/db';
import { isValidDateOnly, normalizeDateOnly } from '../utils/date.js';
import { buildFingerprint, normalizeDescription } from '../services/bankTransactions/normalize.js';

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

        return {
          row_index: index,
          bank_transaction_id: bankTransactionId || null,
          bank_posted_date: bankPostedDate,
          bank_effective_date: bankEffectiveDate,
          raw_description: rawDescription,
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

      if (req.query.status) query.where('bt.status', req.query.status);
      if (req.query.upload_id) query.where('bt.upload_id', req.query.upload_id);
      if (req.query.account_id) query.where('bu.account_id', req.query.account_id);

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

export = router;
