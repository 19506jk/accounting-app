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
  TransactionEntryDetail,
  TransactionListItem,
  TransactionResponse,
  TransactionsListResponse,
  TransactionsQuery,
  UpdateTransactionInput,
} from '@shared/contracts';
import type {
  AccountRow,
  FundRow,
  JournalEntryRow,
  TransactionEntryDetailRow,
  TransactionListRow,
  TransactionRow,
} from '../types/db';
import { addDaysDateOnly, compareDateOnly, getChurchToday, normalizeDateOnly, parseDateOnlyStrict } from '../utils/date.js';
import { getChurchTimeZone } from '../services/churchTimeZone.js';

const db = require('../db');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
import billService = require('../services/bills');

const router = express.Router();
router.use(auth);

const dec = (v: Decimal.Value) => new Decimal(v ?? 0);
const normalizeImportDescription = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const normalizeImportReference = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
};

const { payBill } = billService;

async function validateTransaction(body: CreateTransactionInput): Promise<string[]> {
  const errors: string[] = [];
  const { date, description, entries } = body;

  if (!date) errors.push('date is required');
  if (!description?.trim()) errors.push('description is required');

  if (!Array.isArray(entries) || entries.length < 2) {
    errors.push('At least 2 journal entry lines are required');
    return errors;
  }

  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    if (!e) continue;
    const prefix = `Entry ${i + 1}:`;

    if (!e.account_id) errors.push(`${prefix} account_id is required`);
    if (!e.fund_id) errors.push(`${prefix} fund_id is required`);

    const debit = dec(e.debit ?? 0);
    const credit = dec(e.credit ?? 0);

    if (debit.isNegative() || credit.isNegative()) errors.push(`${prefix} amounts must be positive`);
    if (debit.isZero() && credit.isZero()) errors.push(`${prefix} must have either a debit or credit amount`);
    if (!debit.isZero() && !credit.isZero()) errors.push(`${prefix} cannot have both debit and credit amounts`);
    if (debit.decimalPlaces() > 2) errors.push(`${prefix} debit cannot have more than 2 decimal places`);
    if (credit.decimalPlaces() > 2) errors.push(`${prefix} credit cannot have more than 2 decimal places`);
  }

  if (errors.length) return errors;

  const totalDebit = entries.reduce((sum, e) => sum.plus(dec(e.debit ?? 0)), dec(0));
  if (totalDebit.isZero()) {
    errors.push('Transaction total cannot be zero');
    return errors;
  }

  const totalCredit = entries.reduce((sum, e) => sum.plus(dec(e.credit ?? 0)), dec(0));
  if (!totalDebit.equals(totalCredit)) {
    errors.push(`Transaction is not balanced. Debits $${totalDebit.toFixed(2)} ≠ credits $${totalCredit.toFixed(2)}`);
  }

  const fundTotals: Record<string, { debit: Decimal; credit: Decimal }> = {};
  for (const e of entries) {
    const fundId = String(e.fund_id);
    if (!fundTotals[fundId]) fundTotals[fundId] = { debit: dec(0), credit: dec(0) };
    fundTotals[fundId].debit = fundTotals[fundId].debit.plus(dec(e.debit ?? 0));
    fundTotals[fundId].credit = fundTotals[fundId].credit.plus(dec(e.credit ?? 0));
  }

  for (const [fundId, totals] of Object.entries(fundTotals)) {
    if (!totals.debit.equals(totals.credit)) {
      const fund = await db('funds').where({ id: fundId }).first() as FundRow | undefined;
      const name = fund?.name || `Fund #${fundId}`;
      errors.push(`"${name}" is not balanced. Debits $${totals.debit.toFixed(2)} ≠ credits $${totals.credit.toFixed(2)}`);
    }
  }

  if (errors.length) return errors;

  if (date) {
    if (!parseDateOnlyStrict(date)) {
      errors.push('date is not a valid date (YYYY-MM-DD)');
    } else {
      const timezone = getChurchTimeZone();
      const churchToday = getChurchToday(timezone);
      const maxAllowedDate = addDaysDateOnly(churchToday, 1, timezone);
      if (compareDateOnly(date, maxAllowedDate) > 0) {
        errors.push('Transaction date cannot be more than 1 day in the future');
      }
    }
  }

  const accountIds = [...new Set(entries.map((e) => e.account_id))];
  const accounts = await db('accounts').whereIn('id', accountIds).where('is_active', true) as AccountRow[];
  const foundAccIds = new Set(accounts.map((a) => a.id));
  for (const id of accountIds) {
    if (!foundAccIds.has(id)) errors.push(`Account #${id} does not exist or is inactive`);
  }

  const fundIds = [...new Set(entries.map((e) => e.fund_id))];
  const funds = await db('funds').whereIn('id', fundIds).where('is_active', true) as FundRow[];
  const foundFundIds = new Set(funds.map((f) => f.id));
  for (const id of fundIds) {
    if (!foundFundIds.has(id)) errors.push(`Fund #${id} does not exist or is inactive`);
  }

  const entryContactIds = [...new Set(entries.map((e) => e.contact_id).filter(Boolean))] as number[];
  if (entryContactIds.length > 0) {
    const entryContacts = await db('contacts').whereIn('id', entryContactIds).where('is_active', true) as { id: number }[];
    const foundContactIds = new Set(entryContacts.map((c) => c.id));
    for (const id of entryContactIds) {
      if (!foundContactIds.has(id)) errors.push(`Contact #${id} does not exist or is inactive`);
    }
  }

  return errors;
}

