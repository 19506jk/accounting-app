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
  ImportTransactionRow,
  ImportTransactionsInput,
  ImportTransactionsResult,
  MessageResponse,
  SkippedImportRow,
  TransactionCreateResult,
  TransactionDetail,
  TransactionListItem,
  TransactionResponse,
  TransactionsListResponse,
  TransactionsQuery,
  UpdateTransactionInput,
} from '@shared/contracts';
import type {
  AccountRow,
  FundRow,
  TransactionListRow,
} from '../types/db';
import { addDaysDateOnly, compareDateOnly, getChurchToday, normalizeDateOnly, parseDateOnlyStrict } from '../utils/date.js';
import { getChurchTimeZone } from '../services/churchTimeZone.js';
import { assertNotClosedPeriod } from '../utils/hardCloseGuard.js';

const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
import billService = require('../services/bills');
import transactionService = require('../services/transactions');

const router = express.Router();
router.use(auth);

const dec = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const ROUNDING_ACCOUNT_CODE = '59999';
const MAX_ROUNDING_ADJUSTMENT = dec('0.10');
const normalizeImportDescription = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const normalizeImportReference = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
};

const { payBill } = billService;

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
      const body = req.body || {} as ImportTransactionsInput;
      const errors: string[] = [];

      const bankAccountId = Number(body.bank_account_id);
      const fundId = Number(body.fund_id);
      const force = body.force === true;
      const rows = body.rows;

      if (!Number.isInteger(bankAccountId) || bankAccountId <= 0) errors.push('bank_account_id must be a positive integer');
      if (!Number.isInteger(fundId) || fundId <= 0) errors.push('fund_id must be a positive integer');
      if (!Array.isArray(rows) || rows.length === 0) errors.push('rows must be a non-empty array');
      if (Array.isArray(rows) && rows.length > 500) errors.push('rows cannot exceed 500');

      if (errors.length > 0) return res.status(400).json({ errors });

      const bankAccount = await db('accounts')
        .where({ id: bankAccountId, is_active: true })
        .first() as AccountRow | undefined;

      if (!bankAccount) {
        errors.push(`Bank account #${bankAccountId} does not exist or is inactive`);
      } else if (bankAccount.type !== 'ASSET') {
        errors.push(`Bank account #${bankAccountId} must be an ASSET account`);
      }

      const fund = await db('funds').where({ id: fundId, is_active: true }).first() as FundRow | undefined;
      if (!fund) errors.push(`Fund #${fundId} does not exist or is inactive`);

      const taxRates = await db('tax_rates')
        .where('is_active', true)
        .select('id', 'name', 'rate', 'recoverable_account_id') as Array<{
          id: number;
          name: string;
          rate: string | number;
          recoverable_account_id: number | null;
        }>;
      const taxRateMap = new Map(taxRates.map((taxRate) => [taxRate.id, taxRate]));

      type PreparedSplit = {
        amount: Decimal;
        amount_fixed: string;
        fund_id: number;
        contact_id: number | null;
        memo: string | null;
        offset_account_id?: number;
        expense_account_id?: number;
        tax_rate_id?: number | null;
        tax_rate_name?: string | null;
        recoverable_account_id?: number | null;
        pre_tax_amount?: Decimal;
        pre_tax_amount_fixed?: string;
        rounding_adjustment?: Decimal;
        rounding_adjustment_fixed?: string;
        tax_amount?: Decimal;
        tax_amount_fixed?: string;
        description?: string | null;
      };

      type PreparedImportRow = {
        row_index: number;
        date: string;
        description: string;
        normalized_description: string;
        reference_no: string | null;
        amount: Decimal;
        amount_fixed: string;
        type: 'withdrawal' | 'deposit';
        offset_account_id: number;
        payee_id: number | null;
        contact_id: number | null;
        bill_id?: number;
        splits?: PreparedSplit[];
      };

      const preparedRows: PreparedImportRow[] = [];
      const offsetAccountIds = new Set<number>();
      const offsetAccountRows = new Map<number, number[]>();
      const billIds = new Set<number>();
      const billRows = new Map<number, number[]>();
      const splitFundIds = new Set<number>();
      const splitFundRowLabels = new Map<number, string[]>();
      const splitContactIds = new Set<number>();
      const splitContactRowLabels = new Map<number, string[]>();
      const plainDepositContactIds = new Set<number>();
      const plainDepositContactRowLabels = new Map<number, string[]>();
      const payeeContactIds = new Set<number>();
      const payeeRowLabels = new Map<number, string[]>();
      const withdrawalExpenseAccountIds = new Set<number>();
      const withdrawalExpenseAccountLabels = new Map<number, string[]>();
      const recoverableAccountIds = new Set<number>();
      const recoverableAccountLabels = new Map<number, string[]>();
      let requiresRoundingAccount = false;

      (rows as ImportTransactionRow[]).forEach((row, idx) => {
        const rowNumber = idx + 1;
        const rowErrors: string[] = [];
        if (!row) {
          rowErrors.push(`Row ${rowNumber}: row is required`);
          errors.push(...rowErrors);
          return;
        }

        const rowDate = String(row.date || '').trim();
        const rowDescription = String(row.description || '').trim();
        const rowReferenceNo = normalizeImportReference(row.reference_no);
        const rowType = row.type;
        const rowPayeeId = row.payee_id === undefined || row.payee_id === null ? null : Number(row.payee_id);
        const rowContactId = row.contact_id === undefined || row.contact_id === null ? null : Number(row.contact_id);
        const offsetAccountId = Number(row.offset_account_id);
        const billId = row.bill_id === undefined || row.bill_id === null ? undefined : Number(row.bill_id);
        const hasSplits = Array.isArray(row.splits) && row.splits.length > 0;
        let amount: Decimal;

        if (!parseDateOnlyStrict(rowDate)) {
          rowErrors.push(`Row ${rowNumber}: date must be a valid YYYY-MM-DD value`);
        }

        if (!rowDescription) {
          rowErrors.push(`Row ${rowNumber}: description is required`);
        }

        try {
          amount = dec(row.amount).toDecimalPlaces(2);
        } catch {
          rowErrors.push(`Row ${rowNumber}: amount is invalid`);
          errors.push(...rowErrors);
          return;
        }

        if (amount.isZero() || amount.isNegative()) {
          rowErrors.push(`Row ${rowNumber}: amount must be greater than 0`);
        } else if (amount.decimalPlaces() > 2) {
          rowErrors.push(`Row ${rowNumber}: amount cannot have more than 2 decimal places`);
        }

        if (rowType !== 'withdrawal' && rowType !== 'deposit') {
          rowErrors.push(`Row ${rowNumber}: type must be 'withdrawal' or 'deposit'`);
        }

        if (hasSplits && billId !== undefined) {
          rowErrors.push(`Row ${rowNumber}: cannot include both bill_id and splits`);
        }

        let preparedSplits: PreparedSplit[] | undefined;

        if (hasSplits) {
          let splitTotal = dec(0);
          preparedSplits = [];
          let hasSplitValidationError = false;
          const pushSplitError = (message: string) => {
            hasSplitValidationError = true;
            rowErrors.push(message);
          };

          if (rowType === 'withdrawal') {
            const normalizedRowPayeeId = rowPayeeId === null ? NaN : Number(rowPayeeId);
            if (!Number.isInteger(normalizedRowPayeeId) || normalizedRowPayeeId <= 0) {
              rowErrors.push(`Row ${rowNumber}: payee_id is required for withdrawal split rows`);
            } else {
              payeeContactIds.add(normalizedRowPayeeId);
              payeeRowLabels.set(
                normalizedRowPayeeId,
                [...(payeeRowLabels.get(normalizedRowPayeeId) || []), `Row ${rowNumber}`]
              );
            }
          }

          row.splits!.forEach((split, splitIdx) => {
            const splitNumber = splitIdx + 1;
            const label = `Row ${rowNumber}, split ${splitNumber}`;
            const splitFundId = Number(split?.fund_id);

            if (!Number.isInteger(splitFundId) || splitFundId <= 0) {
              pushSplitError(`${label}: fund_id must be a positive integer`);
            } else {
              splitFundIds.add(splitFundId);
              splitFundRowLabels.set(splitFundId, [...(splitFundRowLabels.get(splitFundId) || []), label]);
            }

            if (rowType === 'deposit') {
              const splitAmountRaw = split?.amount;
              const splitOffsetAccountId = Number(split?.offset_account_id);
              const splitContactId = split?.contact_id === undefined || split?.contact_id === null ? null : Number(split.contact_id);

              let splitAmount: Decimal | null = null;
              try {
                splitAmount = dec(splitAmountRaw).toDecimalPlaces(2);
              } catch {
                pushSplitError(`${label}: amount is invalid`);
              }

              if (splitAmount) {
                if (splitAmount.isZero() || splitAmount.isNegative()) {
                  pushSplitError(`${label}: amount must be greater than 0`);
                } else if (splitAmount.decimalPlaces() > 2) {
                  pushSplitError(`${label}: amount cannot have more than 2 decimal places`);
                }
              }

              if (!Number.isInteger(splitOffsetAccountId) || splitOffsetAccountId <= 0) {
                pushSplitError(`${label}: offset_account_id must be a positive integer`);
              } else if (splitOffsetAccountId === bankAccountId) {
                pushSplitError(`${label}: offset_account_id cannot be the same as bank_account_id`);
              }

              if (splitContactId !== null && (!Number.isInteger(splitContactId) || splitContactId <= 0)) {
                pushSplitError(`${label}: contact_id must be a positive integer when provided`);
              } else if (splitContactId) {
                splitContactIds.add(splitContactId);
                splitContactRowLabels.set(splitContactId, [...(splitContactRowLabels.get(splitContactId) || []), label]);
              }

              if (splitAmount && Number.isInteger(splitOffsetAccountId) && splitOffsetAccountId > 0 && Number.isInteger(splitFundId) && splitFundId > 0) {
                splitTotal = splitTotal.plus(splitAmount).toDecimalPlaces(2);
                offsetAccountIds.add(splitOffsetAccountId);
                const existingRows = offsetAccountRows.get(splitOffsetAccountId) || [];
                existingRows.push(rowNumber);
                offsetAccountRows.set(splitOffsetAccountId, existingRows);

                preparedSplits!.push({
                  amount: splitAmount,
                  amount_fixed: splitAmount.toFixed(2),
                  offset_account_id: splitOffsetAccountId,
                  fund_id: splitFundId,
                  contact_id: splitContactId,
                  memo: split?.memo ? String(split.memo).trim() || null : null,
                });
              }

              return;
            }

            const splitExpenseAccountId = Number(split?.expense_account_id);
            const splitTaxRateId = split?.tax_rate_id === undefined || split?.tax_rate_id === null ? null : Number(split.tax_rate_id);
            let splitPreTax: Decimal | null = null;
            let splitRounding: Decimal | null = null;
            let splitAmount: Decimal | null = null;

            try {
              splitPreTax = dec(split?.pre_tax_amount).toDecimalPlaces(2);
            } catch {
              pushSplitError(`${label}: pre_tax_amount is invalid`);
            }
            try {
              splitRounding = dec(split?.rounding_adjustment ?? 0).toDecimalPlaces(2);
            } catch {
              pushSplitError(`${label}: rounding_adjustment is invalid`);
            }
            try {
              splitAmount = dec(split?.amount).toDecimalPlaces(2);
            } catch {
              pushSplitError(`${label}: amount is invalid`);
            }

            if (splitPreTax) {
              if (splitPreTax.lte(0)) pushSplitError(`${label}: pre_tax_amount must be greater than 0`);
              if (splitPreTax.decimalPlaces() > 2) pushSplitError(`${label}: pre_tax_amount cannot have more than 2 decimal places`);
            }

            if (splitRounding) {
              if (splitRounding.decimalPlaces() > 2) pushSplitError(`${label}: rounding_adjustment cannot have more than 2 decimal places`);
              if (splitRounding.abs().gt(MAX_ROUNDING_ADJUSTMENT)) {
                pushSplitError(`${label}: rounding_adjustment cannot exceed ${MAX_ROUNDING_ADJUSTMENT.toFixed(2)} in absolute value`);
              }
              if (!splitRounding.isZero()) requiresRoundingAccount = true;
            }

            if (splitAmount) {
              if (splitAmount.lte(0)) pushSplitError(`${label}: amount must be greater than 0`);
              if (splitAmount.decimalPlaces() > 2) pushSplitError(`${label}: amount cannot have more than 2 decimal places`);
            }

            if (!Number.isInteger(splitExpenseAccountId) || splitExpenseAccountId <= 0) {
              pushSplitError(`${label}: expense_account_id must be a positive integer`);
            } else {
              withdrawalExpenseAccountIds.add(splitExpenseAccountId);
              withdrawalExpenseAccountLabels.set(
                splitExpenseAccountId,
                [...(withdrawalExpenseAccountLabels.get(splitExpenseAccountId) || []), label]
              );
            }

            let taxAmount = dec(0);
            let taxRateName: string | null = null;
            let recoverableAccountId: number | null = null;

            if (splitTaxRateId !== null) {
              if (!Number.isInteger(splitTaxRateId) || splitTaxRateId <= 0) {
                pushSplitError(`${label}: tax_rate_id must be a positive integer when provided`);
              } else {
                const taxRate = taxRateMap.get(splitTaxRateId);
                if (!taxRate) {
                  pushSplitError(`${label}: tax_rate_id #${splitTaxRateId} does not exist or is inactive`);
                } else if (!taxRate.recoverable_account_id) {
                  pushSplitError(`${label}: selected tax rate has no recoverable_account_id configured`);
                } else if (splitPreTax) {
                  // PostgreSQL numeric may arrive as string depending on driver; Decimal handles both.
                  recoverableAccountId = Number(taxRate.recoverable_account_id);
                  recoverableAccountIds.add(recoverableAccountId);
                  recoverableAccountLabels.set(
                    recoverableAccountId,
                    [...(recoverableAccountLabels.get(recoverableAccountId) || []), label]
                  );
                  taxRateName = taxRate.name;
                  taxAmount = splitPreTax.times(dec(taxRate.rate)).toDecimalPlaces(2);
                }
              }
            }

            if (
              splitPreTax
              && splitRounding
              && splitAmount
              && Number.isInteger(splitExpenseAccountId)
              && splitExpenseAccountId > 0
              && Number.isInteger(splitFundId)
              && splitFundId > 0
            ) {
              const computedGross = splitPreTax.plus(taxAmount).plus(splitRounding).toDecimalPlaces(2);
              if (!computedGross.equals(splitAmount)) {
                pushSplitError(`${label}: amount ${splitAmount.toFixed(2)} must equal pre_tax + tax + rounding (${computedGross.toFixed(2)})`);
                return;
              }

              splitTotal = splitTotal.plus(computedGross).toDecimalPlaces(2);
              preparedSplits!.push({
                amount: computedGross,
                amount_fixed: computedGross.toFixed(2),
                fund_id: splitFundId,
                contact_id: rowPayeeId,
                memo: null,
                expense_account_id: splitExpenseAccountId,
                tax_rate_id: splitTaxRateId,
                tax_rate_name: taxRateName,
                recoverable_account_id: recoverableAccountId,
                pre_tax_amount: splitPreTax,
                pre_tax_amount_fixed: splitPreTax.toFixed(2),
                rounding_adjustment: splitRounding,
                rounding_adjustment_fixed: splitRounding.toFixed(2),
                tax_amount: taxAmount,
                tax_amount_fixed: taxAmount.toFixed(2),
                description: split?.description ? String(split.description).trim() || null : null,
              });
            }
          });

          if (!hasSplitValidationError && preparedSplits.length > 0 && !splitTotal.equals(amount)) {
            rowErrors.push(`Row ${rowNumber}: split total ${splitTotal.toFixed(2)} does not equal row amount ${amount.toFixed(2)}`);
          }
        } else if (!Number.isInteger(offsetAccountId) || offsetAccountId <= 0) {
          rowErrors.push(`Row ${rowNumber}: offset_account_id must be a positive integer`);
        } else {
          if (offsetAccountId === bankAccountId) {
            rowErrors.push(`Row ${rowNumber}: offset_account_id cannot be the same as bank_account_id`);
          }
          offsetAccountIds.add(offsetAccountId);
          const existingRows = offsetAccountRows.get(offsetAccountId) || [];
          existingRows.push(rowNumber);
          offsetAccountRows.set(offsetAccountId, existingRows);
        }

        if (billId !== undefined) {
          if (!Number.isInteger(billId) || billId <= 0) {
            rowErrors.push(`Row ${rowNumber}: bill_id must be a positive integer`);
          } else {
            billIds.add(billId);
            const existingRows = billRows.get(billId) || [];
            existingRows.push(rowNumber);
            billRows.set(billId, existingRows);
          }
        }

        if (rowType === 'deposit' && !hasSplits && billId === undefined && rowContactId !== null) {
          if (!Number.isInteger(rowContactId) || rowContactId <= 0) {
            rowErrors.push(`Row ${rowNumber}: contact_id must be a positive integer when provided`);
          } else {
            plainDepositContactIds.add(rowContactId);
            plainDepositContactRowLabels.set(
              rowContactId,
              [...(plainDepositContactRowLabels.get(rowContactId) || []), `Row ${rowNumber}`]
            );
          }
        }

        if (rowType === 'withdrawal' && !hasSplits && billId === undefined && rowPayeeId !== null) {
          if (!Number.isInteger(rowPayeeId) || rowPayeeId <= 0) {
            rowErrors.push(`Row ${rowNumber}: payee_id must be a positive integer when provided`);
          } else {
            payeeContactIds.add(rowPayeeId);
            payeeRowLabels.set(
              rowPayeeId,
              [...(payeeRowLabels.get(rowPayeeId) || []), `Row ${rowNumber}`]
            );
          }
        }

        if (rowErrors.length > 0) {
          errors.push(...rowErrors);
          return;
        }

        preparedRows.push({
          row_index: rowNumber,
          date: rowDate,
          description: rowDescription,
          normalized_description: normalizeImportDescription(rowDescription),
          reference_no: rowReferenceNo,
          amount,
          amount_fixed: amount.toFixed(2),
          type: rowType,
          offset_account_id: hasSplits ? 0 : offsetAccountId,
          payee_id: rowPayeeId,
          contact_id: rowType === 'deposit' && !hasSplits && billId === undefined ? rowContactId : null,
          bill_id: billId,
          splits: preparedSplits,
        });
      });

      if (offsetAccountIds.size > 0) {
        const offsetAccounts = await db('accounts')
          .whereIn('id', [...offsetAccountIds])
          .where('is_active', true) as AccountRow[];
        const activeIds = new Set(offsetAccounts.map((a) => a.id));
        for (const [id, rowNumbers] of offsetAccountRows.entries()) {
          if (!activeIds.has(id)) {
            rowNumbers.forEach((rowNumber) => {
              errors.push(`Row ${rowNumber}: offset account #${id} does not exist or is inactive`);
            });
          }
        }
      }

      if (splitFundIds.size > 0) {
        const splitFunds = await db('funds')
          .whereIn('id', [...splitFundIds])
          .where('is_active', true)
          .select('id') as { id: number }[];
        const foundIds = new Set(splitFunds.map((splitFund) => splitFund.id));
        for (const [id, labels] of splitFundRowLabels.entries()) {
          if (!foundIds.has(id)) {
            labels.forEach((label) => errors.push(`${label}: fund #${id} does not exist or is inactive`));
          }
        }
      }

      const allContactIds = new Set([...splitContactIds, ...payeeContactIds, ...plainDepositContactIds]);
      if (allContactIds.size > 0) {
        const contacts = await db('contacts')
          .whereIn('id', [...allContactIds])
          .where('is_active', true)
          .select('id') as { id: number }[];
        const foundIds = new Set(contacts.map((contact) => contact.id));

        for (const [id, labels] of splitContactRowLabels.entries()) {
          if (!foundIds.has(id)) labels.forEach((label) => errors.push(`${label}: contact #${id} does not exist or is inactive`));
        }
        for (const [id, labels] of payeeRowLabels.entries()) {
          if (!foundIds.has(id)) labels.forEach((label) => errors.push(`${label}: payee contact #${id} does not exist or is inactive`));
        }
        for (const [id, labels] of plainDepositContactRowLabels.entries()) {
          if (!foundIds.has(id)) labels.forEach((label) => errors.push(`${label}: contact #${id} does not exist or is inactive`));
        }
      }

      if (withdrawalExpenseAccountIds.size > 0) {
        const expenseAccounts = await db('accounts')
          .whereIn('id', [...withdrawalExpenseAccountIds])
          .where('is_active', true)
          .select('id', 'type') as Array<{ id: number; type: string }>;
        const expenseAccountMap = new Map(expenseAccounts.map((account) => [account.id, account]));

        for (const [id, labels] of withdrawalExpenseAccountLabels.entries()) {
          const account = expenseAccountMap.get(id);
          if (!account) {
            labels.forEach((label) => errors.push(`${label}: expense account #${id} does not exist or is inactive`));
            continue;
          }
          if (account.type !== 'EXPENSE') {
            labels.forEach((label) => errors.push(`${label}: expense account #${id} must be type EXPENSE`));
          }
        }
      }

      if (recoverableAccountIds.size > 0) {
        const recoverableAccounts = await db('accounts')
          .whereIn('id', [...recoverableAccountIds])
          .where('is_active', true)
          .select('id') as { id: number }[];
        const foundRecoverableIds = new Set(recoverableAccounts.map((account) => account.id));
        for (const [id, labels] of recoverableAccountLabels.entries()) {
          if (!foundRecoverableIds.has(id)) {
            labels.forEach((label) => errors.push(`${label}: recoverable account #${id} does not exist or is inactive`));
          }
        }
      }

      let roundingAccount: AccountRow | undefined;
      if (requiresRoundingAccount) {
        roundingAccount = await db('accounts')
          .where({ code: ROUNDING_ACCOUNT_CODE, is_active: true })
          .first() as AccountRow | undefined;
        if (!roundingAccount) {
          errors.push(`Rounding account ${ROUNDING_ACCOUNT_CODE} is missing or inactive`);
        }
      }

      for (const [id, rowNumbers] of billRows.entries()) {
        if (rowNumbers.length > 1) {
          errors.push(`The same bill cannot be linked to more than one row in the same import (bill #${id})`);
        }
      }

      if (billIds.size > 0) {
        const bills = await db('bills')
          .whereIn('id', [...billIds])
          .select('id', 'status', 'amount', 'amount_paid', 'transaction_id') as Array<{
            id: number;
            status: 'UNPAID' | 'PAID' | 'VOID';
            amount: string | number;
            amount_paid: string | number;
            transaction_id: number | null;
          }>;

        const billMap = new Map(bills.map((bill) => [bill.id, bill]));

        preparedRows.forEach((row) => {
          if (!row.bill_id) return;
          const bill = billMap.get(row.bill_id);
          if (!bill) {
            errors.push(`Row ${row.row_index}: bill #${row.bill_id} not found`);
            return;
          }

          if (bill.status !== 'UNPAID') {
            errors.push(`Row ${row.row_index}: bill #${row.bill_id} is not unpaid (status: ${bill.status})`);
            return;
          }

          const balanceDue = dec(bill.amount).minus(dec(bill.amount_paid));
          if (!balanceDue.equals(row.amount)) {
            errors.push(
              `Row ${row.row_index}: amount ${row.amount_fixed} does not match bill #${row.bill_id} balance due ${balanceDue.toFixed(2)}`
            );
          }

          if (!row.reference_no && bill.transaction_id) {
            errors.push(
              `Row ${row.row_index}: bill #${row.bill_id} already has a recorded payment and this row has no reference number`
            );
          }
        });
      }

      if (errors.length > 0) return res.status(400).json({ errors });

      const skippedRows: SkippedImportRow[] = [];
      const rowsToImport: PreparedImportRow[] = [];

      if (!force) {
        const referenceValues = [...new Set(preparedRows.map((r) => r.reference_no).filter((r): r is string => !!r))];
        const duplicateReferences = new Set<string>();

        if (referenceValues.length > 0) {
          const existingReferenceRows = await db('transactions as t')
            .join('journal_entries as je', 'je.transaction_id', 't.id')
            .where('je.account_id', bankAccountId)
            .whereIn('t.reference_no', referenceValues)
            .select('t.reference_no')
            .groupBy('t.reference_no') as Array<{ reference_no: string | null }>;

          for (const row of existingReferenceRows) {
            if (row.reference_no) duplicateReferences.add(row.reference_no);
          }
        }

        const noReferenceRows = preparedRows.filter((r) => !r.reference_no);
        const fallbackSignatures = new Set<string>();

        if (noReferenceRows.length > 0) {
          const uniqueDates = [...new Set(noReferenceRows.map((r) => r.date))];
          const candidates = await db('transactions as t')
            .join('journal_entries as je', 'je.transaction_id', 't.id')
            .where('je.account_id', bankAccountId)
            .whereIn('t.date', uniqueDates)
            .select('t.date', 't.description', 'je.debit', 'je.credit') as Array<{
              date: string;
              description: string;
              debit: string | number;
              credit: string | number;
            }>;

          for (const candidate of candidates) {
            const debit = dec(candidate.debit ?? 0);
            const credit = dec(candidate.credit ?? 0);
            const type = debit.greaterThan(0) ? 'deposit' : credit.greaterThan(0) ? 'withdrawal' : null;
            if (!type) continue;
            const amountFixed = type === 'deposit' ? debit.toFixed(2) : credit.toFixed(2);
            const normalizedDate = normalizeDateOnly(candidate.date);
            const normalizedDescription = normalizeImportDescription(candidate.description || '');
            fallbackSignatures.add(`${normalizedDate}|${normalizedDescription}|${amountFixed}|${type}`);
          }
        }

        for (const row of preparedRows) {
          const signature = `${row.date}|${row.normalized_description}|${row.amount_fixed}|${row.type}`;
          const isDuplicateReference = row.reference_no ? duplicateReferences.has(row.reference_no) : false;
          const isDuplicateFallback = !row.reference_no && fallbackSignatures.has(signature);

          if (isDuplicateReference || isDuplicateFallback) {
            skippedRows.push({
              row_index: row.row_index,
              reason: isDuplicateReference
                ? `Duplicate import detected for reference number ${row.reference_no}`
                : 'Duplicate import detected for date, description, amount, and type on this bank account',
              date: row.date,
              amount: parseFloat(row.amount_fixed),
              description: row.description,
              reference_no: row.reference_no,
            });
            continue;
          }

          rowsToImport.push(row);
        }
      } else {
        rowsToImport.push(...preparedRows);
      }

      if (rowsToImport.length === 0) {
        return res.json({
          imported: 0,
          skipped: skippedRows.length,
          skipped_rows: skippedRows,
        });
      }

      const billLinkedRows = rowsToImport.filter((row) => !!row.bill_id);
      const plainRows = rowsToImport.filter((row) => !row.bill_id);

      let paidBillRows = 0;
      let plainInsertedRows = 0;

      // payBill manages its own DB transaction; cross-row atomicity is limited until payBill accepts an external trx.
      for (const row of billLinkedRows) {
        const result = await payBill(
          String(row.bill_id),
          {
            payment_date: row.date,
            bank_account_id: bankAccountId,
            reference_no: row.reference_no || undefined,
          },
          req.user!.id
        );

        if (result.errors?.length) {
          return res.status(409).json({ errors: [`Row ${row.row_index}: ${result.errors.join(', ')}`] });
        }

        paidBillRows += 1;
      }

      if (plainRows.length > 0) {
        await db.transaction(async (trx: Knex.Transaction) => {
          const transactionIds: number[] = [];

          for (const row of plainRows) {
            await assertNotClosedPeriod(row.date, trx);

            const inserted = await trx('transactions')
              .insert({
                date: row.date,
                description: row.description,
                reference_no: row.reference_no,
                fund_id: fundId,
                created_by: req.user!.id,
                created_at: trx.fn.now(),
                updated_at: trx.fn.now(),
              })
              .returning('id') as Array<number | { id: number }>;

            const first = inserted[0];
            const transactionId = typeof first === 'number' ? first : first?.id;
            if (!transactionId) throw new Error(`Failed to create transaction for row ${row.row_index}`);
            transactionIds.push(transactionId);
          }

          const allEntries = plainRows.flatMap((row, idx) => {
            const transactionId = transactionIds[idx];
            const amountFixed = row.amount.toFixed(2);
            const withdrawalPayeeId = row.type === 'withdrawal' ? (row.payee_id ?? null) : null;
            if (row.type === 'withdrawal' && !withdrawalPayeeId) {
              throw new Error(`Missing payee for withdrawal split row ${row.row_index}`);
            }
            let bankContactId: number | null = null;
            if (row.type === 'withdrawal') {
              bankContactId = withdrawalPayeeId;
            } else if (row.splits?.length) {
              const hasAnonymous = row.splits.some((split) => split.contact_id == null);
              const uniqueContacts = [...new Set(
                row.splits
                  .map((split) => split.contact_id)
                  .filter((contactId): contactId is number => contactId != null),
              )];
              if (!hasAnonymous && uniqueContacts.length === 1 && typeof uniqueContacts[0] === 'number') {
                bankContactId = uniqueContacts[0];
              }
            } else {
              bankContactId = row.contact_id ?? null;
            }
            const bankEntry = {
              transaction_id: transactionId,
              account_id: bankAccountId,
              fund_id: fundId,
              contact_id: bankContactId,
              debit: row.type === 'deposit' ? amountFixed : '0.00',
              credit: row.type === 'deposit' ? '0.00' : amountFixed,
              memo: null,
              is_reconciled: false,
              created_at: trx.fn.now(),
              updated_at: trx.fn.now(),
            };

            const offsetEntries = row.splits?.length
              ? row.type === 'deposit'
                ? row.splits.map((split) => ({
                  transaction_id: transactionId,
                  account_id: split.offset_account_id,
                  fund_id: split.fund_id,
                  contact_id: split.contact_id,
                  debit: '0.00',
                  credit: split.amount_fixed,
                  memo: split.memo,
                  is_reconciled: false,
                  created_at: trx.fn.now(),
                  updated_at: trx.fn.now(),
                }))
                : row.splits.flatMap((split) => {
                  const entries = [];

                  entries.push({
                    transaction_id: transactionId,
                    account_id: Number(split.expense_account_id),
                    fund_id: split.fund_id,
                    contact_id: withdrawalPayeeId,
                    debit: split.pre_tax_amount_fixed || '0.00',
                    credit: '0.00',
                    memo: split.description || row.description,
                    is_reconciled: false,
                    created_at: trx.fn.now(),
                    updated_at: trx.fn.now(),
                  });

                  if (split.tax_amount && split.tax_amount.gt(0) && split.recoverable_account_id) {
                    entries.push({
                      transaction_id: transactionId,
                      account_id: Number(split.recoverable_account_id),
                      fund_id: split.fund_id,
                      contact_id: withdrawalPayeeId,
                      debit: split.tax_amount_fixed || '0.00',
                      credit: '0.00',
                      memo: `${split.tax_rate_name || 'Tax'} on ${split.description || row.description}`,
                      is_reconciled: false,
                      created_at: trx.fn.now(),
                      updated_at: trx.fn.now(),
                    });
                  }

                  if (split.rounding_adjustment && !split.rounding_adjustment.isZero() && roundingAccount) {
                    entries.push({
                      transaction_id: transactionId,
                      account_id: roundingAccount.id,
                      fund_id: split.fund_id,
                      contact_id: withdrawalPayeeId,
                      debit: split.rounding_adjustment.gt(0) ? split.rounding_adjustment_fixed || '0.00' : '0.00',
                      credit: split.rounding_adjustment.lt(0) ? split.rounding_adjustment.abs().toFixed(2) : '0.00',
                      memo: split.description
                        ? `Rounding adjustment - ${split.description}`
                        : 'Rounding adjustment',
                      is_reconciled: false,
                      created_at: trx.fn.now(),
                      updated_at: trx.fn.now(),
                    });
                  }

                  return entries;
                })
              : [{
                transaction_id: transactionId,
                account_id: row.offset_account_id,
                fund_id: fundId,
                contact_id: row.type === 'deposit' ? row.contact_id : withdrawalPayeeId,
                debit: row.type === 'deposit' ? '0.00' : amountFixed,
                credit: row.type === 'deposit' ? amountFixed : '0.00',
                memo: null,
                is_reconciled: false,
                created_at: trx.fn.now(),
                updated_at: trx.fn.now(),
              }];

            return [bankEntry, ...offsetEntries];
          });

          await trx('journal_entries').insert(allEntries);
        });

        plainInsertedRows = plainRows.length;
      }

      return res.json({
        imported: paidBillRows + plainInsertedRows,
        skipped: skippedRows.length,
        skipped_rows: skippedRows,
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
