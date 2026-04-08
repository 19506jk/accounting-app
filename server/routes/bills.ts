import type { NextFunction, Request, Response } from 'express';
import type { Knex } from 'knex';
import express = require('express');

import type {
  ApplyBillCreditsInput,
  ApplyBillCreditsResponse,
  AvailableBillCreditsResponse,
  ApiErrorResponse,
  ApiValidationErrorResponse,
  BillAgingReportResponse,
  BillDetail,
  BillMutationResponse,
  BillResponse,
  BillsListResponse,
  BillsQuery,
  BillSummary,
  BillSummaryResponse,
  CreateBillInput,
  UnapplyBillCreditsResponse,
  PayBillInput,
  UpdateBillInput,
} from '@shared/contracts';
import type {
  BillLineItemRow,
  BillListRow,
  BillRow,
  TransactionRow,
} from '../types/db';

const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
import billService = require('../services/bills');
import { getChurchToday, isValidDateOnly } from '../utils/date.js';
import { getChurchTimeZone } from '../services/churchTimeZone.js';

const {
  createBill,
  updateBill,
  payBill,
  voidBill,
  getAvailableCreditsForBill,
  applyBillCredits,
  unapplyBillCredits,
  getAgingReport,
  getUnpaidSummary,
  getBillWithLineItems,
} = billService;

const router = express.Router();
router.use(auth);

function applyBillFilters<TRecord, TResult>(
  q: Knex.QueryBuilder<TRecord & {}, TResult>,
  filters: BillsQuery
) {
  const { status, contact_id, from, to } = filters;
  if (status) {
    if (Array.isArray(status)) q.whereIn('b.status', status);
    else q.where('b.status', status);
  }
  if (contact_id) q.where('b.contact_id', contact_id);
  if (from) q.where('b.date', '>=', from);
  if (to) q.where('b.date', '<=', to);
  return q;
}

function normaliseMutationTransaction(
  transaction: TransactionRow | null | undefined
): BillMutationResponse['transaction'] {
  if (!transaction) return undefined;
  return {
    ...transaction,
    date: String(transaction.date),
    created_at: String(transaction.created_at),
    updated_at: String(transaction.updated_at),
  };
}

