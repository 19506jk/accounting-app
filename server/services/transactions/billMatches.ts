import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type {
  BillMatchSuggestion,
  GetBillMatchRowInput,
  GetBillMatchesInput,
  GetBillMatchesResult,
} from '@shared/contracts';
import { addDaysDateOnly, normalizeDateOnly, parseDateOnlyStrict } from '../../utils/date.js';
import { getChurchTimeZone } from '../churchTimeZone.js';

const db = require('../../db') as Knex;

const dec = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);

function validationError(errors: string[]) {
  return Object.assign(new Error('Bill match validation failed'), {
    status: 400,
    statusCode: 400,
    validationErrors: errors,
  });
}

async function getBillMatchSuggestions(payload: GetBillMatchesInput): Promise<GetBillMatchesResult> {
  const body = payload || {} as GetBillMatchesInput;
  const errors: string[] = [];
  const bankAccountId = Number(body.bank_account_id);
  const rows = body.rows;

  if (!Number.isInteger(bankAccountId) || bankAccountId <= 0) errors.push('bank_account_id must be a positive integer');
  if (!Array.isArray(rows) || rows.length === 0) errors.push('rows must be a non-empty array');
  if (Array.isArray(rows) && rows.length > 500) errors.push('rows cannot exceed 500');
  if (errors.length > 0) throw validationError(errors);

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

  if (errors.length > 0) throw validationError(errors);
  if (preparedRows.length === 0) return { suggestions: [] };

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
    .whereIn(db.raw('(b.amount - b.amount_paid)') as unknown as string, uniqueAmounts)
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
      .whereIn(db.raw('(b.amount - b.amount_paid)') as unknown as string, unresolvedAmounts)
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

  return { suggestions };
}

export = {
  getBillMatchSuggestions,
};