async function getTransactionDetailById(id: string | number): Promise<TransactionDetail | null> {
  const transaction = await db('transactions as t')
    .leftJoin('users as u', 'u.id', 't.created_by')
    .where('t.id', id)
    .select(
      't.id',
      't.date',
      't.description',
      't.reference_no',
      't.fund_id',
      't.created_at',
      'u.name as created_by_name'
    )
    .first() as (TransactionRow & { created_by_name: string | null }) | undefined;

  if (!transaction) return null;

  const entries = await db('journal_entries as je')
    .join('accounts as a', 'a.id', 'je.account_id')
    .join('funds as f', 'f.id', 'je.fund_id')
    .leftJoin('contacts as c', 'c.id', 'je.contact_id')
    .where('je.transaction_id', id)
    .select(
      'je.id',
      'je.account_id',
      'a.code as account_code',
      'a.name as account_name',
      'a.type as account_type',
      'je.fund_id',
      'f.name as fund_name',
      'je.debit',
      'je.credit',
      'je.memo',
      'je.is_reconciled',
      'je.contact_id',
      'c.name as contact_name'
    )
    .orderBy('je.id', 'asc') as TransactionEntryDetailRow[];

  const totalAmount = entries.reduce((sum, e) => sum.plus(dec(e.debit)), dec(0));

  return {
    ...transaction,
    date: normalizeDateOnly(transaction.date),
    created_at: String(transaction.created_at),
    total_amount: parseFloat(totalAmount.toFixed(2)),
    entries: entries.map((e) => ({
      ...e,
      debit: parseFloat(String(e.debit)),
      credit: parseFloat(String(e.credit)),
    })) as TransactionEntryDetail[],
  };
}

