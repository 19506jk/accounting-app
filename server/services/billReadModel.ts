import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type { BillCreditApplication, BillDetail } from '@shared/contracts';
import { normalizeDateOnly, toUtcIsoString } from '../utils/date.js';

const db = require('../db') as Knex;

type Numeric = string | number;

interface BillJoinedRow {
  id: number;
  contact_id: number;
  date: string | Date;
  due_date: string | Date | null;
  bill_number: string | null;
  description: string;
  amount: Numeric;
  amount_paid: Numeric;
  status: 'UNPAID' | 'PAID' | 'VOID';
  fund_id: number;
  transaction_id: number | null;
  created_transaction_id: number | null;
  created_by: number;
  paid_by: number | null;
  paid_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
  vendor_name: string | null;
  vendor_email: string | null;
  vendor_phone: string | null;
  fund_name: string | null;
  created_by_name: string | null;
  paid_by_name: string | null;
}

interface BillLineItemJoinedRow {
  id: number;
  expense_account_id: number;
  amount: Numeric;
  rounding_adjustment: Numeric;
  description: string | null;
  tax_rate_id: number | null;
  expense_account_code: string;
  expense_account_name: string;
  tax_rate_name: string | null;
  tax_rate_value: Numeric | null;
}

export interface ApplicationJoinedRow {
  id: number;
  target_bill_id: number;
  credit_bill_id: number;
  amount: Numeric;
  apply_transaction_id: number | null;
  applied_by: number;
  applied_at: string | Date;
  unapplied_by: number | null;
  unapplied_at: string | Date | null;
  applied_by_name: string | null;
  credit_bill_number: string | null;
  credit_bill_date: string | Date;
}

const dec = (value: Numeric | null | undefined) => new Decimal(value ?? 0);
const asDateOnlyString = (value: string | Date) => normalizeDateOnly(value);
const asDateTimeString = (value: string | Date) => toUtcIsoString(value);

function getOutstanding(amount: Numeric, amountPaid: Numeric) {
  return dec(amount).minus(dec(amountPaid));
}

export function normaliseApplications(rows: ApplicationJoinedRow[]): BillCreditApplication[] {
  return rows.map((row) => ({
    id: row.id,
    target_bill_id: row.target_bill_id,
    credit_bill_id: row.credit_bill_id,
    amount: parseFloat(String(row.amount)),
    apply_transaction_id: row.apply_transaction_id,
    applied_by: row.applied_by,
    applied_by_name: row.applied_by_name,
    applied_at: asDateTimeString(row.applied_at),
    unapplied_at: row.unapplied_at ? asDateTimeString(row.unapplied_at) : null,
    credit_bill_number: row.credit_bill_number,
    credit_bill_date: asDateOnlyString(row.credit_bill_date),
  }));
}

export async function getBillWithLineItems(
  billId: string | number,
  executor: Knex | Knex.Transaction = db
): Promise<BillDetail | null> {
  const bill = await executor('bills as b')
    .leftJoin('contacts as c', 'c.id', 'b.contact_id')
    .leftJoin('funds as f', 'f.id', 'b.fund_id')
    .leftJoin('users as created_by', 'created_by.id', 'b.created_by')
    .leftJoin('users as paid_by', 'paid_by.id', 'b.paid_by')
    .where('b.id', billId)
    .select(
      'b.*',
      'c.name as vendor_name',
      'c.email as vendor_email',
      'c.phone as vendor_phone',
      'f.name as fund_name',
      'created_by.name as created_by_name',
      'paid_by.name as paid_by_name',
    )
    .first() as BillJoinedRow | undefined;

  if (!bill) return null;

  const lineItems = await executor('bill_line_items as bli')
    .join('accounts as a', 'a.id', 'bli.expense_account_id')
    .leftJoin('tax_rates as tr', 'tr.id', 'bli.tax_rate_id')
    .where('bli.bill_id', billId)
    .select(
      'bli.*',
      'a.code as expense_account_code',
      'a.name as expense_account_name',
      'tr.name as tax_rate_name',
      'tr.rate as tax_rate_value',
    ) as BillLineItemJoinedRow[];

  const appliedCreditRows = await executor('bill_credit_applications as bca')
    .leftJoin('users as u', 'u.id', 'bca.applied_by')
    .leftJoin('bills as cb', 'cb.id', 'bca.credit_bill_id')
    .where('bca.target_bill_id', billId)
    .whereNull('bca.unapplied_at')
    .orderBy('bca.applied_at', 'asc')
    .select(
      'bca.*',
      'u.name as applied_by_name',
      'cb.bill_number as credit_bill_number',
      'cb.date as credit_bill_date'
    ) as ApplicationJoinedRow[];

  const availableCreditRows = await executor('bills as b')
    .where({
      contact_id: bill.contact_id,
      fund_id: bill.fund_id,
      status: 'UNPAID',
    })
    .where('b.amount', '<', 0)
    .where('b.id', '<>', bill.id)
    .select('b.amount', 'b.amount_paid') as Array<{ amount: Numeric; amount_paid: Numeric }>;

  const availableCreditTotal = availableCreditRows.reduce((sum, row) => {
    const outstanding = getOutstanding(row.amount, row.amount_paid);
    if (outstanding.gte(0)) return sum;
    return sum.plus(outstanding.abs());
  }, dec(0));

  return {
    ...bill,
    date: asDateOnlyString(bill.date),
    due_date: bill.due_date ? asDateOnlyString(bill.due_date) : null,
    paid_at: bill.paid_at ? asDateTimeString(bill.paid_at) : null,
    created_at: asDateTimeString(bill.created_at),
    updated_at: asDateTimeString(bill.updated_at),
    amount: parseFloat(String(bill.amount)),
    amount_paid: parseFloat(String(bill.amount_paid)),
    available_credit_total: parseFloat(availableCreditTotal.toFixed(2)),
    applied_credits: normaliseApplications(appliedCreditRows),
    line_items: lineItems.map(li => ({
      id: li.id,
      expense_account_id: li.expense_account_id,
      expense_account_code: li.expense_account_code,
      expense_account_name: li.expense_account_name,
      amount: parseFloat(String(li.amount)),
      rounding_adjustment: parseFloat(String(li.rounding_adjustment ?? 0)),
      description: li.description,
      tax_rate_id: li.tax_rate_id || null,
      tax_rate_name: li.tax_rate_name || null,
      tax_rate_value: li.tax_rate_value ? parseFloat(String(li.tax_rate_value)) : null,
      tax_amount: li.tax_rate_id
        ? parseFloat(
            dec(li.amount).times(dec(li.tax_rate_value)).toDecimalPlaces(2).toFixed(2)
          )
        : null,
    })),
  } as BillDetail;
}
