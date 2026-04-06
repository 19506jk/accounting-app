import type { NextFunction, Request, Response } from 'express';
import express = require('express');

import type {
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
  PayBillInput,
  UpdateBillInput,
} from '../../shared/contracts';
import type {
  BillLineItemRow,
  BillListRow,
  BillRow,
  TransactionRow,
} from '../types/db';

const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const {
  createBill,
  updateBill,
  payBill,
  voidBill,
  getAgingReport,
  getUnpaidSummary,
  getBillWithLineItems,
} = require('../services/bills') as {
  createBill: (payload: CreateBillInput, userId: number) => Promise<{ errors?: string[]; bill?: BillDetail; transaction?: TransactionRow }>;
  updateBill: (id: string, payload: UpdateBillInput, userId: number) => Promise<{ errors?: string[]; bill?: BillDetail }>;
  payBill: (id: string, payload: PayBillInput, userId: number) => Promise<{ errors?: string[]; outstanding?: number; bill?: BillDetail; transaction?: TransactionRow }>;
  voidBill: (id: string, userId: number) => Promise<{ errors?: string[]; bill?: BillDetail; transaction?: TransactionRow }>;
  getAgingReport: (asOfDate: string | Date) => Promise<BillAgingReportResponse['report']>;
  getUnpaidSummary: () => Promise<BillSummaryResponse['summary']>;
  getBillWithLineItems: (id: string) => Promise<BillDetail | null>;
};

const router = express.Router();
router.use(auth);

router.get(
  '/',
  async (
    req: Request<{}, BillsListResponse, unknown, BillsQuery>,
    res: Response<BillsListResponse>,
    next: NextFunction
  ) => {
    try {
      const { status, contact_id, from, to, limit = 100, offset = 0 } = req.query;

      const query = db('bills as b')
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

      if (status) {
        if (Array.isArray(status)) {
          query.whereIn('b.status', status);
        } else {
          query.where('b.status', status);
        }
      }

      if (contact_id) {
        query.where('b.contact_id', contact_id);
      }

      if (from) {
        query.where('b.date', '>=', from);
      }

      if (to) {
        query.where('b.date', '<=', to);
      }

      const countQuery = db('bills as b').count('b.id as count');

      if (status) {
        if (Array.isArray(status)) {
          countQuery.whereIn('b.status', status);
        } else {
          countQuery.where('b.status', status);
        }
      }
      if (contact_id) {
        countQuery.where('b.contact_id', contact_id);
      }
      if (from) {
        countQuery.where('b.date', '>=', from);
      }
      if (to) {
        countQuery.where('b.date', '<=', to);
      }

      const [{ count }] = await countQuery as Array<{ count: string }>;

      const cap = Math.min(parseInt(String(limit), 10), 200);
      const off = parseInt(String(offset), 10) || 0;
      query.limit(cap).offset(off);

      const bills = await query as BillListRow[];

      const billIds = bills.map((b) => b.id);
      const lineItemsMap: Record<number, BillSummary['line_items']> = {};

      if (billIds.length > 0) {
        const lineItemsResult = await db('bill_line_items')
          .whereIn('bill_id', billIds)
          .select('bill_id', 'id', 'expense_account_id', 'amount', 'description') as Array<BillLineItemRow & { bill_id: number }>;

        lineItemsResult.forEach((li) => {
          if (!lineItemsMap[li.bill_id]) lineItemsMap[li.bill_id] = [];
          lineItemsMap[li.bill_id]?.push({
            id: li.id,
            expense_account_id: li.expense_account_id,
            amount: parseFloat(String(li.amount)),
            description: li.description,
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
          line_items: lineItemsMap[b.id] || [],
        })),
        total: parseInt(count, 10),
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
    req: Request<{}, BillAgingReportResponse, unknown, { as_of?: string }>,
    res: Response<BillAgingReportResponse>,
    next: NextFunction
  ) => {
    try {
      const { as_of } = req.query;
      const asOfDate = as_of || new Date();

      const report = await getAgingReport(asOfDate);
      res.json({ report });
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

      let is_voided = false;
      if (bill.created_transaction_id) {
        const transaction = await db('transactions')
          .where({ id: bill.created_transaction_id })
          .select('is_voided')
          .first() as { is_voided?: boolean } | undefined;

        is_voided = transaction?.is_voided || false;
      }

      let paymentTransaction = null;
      if (bill.transaction_id) {
        paymentTransaction = await db('transactions as t')
          .leftJoin('users as u', 'u.id', 't.created_by')
          .where('t.id', bill.transaction_id)
          .select(
            't.id',
            't.date',
            't.description',
            't.reference_no',
            'u.name as created_by_name'
          )
          .first() as BillDetail['payment_transaction'];
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
      const result = await createBill(req.body, req.user.id);

      if (result.errors) {
        return res.status(400).json({ errors: result.errors });
      }

      res.status(201).json({ bill: result.bill as BillDetail, transaction: result.transaction });
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
      const result = await updateBill(id, req.body, req.user.id);

      if (result.errors) {
        return res.status(400).json({ errors: result.errors });
      }

      res.json({ bill: result.bill as BillDetail });
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
      const result = await payBill(id, req.body, req.user.id);

      if (result.errors) {
        return res.status(400).json({
          errors: result.errors,
          outstanding: result.outstanding,
        });
      }

      res.json({ bill: result.bill as BillDetail, transaction: result.transaction });
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
      const result = await voidBill(id, req.user.id);

      if (result.errors) {
        return res.status(400).json({ errors: result.errors });
      }

      res.json({ bill: result.bill as BillDetail, transaction: result.transaction });
    } catch (err) {
      next(err);
    }
  }
);

export = router;