router.get(
  '/',
  async (
    req: Request<{}, TransactionsListResponse | ApiErrorResponse, unknown, TransactionsQuery>,
    res: Response<TransactionsListResponse | ApiErrorResponse>,
    next: NextFunction
  ) => {
    try {
      const { fund_id, account_id, contact_id, from, to, limit = 50, offset = 0 } = req.query;
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
        .select(
          't.id',
          't.date',
          't.description',
          't.reference_no',
          't.fund_id',
          't.created_at',
          'u.name as created_by_name',
          db.raw('COALESCE(je_totals.total_amount, 0) AS total_amount')
        )
        .orderBy('t.date', 'desc')
        .orderBy('t.created_at', 'desc')
        .limit(cap)
        .offset(off) as TransactionListRow[];

      const mapped: TransactionListItem[] = transactions.map((t) => ({
        ...t,
        date: normalizeDateOnly(t.date),
        created_at: String(t.created_at),
        total_amount: parseFloat(String(t.total_amount)),
      }));

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

      type PreparedSplit = {
        amount: Decimal;
        amount_fixed: string;
        offset_account_id: number;
        fund_id: number;
        contact_id: number | null;
        memo: string | null;
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
        bill_id?: number;
        splits?: PreparedSplit[];
      };

      const preparedRows: PreparedImportRow[] = [];
      const offsetAccountIds = new Set<number>();
      const offsetAccountRows = new Map<number, number[]>();
      const billIds = new Set<number>();
      const billRows = new Map<number, number[]>();

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
          amount = dec(row.amount);
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

          row.splits!.forEach((split, splitIdx) => {
            const splitNumber = splitIdx + 1;
            const splitAmountRaw = split?.amount;
            const splitOffsetAccountId = Number(split?.offset_account_id);
            const splitFundId = Number(split?.fund_id);
            const splitContactId = split?.contact_id === undefined || split?.contact_id === null ? null : Number(split.contact_id);

            let splitAmount: Decimal | null = null;
            try {
              splitAmount = dec(splitAmountRaw);
            } catch {
              pushSplitError(`Row ${rowNumber}, split ${splitNumber}: amount is invalid`);
            }

            if (splitAmount) {
              if (splitAmount.isZero() || splitAmount.isNegative()) {
                pushSplitError(`Row ${rowNumber}, split ${splitNumber}: amount must be greater than 0`);
              } else if (splitAmount.decimalPlaces() > 2) {
                pushSplitError(`Row ${rowNumber}, split ${splitNumber}: amount cannot have more than 2 decimal places`);
              }
            }

            if (!Number.isInteger(splitOffsetAccountId) || splitOffsetAccountId <= 0) {
              pushSplitError(`Row ${rowNumber}, split ${splitNumber}: offset_account_id must be a positive integer`);
            } else if (splitOffsetAccountId === bankAccountId) {
              pushSplitError(`Row ${rowNumber}, split ${splitNumber}: offset_account_id cannot be the same as bank_account_id`);
            }

            if (!Number.isInteger(splitFundId) || splitFundId <= 0) {
              pushSplitError(`Row ${rowNumber}, split ${splitNumber}: fund_id must be a positive integer`);
            }

            if (splitContactId !== null && (!Number.isInteger(splitContactId) || splitContactId <= 0)) {
              pushSplitError(`Row ${rowNumber}, split ${splitNumber}: contact_id must be a positive integer when provided`);
            }

            if (splitAmount && Number.isInteger(splitOffsetAccountId) && splitOffsetAccountId > 0 && Number.isInteger(splitFundId) && splitFundId > 0) {
              splitTotal = splitTotal.plus(splitAmount);

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

      const splitContactIds = new Set<number>();
      const splitContactRowLabels = new Map<number, string[]>();
      const splitFundIds = new Set<number>();
      const splitFundRowLabels = new Map<number, string[]>();

      preparedRows.forEach((row) => {
        row.splits?.forEach((split, splitIdx) => {
          const label = `Row ${row.row_index}, split ${splitIdx + 1}`;
          splitFundIds.add(split.fund_id);
          splitFundRowLabels.set(split.fund_id, [...(splitFundRowLabels.get(split.fund_id) || []), label]);
          if (!split.contact_id) return;
          splitContactIds.add(split.contact_id);
          splitContactRowLabels.set(split.contact_id, [...(splitContactRowLabels.get(split.contact_id) || []), label]);
        });
      });

      if (splitContactIds.size > 0) {
        const contacts = await db('contacts')
          .whereIn('id', [...splitContactIds])
          .where('is_active', true)
          .select('id') as { id: number }[];
        const foundIds = new Set(contacts.map((contact) => contact.id));
        for (const [id, labels] of splitContactRowLabels.entries()) {
          if (!foundIds.has(id)) {
            labels.forEach((label) => errors.push(`${label}: contact #${id} does not exist or is inactive`));
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
            const bankEntry = {
              transaction_id: transactionId,
              account_id: bankAccountId,
              fund_id: fundId,
              contact_id: null,
              debit: row.type === 'deposit' ? amountFixed : '0.00',
              credit: row.type === 'deposit' ? '0.00' : amountFixed,
              memo: null,
              is_reconciled: false,
              created_at: trx.fn.now(),
              updated_at: trx.fn.now(),
            };

            const offsetEntries = row.splits?.length
              ? row.splits.map((split) => ({
                transaction_id: transactionId,
                account_id: split.offset_account_id,
                fund_id: split.fund_id,
                contact_id: split.contact_id,
                debit: row.type === 'deposit' ? '0.00' : split.amount_fixed,
                credit: row.type === 'deposit' ? split.amount_fixed : '0.00',
                memo: split.memo,
                is_reconciled: false,
                created_at: trx.fn.now(),
                updated_at: trx.fn.now(),
              }))
              : [{
                transaction_id: transactionId,
                account_id: row.offset_account_id,
                fund_id: fundId,
                contact_id: null,
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
      const detail = await getTransactionDetailById(id);
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
      const { date, description, reference_no, entries } = req.body || {};

      const errors = await validateTransaction(req.body);
      if (errors.length) return res.status(400).json({ errors });

      const result: { transaction: TransactionRow; entries: JournalEntryRow[] } = await db.transaction(async (trx: Knex.Transaction) => {
        const firstEntry = entries[0];
        if (!firstEntry) throw new Error('At least one entry is required');

        const [transaction] = await trx('transactions')
          .insert({
            date,
            description: description.trim(),
            reference_no: reference_no?.trim() || null,
            fund_id: firstEntry.fund_id,
            created_by: req.user!.id,
            created_at: trx.fn.now(),
            updated_at: trx.fn.now(),
          })
          .returning('*') as TransactionRow[];
        if (!transaction) throw new Error('Failed to create transaction');

        const entryRows = entries.map((e) => ({
          transaction_id: transaction.id,
          account_id: e.account_id,
          fund_id: e.fund_id,
          contact_id: e.contact_id || null,
          debit: dec(e.debit ?? 0).toFixed(2),
          credit: dec(e.credit ?? 0).toFixed(2),
          memo: e.memo?.trim() || null,
          is_reconciled: false,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        }));

        const insertedEntries = await trx('journal_entries').insert(entryRows).returning('*') as JournalEntryRow[];
        return { transaction, entries: insertedEntries };
      });

      const payload: TransactionCreateResult = {
        ...result.transaction,
        date: normalizeDateOnly(result.transaction.date),
        created_at: String(result.transaction.created_at),
        updated_at: String(result.transaction.updated_at),
        entries: result.entries.map((e) => ({
          ...e,
          created_at: String(e.created_at),
          updated_at: String(e.updated_at),
          debit: parseFloat(String(e.debit)),
          credit: parseFloat(String(e.credit)),
        })),
      };

      res.status(201).json({ transaction: payload });
    } catch (err) {
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
      const { date, description, reference_no, entries } = req.body || {};

      const transaction = await db('transactions').where({ id }).first() as TransactionRow | undefined;
      if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

      if (date) {
        if (!parseDateOnlyStrict(date)) {
          return res.status(400).json({ error: 'date is not a valid date (YYYY-MM-DD)' });
        }
        const timezone = getChurchTimeZone();
        const today = getChurchToday(timezone);
        const maxDate = addDaysDateOnly(today, 1, timezone);
        if (compareDateOnly(date, maxDate) > 0) {
          return res.status(400).json({ error: 'Transaction date cannot be more than 1 day in the future' });
        }
      }

      const nextDate = date || normalizeDateOnly(transaction.date);
      const nextDescription = description?.trim() || transaction.description;
      const nextReferenceNo = reference_no !== undefined ? reference_no?.trim() || null : transaction.reference_no;

      await db.transaction(async (trx: Knex.Transaction) => {
        if (entries !== undefined) {
          const validationPayload: CreateTransactionInput = {
            date: nextDate,
            description: nextDescription,
            reference_no: nextReferenceNo ?? undefined,
            entries,
          };
          const errors = await validateTransaction(validationPayload);
          if (errors.length) {
            throw Object.assign(new Error('Validation failed'), { statusCode: 400, validationErrors: errors });
          }

          const existingEntries = await trx('journal_entries')
            .where({ transaction_id: id })
            .orderBy('id', 'asc') as JournalEntryRow[];

          const isAnyReconciled = existingEntries.some((e) => e.is_reconciled);

          if (isAnyReconciled) {
            if (entries.length !== existingEntries.length) {
              throw Object.assign(new Error('Cannot add/remove lines on reconciled transactions'), { statusCode: 400 });
            }

            for (let i = 0; i < entries.length; i += 1) {
              const incoming = entries[i];
              const current = existingEntries[i];
              if (!incoming || !current) {
                throw Object.assign(new Error('Invalid journal entry payload'), { statusCode: 400 });
              }

              const incomingDebit = dec(incoming.debit ?? 0).toFixed(2);
              const currentDebit = dec(current.debit ?? 0).toFixed(2);
              const incomingCredit = dec(incoming.credit ?? 0).toFixed(2);
              const currentCredit = dec(current.credit ?? 0).toFixed(2);
              const incomingMemo = incoming.memo?.trim() || null;
              const currentMemo = current.memo || null;
              const accountChanged = Number(incoming.account_id) !== Number(current.account_id);
              const fundChanged = Number(incoming.fund_id) !== Number(current.fund_id);
              const debitChanged = incomingDebit !== currentDebit;
              const creditChanged = incomingCredit !== currentCredit;
              const memoChanged = incomingMemo !== currentMemo;

              if (accountChanged || fundChanged || debitChanged || creditChanged || memoChanged) {
                throw Object.assign(new Error('Reconciled transactions only allow donor/payee changes'), { statusCode: 400 });
              }
            }

            for (let i = 0; i < entries.length; i += 1) {
              const incoming = entries[i];
              const current = existingEntries[i];
              if (!incoming || !current) continue;

              const incomingContactId = incoming.contact_id ? Number(incoming.contact_id) : null;
              const currentContactId = current.contact_id ? Number(current.contact_id) : null;
              if (incomingContactId === currentContactId) continue;

              await trx('journal_entries')
                .where({ id: current.id })
                .update({
                  contact_id: incomingContactId,
                  updated_at: trx.fn.now(),
                });
            }
          } else {
            await trx('journal_entries')
              .where({ transaction_id: id })
              .delete();

            const entryRows = entries.map((e) => ({
              transaction_id: Number(id),
              account_id: e.account_id,
              fund_id: e.fund_id,
              contact_id: e.contact_id || null,
              debit: dec(e.debit ?? 0).toFixed(2),
              credit: dec(e.credit ?? 0).toFixed(2),
              memo: e.memo?.trim() || null,
              is_reconciled: false,
              created_at: trx.fn.now(),
              updated_at: trx.fn.now(),
            }));
            await trx('journal_entries').insert(entryRows);
          }
        }

        const nextFundId = entries?.[0]?.fund_id ?? transaction.fund_id;

        const [updated] = await trx('transactions')
          .where({ id })
          .update({
            date: nextDate,
            description: nextDescription,
            reference_no: nextReferenceNo,
            fund_id: nextFundId,
            updated_at: trx.fn.now(),
          })
          .returning('*') as TransactionRow[];
        if (!updated) throw new Error('Failed to update transaction');
      });

      const detail = await getTransactionDetailById(id);
      if (!detail) return res.status(404).json({ error: 'Transaction not found' });

      res.json({
        transaction: detail,
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

      const transaction = await db('transactions').where({ id }).first() as TransactionRow | undefined;
      if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

      const reconciledEntry = await db('journal_entries')
        .where({ transaction_id: id, is_reconciled: true })
        .first() as JournalEntryRow | undefined;

      if (reconciledEntry) {
        return res.status(409).json({
          error: 'Transaction cannot be deleted — one or more entries have been reconciled.',
        });
      }

      await db('transactions').where({ id }).delete();
      res.json({ message: 'Transaction deleted successfully' });
    } catch (err) {
      next(err);
    }
  }
);

export = router;
