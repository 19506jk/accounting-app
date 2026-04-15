import type { NextFunction, Request, Response } from 'express';
import type { Knex } from 'knex';
import express = require('express');
import Decimal from 'decimal.js';

import type {
  BillMatchSuggestion,
  ApiErrorResponse,
  ApiValidationErrorResponse,
  CreateTransactionInput,
  GetBillMatchRowInput,
  GetBillMatchesInput,
  GetBillMatchesResult,
  ImportTransactionsInput,
  ImportTransactionsResult,
  MessageResponse,
  TransactionCreateResult,
  TransactionDetail,
  TransactionListItem,
  TransactionResponse,
  TransactionsListResponse,
  TransactionsQuery,
  UpdateTransactionInput,
} from '@shared/contracts';
import type {
  TransactionListRow,
} from '../types/db';
import { addDaysDateOnly, normalizeDateOnly, parseDateOnlyStrict } from '../utils/date.js';
import { getChurchTimeZone } from '../services/churchTimeZone.js';

const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
import transactionService = require('../services/transactions');
import transactionImportService = require('../services/transactions/imports');

const router = express.Router();
router.use(auth);

const dec = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);

router.get(
  '/',
  async (
    req: Request<{}, TransactionsListResponse | ApiErrorResponse, unknown, TransactionsQuery>,
    res: Response<TransactionsListResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const {
        fund_id,
        account_id,
        contact_id,
        include_inactive,
        transaction_type,
        from,
        to,
        limit = 50,
        offset = 0,
      } = req.query;
      const validTransactionTypes: Array<NonNullable<TransactionsQuery['transaction_type']>> = ['deposit', 'withdrawal', 'transfer'];
      const includeInactive = include_inactive === true || String(include_inactive).toLowerCase() === 'true';
      if (transaction_type && !validTransactionTypes.includes(transaction_type)) {
        return res.status(400).json({ error: 'transaction_type must be one of deposit, withdrawal, transfer' });
      }
      if (from && !parseDateOnlyStrict(String(from))) {
        return res.status(400).json({ error: 'from is not a valid date (YYYY-MM-DD)' });
      }
      if (to && !parseDateOnlyStrict(String(to))) {
        return res.status(400).json({ error: 'to is not a valid date (YYYY-MM-DD)' });
      }
      if (from && to && String(from) > String(to)) {
        return res.status(400).json({ error: 'from must be before or equal to to' });
      }

      const cap = Math.min(parseInt(String(limit), 10) || 50, 200);
      const off = parseInt(String(offset), 10) || 0;

      const baseQuery = () => db('transactions as t')
        .leftJoin('users as u', 'u.id', 't.created_by')
        .modify((q: Knex.QueryBuilder) => {
          if (!includeInactive) q.where('t.is_voided', false);
          if (fund_id) q.where('t.fund_id', fund_id);
          if (from) q.where('t.date', '>=', from);
          if (to) q.where('t.date', '<=', to);
          if (account_id) {
            q.whereExists(
              db('journal_entries as je')
                .where('je.transaction_id', db.raw('t.id'))
                .where('je.account_id', account_id)
            );
          }
          if (contact_id) {
            q.whereExists(
              db('journal_entries as je')
                .where('je.transaction_id', db.raw('t.id'))
                .where('je.contact_id', contact_id)
            );
          }
          if (transaction_type === 'deposit') {
            q.whereExists(
              db('journal_entries as je_type_filter')
                .join('accounts as a_type_filter', 'a_type_filter.id', 'je_type_filter.account_id')
                .where('je_type_filter.transaction_id', db.raw('t.id'))
                .where('a_type_filter.type', 'INCOME')
                .where('je_type_filter.credit', '>', 0)
            );
          }
          if (transaction_type === 'withdrawal') {
            q.whereNotExists(
              db('journal_entries as je_type_filter')
                .join('accounts as a_type_filter', 'a_type_filter.id', 'je_type_filter.account_id')
                .where('je_type_filter.transaction_id', db.raw('t.id'))
                .where('a_type_filter.type', 'INCOME')
                .where('je_type_filter.credit', '>', 0)
            ).whereExists(
              db('journal_entries as je_type_filter')
                .join('accounts as a_type_filter', 'a_type_filter.id', 'je_type_filter.account_id')
                .where('je_type_filter.transaction_id', db.raw('t.id'))
                .where('a_type_filter.type', 'EXPENSE')
                .where('je_type_filter.debit', '>', 0)
            );
          }
          if (transaction_type === 'transfer') {
            q.whereNotExists(
              db('journal_entries as je_type_filter')
                .join('accounts as a_type_filter', 'a_type_filter.id', 'je_type_filter.account_id')
                .where('je_type_filter.transaction_id', db.raw('t.id'))
                .where('a_type_filter.type', 'INCOME')
                .where('je_type_filter.credit', '>', 0)
            ).whereNotExists(
              db('journal_entries as je_type_filter')
                .join('accounts as a_type_filter', 'a_type_filter.id', 'je_type_filter.account_id')
                .where('je_type_filter.transaction_id', db.raw('t.id'))
                .where('a_type_filter.type', 'EXPENSE')
                .where('je_type_filter.debit', '>', 0)
            );
          }
        });

      const [counted] = await baseQuery().count('t.id as count') as Array<{ count: string }>;

      const transactions = await baseQuery()
        .leftJoin(
          db('journal_entries')
            .select('transaction_id')
            .sum('debit as total_amount')
            .groupBy('transaction_id')
            .as('je_totals'),
          'je_totals.transaction_id',
          't.id'
        )
        .leftJoin(
          db('journal_entries as je_type')
            .join('accounts as a_type', 'a_type.id', 'je_type.account_id')
            .select([
              'je_type.transaction_id',
              db.raw(`MAX(CASE WHEN a_type.type = 'INCOME' AND je_type.credit > 0 THEN 1 ELSE 0 END) AS has_income_credit`),
              db.raw(`MAX(CASE WHEN a_type.type = 'EXPENSE' AND je_type.debit > 0 THEN 1 ELSE 0 END) AS has_expense_debit`),
            ])
            .groupBy('je_type.transaction_id')
            .as('je_type_flags'),
          'je_type_flags.transaction_id',
          't.id'
        )
        .leftJoin(
          db('journal_entries as je')
            .leftJoin('contacts as c', 'c.id', 'je.contact_id')
            .select([
              'je.transaction_id',
              db.raw('COUNT(DISTINCT je.contact_id) AS contact_count'),
              db.raw('MAX(c.name) AS contact_name'),
            ])
            .whereNotNull('je.contact_id')
            .groupBy('je.transaction_id')
            .as('je_contacts'),
          'je_contacts.transaction_id',
          't.id'
        )
        .select(
          't.id',
          't.date',
          't.description',
          't.reference_no',
          db.raw('CASE WHEN je_contacts.contact_count = 1 THEN je_contacts.contact_name ELSE NULL END AS contact_name'),
          db.raw('COALESCE(CASE WHEN je_contacts.contact_count > 1 THEN 1 ELSE 0 END, 0) AS has_multiple_contacts'),
          't.fund_id',
          't.created_at',
          't.is_voided',
          'u.name as created_by_name',
          db.raw('COALESCE(je_totals.total_amount, 0) AS total_amount'),
          db.raw('COALESCE(je_type_flags.has_income_credit, 0) AS has_income_credit'),
          db.raw('COALESCE(je_type_flags.has_expense_debit, 0) AS has_expense_debit')
        )
        .orderBy('t.date', 'desc')
        .orderBy('t.created_at', 'desc')
        .limit(cap)
        .offset(off) as (TransactionListRow & { has_income_credit: number; has_expense_debit: number })[];

      const mapped: TransactionListItem[] = transactions.map((t) => {
        let transaction_type: TransactionListItem['transaction_type'] = 'transfer';
        if (Number(t.has_income_credit) > 0) transaction_type = 'deposit';
        else if (Number(t.has_expense_debit) > 0) transaction_type = 'withdrawal';
        return {
          ...t,
          date: normalizeDateOnly(t.date),
          created_at: String(t.created_at),
          is_voided: Boolean(t.is_voided),
          total_amount: parseFloat(String(t.total_amount)),
          has_multiple_contacts: Number(t.has_multiple_contacts) > 0,
          transaction_type,
        };
      });

      res.json({
        transactions: mapped,
        total: parseInt(counted?.count || '0', 10),
        limit: cap,
        offset: off,
      });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/import/bill-matches',
  requireRole('admin', 'editor'),
  async (
    req: Request<{}, GetBillMatchesResult | ApiValidationErrorResponse, GetBillMatchesInput>,
    res: Response<GetBillMatchesResult | ApiValidationErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const body = req.body || {} as GetBillMatchesInput;
      const errors: string[] = [];
      const bankAccountId = Number(body.bank_account_id);
      const rows = body.rows;

      if (!Number.isInteger(bankAccountId) || bankAccountId <= 0) errors.push('bank_account_id must be a positive integer');
      if (!Array.isArray(rows) || rows.length === 0) errors.push('rows must be a non-empty array');
      if (Array.isArray(rows) && rows.length > 500) errors.push('rows cannot exceed 500');
      if (errors.length > 0) return res.status(400).json({ errors });

      const withdrawalRows = (rows as GetBillMatchRowInput[])
        .map((row) => ({ row, row_index: Number(row?.row_index) }))
        .filter(({ row }) => row?.type === 'withdrawal');

      const preparedRows: Array<{ row_index: number; date: string; amount: Decimal }> = [];
      withdrawalRows.forEach(({ row, row_index }) => {
        if (!Number.isInteger(row_index) || row_index <= 0) {
          errors.push(`Row index ${row_index}: row_index must be a positive integer`);
          return;
        }

        const rowDate = String(row.date || '').trim();
        if (!parseDateOnlyStrict(rowDate)) {
          errors.push(`Row ${row_index}: date must be a valid YYYY-MM-DD value`);
          return;
        }

        let amount: Decimal;
        try {
          amount = dec(row.amount);
        } catch {
          errors.push(`Row ${row_index}: amount is invalid`);
          return;
        }

        if (amount.lte(0)) {
          errors.push(`Row ${row_index}: amount must be greater than 0`);
          return;
        }

        preparedRows.push({ row_index, date: rowDate, amount });
      });

      if (errors.length > 0) return res.status(400).json({ errors });
      if (preparedRows.length === 0) return res.json({ suggestions: [] });

      const uniqueAmounts = [...new Set(preparedRows.map((row) => row.amount.toFixed(2)))];
      const maxDate = preparedRows.reduce((acc, row) => (row.date > acc ? row.date : acc), preparedRows[0]!.date);
      const minDate = preparedRows.reduce((acc, row) => (row.date < acc ? row.date : acc), preparedRows[0]!.date);
      const timezone = getChurchTimeZone();
      const minExactDateFloor = addDaysDateOnly(minDate, -60, timezone);

      const exactCandidateBills = await db('bills as b')
        .leftJoin('contacts as c', 'c.id', 'b.contact_id')
        .where('b.status', 'UNPAID')
        .where('b.date', '>=', minExactDateFloor)
        .where('b.date', '<=', maxDate)
        .whereIn(db.raw('(b.amount - b.amount_paid)'), uniqueAmounts)
        .select(
          'b.id',
          'b.bill_number',
          'b.date',
          'b.due_date',
          'b.amount',
          'b.amount_paid',
          'c.name as vendor_name'
        ) as Array<{
          id: number;
          bill_number: string | null;
          date: string;
          due_date: string | null;
          amount: string | number;
          amount_paid: string | number;
          vendor_name: string | null;
        }>;

      const suggestions: BillMatchSuggestion[] = [];
      const unresolvedRows: Array<{ row_index: number; date: string; amount: Decimal }> = [];

      for (const row of preparedRows) {
        const rowAmount = row.amount.toFixed(2);
        const minExactDate = addDaysDateOnly(row.date, -60, timezone);

        const exactMatches = exactCandidateBills.filter((bill) => {
          const billDate = normalizeDateOnly(bill.date);
          const balanceDue = dec(bill.amount).minus(dec(bill.amount_paid));
          return balanceDue.toFixed(2) === rowAmount
            && billDate <= row.date
            && billDate >= minExactDate;
        });

        exactMatches.forEach((bill) => {
          const balanceDue = dec(bill.amount).minus(dec(bill.amount_paid));
          suggestions.push({
            row_index: row.row_index,
            bill_id: bill.id,
            bill_number: bill.bill_number,
            vendor_name: bill.vendor_name,
            bill_date: normalizeDateOnly(bill.date),
            due_date: bill.due_date ? normalizeDateOnly(bill.due_date) : null,
            balance_due: parseFloat(balanceDue.toFixed(2)),
            confidence: 'exact',
          });
        });

        if (exactMatches.length === 0) unresolvedRows.push(row);
      }

      if (unresolvedRows.length > 0) {
        const unresolvedAmounts = [...new Set(unresolvedRows.map((row) => row.amount.toFixed(2)))];
        const unresolvedMaxDate = unresolvedRows.reduce((acc, row) => (row.date > acc ? row.date : acc), unresolvedRows[0]!.date);

        const possibleCandidateBills = await db('bills as b')
          .leftJoin('contacts as c', 'c.id', 'b.contact_id')
          .where('b.status', 'UNPAID')
          .where('b.date', '<=', unresolvedMaxDate)
          .whereIn(db.raw('(b.amount - b.amount_paid)'), unresolvedAmounts)
          .select(
            'b.id',
            'b.bill_number',
            'b.date',
            'b.due_date',
            'b.amount',
            'b.amount_paid',
            'c.name as vendor_name'
          ) as Array<{
            id: number;
            bill_number: string | null;
            date: string;
            due_date: string | null;
            amount: string | number;
            amount_paid: string | number;
            vendor_name: string | null;
          }>;

        for (const row of unresolvedRows) {
          const rowAmount = row.amount.toFixed(2);
          const possibleMatches = possibleCandidateBills.filter((bill) => {
            const billDate = normalizeDateOnly(bill.date);
            const balanceDue = dec(bill.amount).minus(dec(bill.amount_paid));
            return balanceDue.toFixed(2) === rowAmount && billDate <= row.date;
          });

          possibleMatches.forEach((bill) => {
            const balanceDue = dec(bill.amount).minus(dec(bill.amount_paid));
            suggestions.push({
              row_index: row.row_index,
              bill_id: bill.id,
              bill_number: bill.bill_number,
              vendor_name: bill.vendor_name,
              bill_date: normalizeDateOnly(bill.date),
              due_date: bill.due_date ? normalizeDateOnly(bill.due_date) : null,
              balance_due: parseFloat(balanceDue.toFixed(2)),
              confidence: 'possible',
            });
          });
        }
      }

      return res.json({ suggestions });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/import',
  requireRole('admin', 'editor'),
  async (
    req: Request<{}, ImportTransactionsResult | ApiValidationErrorResponse | ApiErrorResponse, ImportTransactionsInput>,
    res: Response<ImportTransactionsResult | ApiValidationErrorResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const result = await transactionImportService.importTransactions(req.body, req.user!.id);
      return res.json(result);
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      const validationErrors = (err as { validationErrors?: string[] }).validationErrors;
      if (statusCode && validationErrors?.length) {
        return res.status(statusCode).json({ errors: validationErrors });
      }
      next(err);
    }
  }
);

router.get(
  '/:id',
  async (
    req: Request<{ id: string }>,
    res: Response<TransactionResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const detail = await transactionService.getTransactionDetailById(id);
      if (!detail) return res.status(404).json({ error: 'Transaction not found' });
      res.json({ transaction: detail });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requireRole('admin', 'editor'),
  async (
    req: Request<{}, { transaction: TransactionCreateResult } | ApiErrorResponse | ApiValidationErrorResponse, CreateTransactionInput>,
    res: Response<{ transaction: TransactionCreateResult } | ApiErrorResponse | ApiValidationErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const transaction = await transactionService.createTransaction(req.body, req.user!.id);
      res.status(201).json({ transaction });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      const validationErrors = (err as { validationErrors?: string[] }).validationErrors;
      if (statusCode === 400 && validationErrors?.length) {
        return res.status(400).json({ errors: validationErrors });
      }
      next(err);
    }
  }
);

router.put(
  '/:id',
  requireRole('admin', 'editor'),
  async (
    req: Request<{ id: string }, { transaction: TransactionDetail } | ApiErrorResponse | ApiValidationErrorResponse, UpdateTransactionInput>,
    res: Response<{ transaction: TransactionDetail } | ApiErrorResponse | ApiValidationErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { id } = req.params;
      const transaction = await transactionService.updateTransaction(id, req.body);

      res.json({
        transaction,
      });
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      const validationErrors = (err as { validationErrors?: string[] }).validationErrors;
      if (statusCode === 400) {
        if (validationErrors?.length) return res.status(400).json({ errors: validationErrors });
        return res.status(400).json({ error: (err as Error).message || 'Invalid transaction update' });
      }
      next(err);
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

      await transactionService.deleteTransaction(id);
      res.json({ message: 'Transaction deleted successfully' });
    } catch (err) {
      next(err);
    }
  }
);

export = router;