router.get(
  '/',
  async (
    req: Request<{}, BillsListResponse | ApiErrorResponse, unknown, BillsQuery>,
    res: Response<BillsListResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { status, contact_id, from, to, limit = 100, offset = 0 } = req.query;
      if (from && !isValidDateOnly(from)) {
        return res.status(400).json({ error: 'from is not a valid date (YYYY-MM-DD)' });
      }
      if (to && !isValidDateOnly(to)) {
        return res.status(400).json({ error: 'to is not a valid date (YYYY-MM-DD)' });
      }
      if (from && to && from > to) {
        return res.status(400).json({ error: 'from must be before or equal to to' });
      }

      const query = applyBillFilters(db('bills as b'), { status, contact_id, from, to })
        .leftJoin('contacts as c', 'c.id', 'b.contact_id')
        .leftJoin('funds as f', 'f.id', 'b.fund_id')
        .leftJoin('users as u', 'u.id', 'b.created_by')
        .leftJoin('transactions as t', 't.id', 'b.created_transaction_id')
        .select(
          'b.*',
          'c.name as vendor_name',
          'f.name as fund_name',
          'u.name as created_by_name',
          't.is_voided'
        )
        .orderBy('b.created_at', 'desc');

      // NOTE: if filters referencing joined tables are added, mirror those joins in this count query.
      const countQuery = applyBillFilters(
        db('bills as b').count('b.id as count'),
        { status, contact_id, from, to }
      );

      const cap = Math.min(parseInt(String(limit), 10), 200);
      const off = parseInt(String(offset), 10) || 0;
      const [[countRow], bills] = await Promise.all([
        countQuery as Promise<Array<{ count: string }>>,
        query.limit(cap).offset(off) as Promise<BillListRow[]>,
      ]);

      const billIds = bills.map((b) => b.id);
      const lineItemsMap: Record<number, BillSummary['line_items']> = {};

      if (billIds.length > 0) {
        // Intentionally minimal payload for list view; detail endpoint returns tax/account enrichment.
        const lineItemsResult = await db('bill_line_items')
          .whereIn('bill_id', billIds)
          .select('bill_id', 'id', 'expense_account_id', 'amount', 'description', 'tax_rate_id') as Array<BillLineItemRow & { bill_id: number }>;

        lineItemsResult.forEach((li) => {
          if (!lineItemsMap[li.bill_id]) lineItemsMap[li.bill_id] = [];
          lineItemsMap[li.bill_id]?.push({
            id: li.id,
            expense_account_id: li.expense_account_id,
            amount: parseFloat(String(li.amount)),
            description: li.description,
            tax_rate_id: li.tax_rate_id ?? null,
          });
        });
      }

      res.json({
        bills: bills.map((b) => ({
          ...b,
          date: String(b.date),
          due_date: b.due_date ? String(b.due_date) : null,
          paid_at: b.paid_at ? String(b.paid_at) : null,
          created_at: String(b.created_at),
          updated_at: String(b.updated_at),
          amount: parseFloat(String(b.amount)),
          amount_paid: parseFloat(String(b.amount_paid)),
          is_voided: b.is_voided ?? false,
          line_items: lineItemsMap[b.id] || [],
        })),
        total: parseInt(countRow?.count || '0', 10),
        limit: cap,
        offset: off,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/summary', async (_req: Request, res: Response<BillSummaryResponse>, next: NextFunction) => {
  try {
    const summary = await getUnpaidSummary();
    res.json({ summary });
  } catch (err) {
    next(err);
  }
});

router.get(
  '/reports/aging',
  async (
    req: Request<{}, BillAgingReportResponse | ApiErrorResponse, unknown, { as_of?: string }>,
    res: Response<BillAgingReportResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { as_of } = req.query;
      if (as_of && !isValidDateOnly(as_of)) {
        return res.status(400).json({ error: 'as_of is not a valid date (YYYY-MM-DD)' });
      }
      const asOfDate = as_of || getChurchToday(getChurchTimeZone());

      const report = await getAgingReport(asOfDate);
      res.json({ report });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id/available-credits',
  async (
    req: Request<{ id: string }>,
    res: Response<AvailableBillCreditsResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const credits = await getAvailableCreditsForBill(req.params.id);
      const target = await getBillWithLineItems(req.params.id);
      if (!target) return res.status(404).json({ error: 'Bill not found' });
      const targetOutstanding = parseFloat((target.amount - target.amount_paid).toFixed(2));
      res.json({
        credits,
        target_bill_id: target.id,
        target_outstanding: targetOutstanding,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/apply-credits',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }, ApplyBillCreditsResponse | ApiValidationErrorResponse, ApplyBillCreditsInput>,
    res: Response<ApplyBillCreditsResponse | ApiValidationErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const result = await applyBillCredits(req.params.id, req.body, req.user!.id);
      if (result.errors) return res.status(400).json({ errors: result.errors });
      if (!result.bill) throw new Error('Unexpected missing bill after applyBillCredits');
      res.json({
        bill: result.bill,
        applications: result.applications || [],
        transaction: normaliseMutationTransaction(result.transaction),
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/unapply-credits',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }>,
    res: Response<UnapplyBillCreditsResponse | ApiValidationErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const result = await unapplyBillCredits(req.params.id, req.user!.id);
      if (result.errors) return res.status(400).json({ errors: result.errors });
      if (!result.bill) throw new Error('Unexpected missing bill after unapplyBillCredits');
      res.json({
        bill: result.bill,
        unapplied_count: result.unapplied_count || 0,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id',
  async (
    req: Request<{ id: string }>,
    res: Response<BillResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;

      const bill = await getBillWithLineItems(id);

      if (!bill) {
        return res.status(404).json({ error: 'Bill not found' });
      }

      // Service returns bill + line items but not created transaction void flag, so we resolve it here.
      let is_voided = false;
      if (bill.created_transaction_id) {
        const transaction = await db('transactions')
          .where({ id: bill.created_transaction_id })
          .select('is_voided')
          .first() as { is_voided?: boolean } | undefined;

        is_voided = transaction?.is_voided || false;
      }

      let paymentTransaction: BillDetail['payment_transaction'] = null;
      if (bill.transaction_id) {
        const found = await db('transactions as t')
          .leftJoin('users as u', 'u.id', 't.created_by')
          .where('t.id', bill.transaction_id)
          .select(
            't.id',
            't.date',
            't.description',
            't.reference_no',
            'u.name as created_by_name'
          )
          .first() as NonNullable<BillDetail['payment_transaction']> | undefined;
        paymentTransaction = found ?? null;
      }

      res.json({
        bill: {
          ...bill,
          is_voided,
          payment_transaction: paymentTransaction,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requireRole('admin', 'editor'),
  async (
    req: Request<{}, BillMutationResponse | ApiValidationErrorResponse, CreateBillInput>,
    res: Response<BillMutationResponse | ApiValidationErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const result = await createBill(req.body, req.user!.id);

      if (result.errors) {
        return res.status(400).json({ errors: result.errors });
      }
      if (!result.bill) throw new Error('Unexpected missing bill after createBill');

      res.status(201).json({ bill: result.bill, transaction: normaliseMutationTransaction(result.transaction) });
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/:id',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }, { bill: BillDetail } | ApiValidationErrorResponse, UpdateBillInput>,
    res: Response<{ bill: BillDetail } | ApiValidationErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const result = await updateBill(id, req.body, req.user!.id);

      if (result.errors) {
        return res.status(400).json({ errors: result.errors });
      }
      if (!result.bill) throw new Error('Unexpected missing bill after updateBill');

      res.json({ bill: result.bill });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/pay',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }, BillMutationResponse | (ApiValidationErrorResponse & { outstanding?: number }), PayBillInput>,
    res: Response<BillMutationResponse | (ApiValidationErrorResponse & { outstanding?: number })>,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const result = await payBill(id, req.body, req.user!.id);

      if (result.errors) {
        return res.status(400).json({
          errors: result.errors,
          outstanding: result.outstanding,
        });
      }
      if (!result.bill) throw new Error('Unexpected missing bill after payBill');

      res.json({ bill: result.bill, transaction: normaliseMutationTransaction(result.transaction) });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/void',
  requireRole('admin'),
  async (
    req: Request<{ id: string }>,
    res: Response<BillMutationResponse | ApiValidationErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const result = await voidBill(id, req.user!.id);

      if (result.errors) {
        return res.status(400).json({ errors: result.errors });
      }
      if (!result.bill) throw new Error('Unexpected missing bill after voidBill');

      res.json({ bill: result.bill, transaction: normaliseMutationTransaction(result.transaction) });
    } catch (err) {
      next(err);
    }
  }
);

export = router;
