import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type {
  ApplyBillCreditsInput,
  AvailableBillCredit,
  BillAgingReportResponse,
  BillCreditApplication,
  BillDetail,
  BillLineItemInput,
  BillSummaryResponse,
  CreateBillInput,
  PayBillInput,
  UpdateBillInput,
} from '@shared/contracts';
import type { BillCreditApplicationRow, BillRow, TransactionRow } from '../types/db';
import {
  compareDateOnly,
  getChurchToday,
  isValidDateOnly,
  normalizeDateOnly,
  parseDateOnlyStrict,
  toUtcIsoString,
} from '../utils/date.js';
import { getChurchTimeZone } from './churchTimeZone.js';
import { assertNotClosedPeriod } from '../utils/hardCloseGuard.js';

const db = require('../db') as Knex;

type Numeric = string | number;

type BillServiceResult = { errors: string[]; outstanding?: number } | { errors?: undefined };
type BillMutationResult = BillServiceResult & { bill?: BillDetail | null; transaction?: TransactionRow | null };

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

interface TaxRateRow {
  id: number;
  name: string;
  rate: Numeric;
  recoverable_account_id: number;
}

interface AccountRow {
  id: number;
  code: string;
  type: string;
  is_active?: boolean;
}

interface ContactRow {
  id: number;
  type: 'DONOR' | 'PAYEE' | 'BOTH';
  name: string;
}

interface FundRow {
  id: number;
}

interface UnpaidSummaryRow {
  count: string | number;
  total_outstanding: Numeric | null;
  earliest_due: string | null;
}

interface AgingSourceBillRow {
  id: number;
  contact_id: number;
  vendor_name: string;
  bill_number: string | null;
  description: string;
  amount: Numeric;
  amount_paid: Numeric;
  due_date: string | Date | null;
}

interface JournalEntryInsertRow {
  transaction_id: number;
  account_id: number;
  fund_id: number;
  contact_id?: number | null;
  debit: Numeric;
  credit: Numeric;
  memo: string;
  is_reconciled: boolean;
  tax_rate_id: number | null;
  is_tax_line: boolean;
  created_at: unknown;
  updated_at: unknown;
}

interface BillLineItemComparisonRow {
  expense_account_id: number;
  amount: Numeric;
  rounding_adjustment: Numeric;
  description: string | null;
  tax_rate_id: number | null;
}

type AgingBill = AgingSourceBillRow & {
  amount: number;
  amount_paid: number;
  due_date: string;
  outstanding: number;
  days_overdue: number;
};

type AgingBucket = {
  current: AgingBill[];
  days31_60: AgingBill[];
  days61_90: AgingBill[];
  days90_plus: AgingBill[];
};

type VendorAgingItem = {
  vendor_name: string;
  contact_id: number;
  current: number;
  days31_60: number;
  days61_90: number;
  days90_plus: number;
  total: number;
};

interface ApplicationJoinedRow {
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

const ROUNDING_ACCOUNT_CODE = '59999';
const AP_ACCOUNT_CODE = '20000';
const TOLERANCE = 0.01;
const SETTLEMENT_TOLERANCE = new Decimal('0.01');

function getOutstanding(amount: Numeric, amountPaid: Numeric) {
  return dec(amount).minus(dec(amountPaid));
}

function isSettledOutstanding(outstanding: Decimal) {
  return outstanding.abs().lt(SETTLEMENT_TOLERANCE);
}

function toBillStatus(outstanding: Decimal): BillRow['status'] {
  return isSettledOutstanding(outstanding) ? 'PAID' : 'UNPAID';
}

function getAmountPaidFromOutstanding(amount: Numeric, outstanding: Decimal) {
  return dec(amount).minus(outstanding).toFixed(2);
}

function formatBillReference(bill: Pick<BillRow, 'id' | 'bill_number'>) {
  return bill.bill_number ? `#${bill.bill_number}` : `#${bill.id}`;
}

function normaliseApplications(rows: ApplicationJoinedRow[]): BillCreditApplication[] {
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

function validateBillData(data: CreateBillInput | UpdateBillInput, isUpdate = false): string[] {
  const errors: string[] = [];

  if (!isUpdate || data.contact_id !== undefined) {
    if (!data.contact_id) errors.push('contact_id (vendor) is required');
  }

  if (!isUpdate || data.date !== undefined) {
    if (!data.date) errors.push('date is required');
    else if (!isValidDateOnly(data.date)) errors.push('date must be a valid date (YYYY-MM-DD)');
  }

  // due_date is now optional - no validation needed

  // description is now optional - no validation needed

  if (!isUpdate || data.amount !== undefined) {
    if (data.amount === undefined || data.amount === null) errors.push('amount is required');
    else if (dec(data.amount).decimalPlaces() > 2) errors.push('amount cannot have more than 2 decimal places');
  }

  if (!isUpdate || data.fund_id !== undefined) {
    if (!data.fund_id) errors.push('fund_id is required');
  }

  if (!isUpdate || data.line_items !== undefined) {
    if (!data.line_items || !Array.isArray(data.line_items)) {
      errors.push('line_items is required and must be an array');
    } else if (data.line_items.length === 0) {
      errors.push('at least one line item is required');
    } else {
      for (let i = 0; i < data.line_items.length; i++) {
        const line = data.line_items[i];
        if (!line) continue;
        if (!line.expense_account_id) {
          errors.push(`Line ${i + 1}: expense account is required`);
        }
        if (line.amount === undefined || line.amount === null) {
          errors.push(`Line ${i + 1}: amount is required`);
        } else {
          const amount = dec(line.amount);
          if (amount.decimalPlaces() > 2) {
            errors.push(`Line ${i + 1}: amount cannot have more than 2 decimal places`);
          }
        }
        if (line.rounding_adjustment !== undefined && line.rounding_adjustment !== null) {
          try {
            const rounding = dec(line.rounding_adjustment);
            if (rounding.decimalPlaces() > 2) {
              errors.push(`Line ${i + 1}: rounding_adjustment cannot have more than 2 decimal places`);
            }
            if (rounding.abs().gt(dec('0.10'))) {
              errors.push(`Line ${i + 1}: rounding_adjustment cannot exceed 0.10 in absolute value`);
            }
          } catch {
            errors.push(`Line ${i + 1}: rounding_adjustment is invalid`);
          }
        }
        // Line description is now optional - no validation needed
      }
    }
  }

  // Note: line_items[].amount is net (before tax); bill.amount is gross (incl. tax).
  // Cross-validation is handled inside createMultiLineJournalEntries which resolves
  // tax rates from the DB. No cheap equality check is possible here.

  if (data.date && data.due_date) {
    if (!isValidDateOnly(data.due_date)) {
      errors.push('due_date must be a valid date (YYYY-MM-DD)');
    } else if (compareDateOnly(data.due_date, data.date) < 0) {
      errors.push('due_date cannot be before bill date');
    }
  }

  return errors;
}

async function getBillWithLineItems(billId: string | number): Promise<BillDetail | null> {
  const bill = await db('bills as b')
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

  const lineItems = await db('bill_line_items as bli')
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

  const appliedCreditRows = await db('bill_credit_applications as bca')
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

  const availableCreditRows = await db('bills as b')
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
      // tax_amount computed from net: tax = round(net * rate, 2)
      tax_amount: li.tax_rate_id
        ? parseFloat(
            dec(li.amount).times(dec(li.tax_rate_value)).toDecimalPlaces(2).toFixed(2)
          )
        : null,
    })),
  } as BillDetail;
}

async function createBillLineItems(
  billId: number | string,
  lineItems: BillLineItemInput[],
  trx: Knex.Transaction
) {
  const lineItemRecords = lineItems.map(li => ({
    bill_id: billId,
    expense_account_id: li.expense_account_id,
    amount: dec(li.amount).toFixed(2),
    rounding_adjustment: dec(li.rounding_adjustment ?? 0).toFixed(2),
    description: li.description?.trim() || null,
    tax_rate_id: li.tax_rate_id || null,
    created_at: trx.fn.now(),
    updated_at: trx.fn.now(),
  }));

  return trx('bill_line_items').insert(lineItemRecords).returning('*');
}

async function resolveTaxRateMap(
  lineItems: BillLineItemInput[],
  executor: Knex | Knex.Transaction
): Promise<Record<number, TaxRateRow>> {
  const taxRateIds = [...new Set(lineItems.map((li) => li.tax_rate_id).filter((v): v is number => Boolean(v)))];
  if (taxRateIds.length === 0) return {};

  const taxRates = await executor('tax_rates').whereIn('id', taxRateIds) as TaxRateRow[];
  return Object.fromEntries(taxRates.map((tr) => [tr.id, tr]));
}

function calculateGrossTotalFromLineItems(
  lineItems: BillLineItemInput[],
  taxRateMap: Record<number, TaxRateRow>
) {
  return lineItems.reduce((sum, line) => {
    const net = dec(line.amount);
    const rounding = dec(line.rounding_adjustment ?? 0);
    const taxRate = line.tax_rate_id ? taxRateMap[line.tax_rate_id] : null;

    if (!taxRate) return sum.plus(net).plus(rounding);

    const tax = net.times(dec(taxRate.rate)).toDecimalPlaces(2);
    return sum.plus(net.plus(tax).plus(rounding));
  }, dec(0));
}

async function createMultiLineJournalEntries(
  transactionId: number,
  billId: number | string,
  lineItems: BillLineItemInput[],
  fundId: number,
  apAccountId: number,
  contactId: number | null,
  contactName: string,
  billNumber: string | null | undefined,
  trx: Knex.Transaction
) {
  // Resolve all tax rates needed for this set of line items in one query
  const taxRateIds = [...new Set(lineItems.map(li => li.tax_rate_id).filter((v): v is number => Boolean(v)))];
  const taxRates = taxRateIds.length > 0
    ? await trx('tax_rates').whereIn('id', taxRateIds)
    : [] as TaxRateRow[];
  const taxRateMap = Object.fromEntries((taxRates as TaxRateRow[]).map(tr => [tr.id, tr]));
  const hasRoundingAdjustment = lineItems.some(line => !dec(line.rounding_adjustment ?? 0).isZero());
  const roundingAccount = hasRoundingAdjustment
    ? await trx('accounts')
      .where({ code: ROUNDING_ACCOUNT_CODE, is_active: true })
      .first() as AccountRow | undefined
    : null;

  if (hasRoundingAdjustment && !roundingAccount) {
    throw new Error(`Rounding account (${ROUNDING_ACCOUNT_CODE}) is missing or inactive`);
  }

  const journalEntries: JournalEntryInsertRow[] = [];
  let apTotal = dec(0);
  const pushSignedEntry = (
    accountId: number,
    amount: Decimal,
    memo: string,
    taxRateId: number | null,
    isTaxLine: boolean,
    contactIdForEntry: number | null = null
  ) => {
    if (amount.eq(0)) return;
    journalEntries.push({
      transaction_id: transactionId,
      account_id: accountId,
      fund_id: fundId,
      contact_id: contactIdForEntry,
      debit: amount.gt(0) ? amount.toFixed(2) : 0,
      credit: amount.lt(0) ? amount.abs().toFixed(2) : 0,
      memo,
      is_reconciled: false,
      tax_rate_id: taxRateId,
      is_tax_line: isTaxLine,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });
  };

  for (const line of lineItems) {
    const net = dec(line.amount);
    const rounding = dec(line.rounding_adjustment ?? 0);
    const taxRate = line.tax_rate_id ? taxRateMap[line.tax_rate_id] : null;
    const lineMemo = `Bill ${billNumber || ''} - ${line.description || ''}`.trim();

    if (taxRate) {
      const tax = net.times(dec(taxRate.rate)).toDecimalPlaces(2);
      const netPlusTax = net.plus(tax);
      pushSignedEntry(
        line.expense_account_id,
        net,
        lineMemo,
        line.tax_rate_id ?? null,
        false
      );
      pushSignedEntry(
        taxRate.recoverable_account_id,
        tax,
        `${taxRate.name} on Bill ${billNumber || ''} - ${line.description || ''}`.trim(),
        line.tax_rate_id ?? null,
        true
      );
      apTotal = apTotal.plus(netPlusTax);
    } else {
      pushSignedEntry(line.expense_account_id, net, lineMemo, null, false);
      apTotal = apTotal.plus(net);
    }

    if (!rounding.isZero() && roundingAccount) {
      pushSignedEntry(
        roundingAccount.id,
        rounding,
        `Rounding adjustment - ${line.description || ''}`.trim(),
        null,
        false
      );
      apTotal = apTotal.plus(rounding);
    }
  }

  pushSignedEntry(
    apAccountId,
    apTotal.negated(),
    `Bill ${billNumber || ''} - ${contactName}`,
    null,
    false,
    contactId
  );

  const totalDebits = journalEntries.reduce((sum, e) => sum.plus(dec(e.debit)), dec(0));
  const totalCredits = journalEntries.reduce((sum, e) => sum.plus(dec(e.credit)), dec(0));
  const diff = totalDebits.minus(totalCredits).abs();
  if (diff.gt(0) && diff.lte(TOLERANCE)) {
    const automaticRoundingAccount = await trx('accounts')
      .where({ code: ROUNDING_ACCOUNT_CODE, is_active: true })
      .first() as AccountRow | undefined;
    if (automaticRoundingAccount) {
      journalEntries.push({
        transaction_id: transactionId,
        account_id:     automaticRoundingAccount.id,
        fund_id:        fundId,
        debit:          totalDebits.lt(totalCredits) ? diff.toFixed(2) : 0,
        credit:         totalDebits.gt(totalCredits) ? diff.toFixed(2) : 0,
        memo:           'Rounding adjustment',
        is_reconciled:  false,
        tax_rate_id:    null,
        is_tax_line:    false,
        created_at:     trx.fn.now(),
        updated_at:     trx.fn.now(),
      });
    }
  }

  return trx('journal_entries').insert(journalEntries).returning('*');
}

async function validateLineItemAccounts(lineItems: BillLineItemInput[]): Promise<string[]> {
  const errors: string[] = [];

  // Pre-fetch all tax rates needed
  const taxRateIds = [...new Set(lineItems.map(li => li.tax_rate_id).filter((v): v is number => Boolean(v)))];
  const taxRates = taxRateIds.length > 0
    ? await db('tax_rates').whereIn('id', taxRateIds).where('is_active', true)
    : [] as TaxRateRow[];
  const activeTaxRateIds = new Set((taxRates as TaxRateRow[]).map(tr => tr.id));
  const hasRoundingAdjustment = lineItems.some(line => !dec(line.rounding_adjustment ?? 0).isZero());
  const roundingAccount = hasRoundingAdjustment
    ? await db('accounts')
      .where({ code: ROUNDING_ACCOUNT_CODE, is_active: true })
      .first() as AccountRow | undefined
    : null;

  if (hasRoundingAdjustment && !roundingAccount) {
    errors.push(`Rounding account (${ROUNDING_ACCOUNT_CODE}) is missing or inactive`);
  }

  for (let i = 0; i < lineItems.length; i++) {
    const line = lineItems[i];
    if (!line) continue;
    const account = await db('accounts')
      .where({ id: line.expense_account_id })
      .where('is_active', true)
      .first() as AccountRow | undefined;

    if (!account) {
      errors.push(`Line ${i + 1}: Expense account not found or inactive`);
      continue;
    }

    if (account.type !== 'EXPENSE') {
      errors.push(`Line ${i + 1}: Selected account must be an EXPENSE type`);
    }

    // Tax validation: tax may only be applied to EXPENSE accounts
    if (line.tax_rate_id) {
      if (account.type !== 'EXPENSE') {
        errors.push(`Line ${i + 1}: Tax can only be applied to EXPENSE accounts`);
      }
      if (!activeTaxRateIds.has(line.tax_rate_id)) {
        errors.push(`Line ${i + 1}: Tax rate #${line.tax_rate_id} does not exist or is inactive`);
      }
    }
  }

  return errors;
}

async function getClosedBooksThrough(executor: Knex | Knex.Transaction) {
  const row = await executor('settings')
    .where({ key: 'books_closed_through' })
    .select('value')
    .first() as { value?: string | null } | undefined;
  if (!row?.value) return null;
  if (!isValidDateOnly(row.value)) return null;
  return row.value;
}

async function getAvailableCreditsForBill(id: string | number): Promise<AvailableBillCredit[]> {
  const target = await db('bills').where({ id }).first() as BillRow | undefined;
  if (!target) return [];

  const targetOutstanding = getOutstanding(target.amount, target.amount_paid);
  if (targetOutstanding.lte(0)) return [];

  const credits = await db('bills as b')
    .where({
      contact_id: target.contact_id,
      fund_id: target.fund_id,
      status: 'UNPAID',
    })
    .where('b.amount', '<', 0)
    .where('b.id', '<>', target.id)
    .orderBy('b.date', 'asc')
    .orderBy('b.id', 'asc')
    .select(
      'b.id',
      'b.bill_number',
      'b.date',
      'b.description',
      'b.amount',
      'b.amount_paid'
    ) as Array<Pick<BillRow, 'id' | 'bill_number' | 'date' | 'description' | 'amount' | 'amount_paid'>>;

  return credits
    .map((credit) => {
      const outstanding = getOutstanding(credit.amount, credit.amount_paid);
      if (outstanding.gte(0)) return null;
      return {
        bill_id: credit.id,
        bill_number: credit.bill_number,
        date: asDateOnlyString(credit.date),
        description: credit.description,
        original_amount: parseFloat(String(credit.amount)),
        amount_paid: parseFloat(String(credit.amount_paid)),
        outstanding: parseFloat(outstanding.toFixed(2)),
        available_amount: parseFloat(outstanding.abs().toFixed(2)),
      } as AvailableBillCredit;
    })
    .filter((credit): credit is AvailableBillCredit => Boolean(credit));
}

async function unapplyBillCredits(
  id: string,
  userId: number
): Promise<{ bill?: BillDetail | null; errors?: string[]; unapplied_count?: number }> {
  const result = await db.transaction(async (trx: Knex.Transaction) => {
    const targetBill = await trx('bills')
      .where({ id })
      .first()
      .forUpdate() as BillRow | undefined;
    if (!targetBill) return { errors: ['Bill not found'] };

    const applications = await trx('bill_credit_applications')
      .where({ target_bill_id: id })
      .whereNull('unapplied_at')
      .orderBy('applied_at', 'asc')
      .forUpdate() as BillCreditApplicationRow[];

    if (applications.length === 0) {
      const bill = await getBillWithLineItems(id);
      return { bill, unapplied_count: 0 };
    }

    const closedThrough = await getClosedBooksThrough(trx);
    if (closedThrough) {
      const hasClosedPeriodApplication = applications.some((app) => {
        const appliedDate = normalizeDateOnly(app.applied_at) || '';
        return appliedDate <= closedThrough;
      });
      if (hasClosedPeriodApplication) {
        return { errors: [`Cannot unapply credits dated on or before closed period ${closedThrough}`] };
      }
    }

    const creditIds = [...new Set(applications.map((app) => app.credit_bill_id))];
    const credits = await trx('bills')
      .whereIn('id', creditIds)
      .forUpdate() as BillRow[];
    const creditMap = new Map(credits.map((credit) => [credit.id, credit]));

    let targetOutstanding = getOutstanding(targetBill.amount, targetBill.amount_paid);
    for (const app of applications) {
      const appAmount = dec(app.amount);
      targetOutstanding = targetOutstanding.plus(appAmount);
    }

    await trx('bills')
      .where({ id: targetBill.id })
      .update({
        amount_paid: getAmountPaidFromOutstanding(targetBill.amount, targetOutstanding),
        status: toBillStatus(targetOutstanding),
        paid_by: isSettledOutstanding(targetOutstanding) ? userId : null,
        paid_at: isSettledOutstanding(targetOutstanding) ? trx.fn.now() : null,
        updated_at: trx.fn.now(),
      });

    const updatesByCredit = new Map<number, Decimal>();
    for (const app of applications) {
      const current = updatesByCredit.get(app.credit_bill_id) || dec(0);
      updatesByCredit.set(app.credit_bill_id, current.minus(dec(app.amount)));
    }

    for (const [creditId, delta] of updatesByCredit.entries()) {
      const credit = creditMap.get(creditId);
      if (!credit) {
        return { errors: [`Credit bill ${creditId} not found`] };
      }
      const outstanding = getOutstanding(credit.amount, credit.amount_paid);
      const nextOutstanding = outstanding.plus(delta);
      await trx('bills')
        .where({ id: credit.id })
        .update({
          amount_paid: getAmountPaidFromOutstanding(credit.amount, nextOutstanding),
          status: toBillStatus(nextOutstanding),
          paid_by: isSettledOutstanding(nextOutstanding) ? userId : null,
          paid_at: isSettledOutstanding(nextOutstanding) ? trx.fn.now() : null,
          updated_at: trx.fn.now(),
        });
    }

    const transactionIds = [...new Set(applications.map((app) => app.apply_transaction_id).filter((id): id is number => Boolean(id)))];
    if (transactionIds.length > 0) {
      const existingTransactions = await trx('transactions')
        .whereIn('id', transactionIds)
        .select('date') as Array<Pick<TransactionRow, 'date'>>;
      for (const existingTransaction of existingTransactions) {
        await assertNotClosedPeriod(normalizeDateOnly(existingTransaction.date), trx);
      }

      await trx('transactions')
        .whereIn('id', transactionIds)
        .update({
          is_voided: true,
          updated_at: trx.fn.now(),
        });
    }

    await trx('bill_credit_applications')
      .where({ target_bill_id: id })
      .whereNull('unapplied_at')
      .update({
        unapplied_at: trx.fn.now(),
        unapplied_by: userId,
      });

    const bill = await getBillWithLineItems(id);
    return { bill, unapplied_count: applications.length };
  });

  return result;
}

async function applyBillCredits(
  id: string,
  payload: ApplyBillCreditsInput,
  userId: number
): Promise<{ bill?: BillDetail | null; errors?: string[]; applications?: BillCreditApplication[]; transaction?: TransactionRow | null }> {
  if (!payload.applications || !Array.isArray(payload.applications) || payload.applications.length === 0) {
    return { errors: ['applications is required'] };
  }

  const validated = payload.applications
    .map((app) => ({
      credit_bill_id: app.credit_bill_id,
      amount: dec(app.amount || 0),
    }))
    .filter((app) => app.amount.gt(0));

  if (validated.length === 0) {
    return { errors: ['At least one positive application amount is required'] };
  }

  if (validated.some((app) => app.amount.decimalPlaces() > 2)) {
    return { errors: ['Application amount cannot have more than 2 decimal places'] };
  }

  const duplicates = new Set<number>();
  for (const app of validated) {
    if (duplicates.has(app.credit_bill_id)) {
      return { errors: ['Duplicate credit bill in applications is not allowed'] };
    }
    duplicates.add(app.credit_bill_id);
  }

  const result = await db.transaction(async (trx: Knex.Transaction) => {
    const target = await trx('bills')
      .where({ id })
      .first()
      .forUpdate() as BillRow | undefined;
    if (!target) return { errors: ['Bill not found'] };

    const targetOutstanding = getOutstanding(target.amount, target.amount_paid);
    if (targetOutstanding.lte(0)) return { errors: ['Bill has no payable balance'] };
    if (dec(target.amount).lte(0)) return { errors: ['Credits can only be applied to a positive bill'] };

    const availableCredits = await trx('bills')
      .where({
        contact_id: target.contact_id,
        fund_id: target.fund_id,
        status: 'UNPAID',
      })
      .where('amount', '<', 0)
      .where('id', '<>', target.id)
      .orderBy('date', 'asc')
      .orderBy('id', 'asc')
      .forUpdate() as BillRow[];

    const availableWithAmounts = availableCredits.map((bill) => {
      const outstanding = getOutstanding(bill.amount, bill.amount_paid);
      return {
        bill,
        available: outstanding.lt(0) ? outstanding.abs() : dec(0),
      };
    }).filter((entry) => entry.available.gt(0));

    const selectedMap = new Map(validated.map((app) => [app.credit_bill_id, app.amount]));
    const selectedInFifo = availableWithAmounts.filter((entry) => selectedMap.has(entry.bill.id));

    if (selectedInFifo.length !== validated.length) {
      return { errors: ['One or more selected credits are unavailable for this bill'] };
    }

    const fifoPrefixIds = availableWithAmounts.slice(0, selectedInFifo.length).map((entry) => entry.bill.id);
    const selectedIds = selectedInFifo.map((entry) => entry.bill.id);
    if (selectedIds.some((id, idx) => id !== fifoPrefixIds[idx])) {
      return { errors: ['Credits must be applied in FIFO order'] };
    }

    for (const [i, entry] of selectedInFifo.entries()) {
      const requested = selectedMap.get(entry.bill.id) || dec(0);
      if (requested.gt(entry.available)) {
        return { errors: [`Credit bill ${formatBillReference(entry.bill)} exceeds available balance`] };
      }
      if (i < selectedInFifo.length - 1 && requested.lt(entry.available)) {
        return { errors: ['Cannot partially apply an earlier credit while applying a later one'] };
      }
    }

    const totalApply = selectedInFifo.reduce((sum, entry) => sum.plus(selectedMap.get(entry.bill.id) || 0), dec(0));
    if (totalApply.gt(targetOutstanding)) {
      return { errors: [`Total application exceeds target outstanding ($${targetOutstanding.toFixed(2)})`] };
    }

    const apAccount = await trx('accounts')
      .where({ code: AP_ACCOUNT_CODE })
      .where('is_active', true)
      .first() as AccountRow | undefined;
    if (!apAccount) return { errors: [`Accounts Payable account (${AP_ACCOUNT_CODE}) not found`] };

    const creditAppDate = getChurchToday(getChurchTimeZone());
    await assertNotClosedPeriod(creditAppDate, trx);

    const [applyTransaction] = await trx('transactions')
      .insert({
        date: creditAppDate,
        description: `Apply vendor credit(s) to bill ${formatBillReference(target)}`,
        reference_no: target.bill_number || null,
        fund_id: target.fund_id,
        created_by: userId,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .returning('*') as TransactionRow[];
    if (!applyTransaction) throw new Error('Failed to create credit application transaction');

    const journalRows: JournalEntryInsertRow[] = [];
    const appRows: Array<{
      target_bill_id: number;
      credit_bill_id: number;
      amount: string;
      apply_transaction_id: number;
      applied_by: number;
      applied_at: unknown;
      unapplied_at: null;
      unapplied_by: null;
    }> = [];

    let nextTargetOutstanding = targetOutstanding;
    for (const entry of selectedInFifo) {
      const amount = selectedMap.get(entry.bill.id) || dec(0);
      if (amount.lte(0)) continue;

      const sourceLabel = formatBillReference(entry.bill);
      const targetLabel = formatBillReference(target);
      const memo = `Applied Credit ${sourceLabel} to Bill ${targetLabel}`;
      journalRows.push({
        transaction_id: applyTransaction.id,
        account_id: apAccount.id,
        fund_id: target.fund_id,
        contact_id: target.contact_id,
        debit: amount.toFixed(2),
        credit: 0,
        memo,
        is_reconciled: false,
        tax_rate_id: null,
        is_tax_line: false,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });
      journalRows.push({
        transaction_id: applyTransaction.id,
        account_id: apAccount.id,
        fund_id: target.fund_id,
        contact_id: target.contact_id,
        debit: 0,
        credit: amount.toFixed(2),
        memo,
        is_reconciled: false,
        tax_rate_id: null,
        is_tax_line: false,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });

      const sourceOutstanding = getOutstanding(entry.bill.amount, entry.bill.amount_paid);
      const nextSourceOutstanding = sourceOutstanding.plus(amount);
      await trx('bills')
        .where({ id: entry.bill.id })
        .update({
          amount_paid: getAmountPaidFromOutstanding(entry.bill.amount, nextSourceOutstanding),
          status: toBillStatus(nextSourceOutstanding),
          paid_by: isSettledOutstanding(nextSourceOutstanding) ? userId : null,
          paid_at: isSettledOutstanding(nextSourceOutstanding) ? trx.fn.now() : null,
          updated_at: trx.fn.now(),
        });

      nextTargetOutstanding = nextTargetOutstanding.minus(amount);
      appRows.push({
        target_bill_id: target.id,
        credit_bill_id: entry.bill.id,
        amount: amount.toFixed(2),
        apply_transaction_id: applyTransaction.id,
        applied_by: userId,
        applied_at: trx.fn.now(),
        unapplied_at: null,
        unapplied_by: null,
      });
    }

    if (journalRows.length === 0) {
      return { errors: ['No credit amount was applied'] };
    }

    await trx('journal_entries').insert(journalRows);
    const insertedApps = await trx('bill_credit_applications')
      .insert(appRows)
      .returning('*') as BillCreditApplicationRow[];

    await trx('bills')
      .where({ id: target.id })
      .update({
        amount_paid: getAmountPaidFromOutstanding(target.amount, nextTargetOutstanding),
        status: toBillStatus(nextTargetOutstanding),
        paid_by: isSettledOutstanding(nextTargetOutstanding) ? userId : null,
        paid_at: isSettledOutstanding(nextTargetOutstanding) ? trx.fn.now() : null,
        updated_at: trx.fn.now(),
      });

    const detailedApps = await trx('bill_credit_applications as bca')
      .leftJoin('users as u', 'u.id', 'bca.applied_by')
      .leftJoin('bills as cb', 'cb.id', 'bca.credit_bill_id')
      .whereIn('bca.id', insertedApps.map((app) => app.id))
      .select(
        'bca.*',
        'u.name as applied_by_name',
        'cb.bill_number as credit_bill_number',
        'cb.date as credit_bill_date'
      ) as ApplicationJoinedRow[];

    const bill = await getBillWithLineItems(id);
    return {
      bill,
      applications: normaliseApplications(detailedApps),
      transaction: applyTransaction,
    };
  });

  return result;
}

async function createBill(payload: CreateBillInput, userId: number): Promise<BillMutationResult> {
  const errors = validateBillData(payload);
  if (errors.length) return { errors };

  const contact = await db('contacts')
    .where({ id: payload.contact_id })
    .where('is_active', true)
    .first() as ContactRow | undefined;

  if (!contact) {
    return { errors: ['Vendor not found or inactive'] };
  }

  if (!['PAYEE', 'BOTH'].includes(contact.type)) {
    return { errors: ['Contact must be a vendor (PAYEE or BOTH type)'] };
  }

  const fund = await db('funds')
    .where({ id: payload.fund_id })
    .where('is_active', true)
    .first() as FundRow | undefined;

  if (!fund) {
    return { errors: ['Fund not found or inactive'] };
  }

  const accountErrors = await validateLineItemAccounts(payload.line_items);
  if (accountErrors.length) {
    return { errors: accountErrors };
  }

  const apAccount = await db('accounts')
    .where({ code: AP_ACCOUNT_CODE })
    .where('is_active', true)
    .first() as AccountRow | undefined;

  if (!apAccount) {
    return { errors: [`Accounts Payable account (${AP_ACCOUNT_CODE}) not found`] };
  }

  const taxRateMap = await resolveTaxRateMap(payload.line_items, db);
  const totalAmount = calculateGrossTotalFromLineItems(payload.line_items, taxRateMap);
  const isSettledOnCreate = isSettledOutstanding(totalAmount);

  const result = await db.transaction(async (trx: Knex.Transaction) => {
    await assertNotClosedPeriod(payload.date, trx);

    const [bill] = await trx('bills')
      .insert({
        contact_id: payload.contact_id,
        date: payload.date,
        due_date: payload.due_date || null,
        bill_number: payload.bill_number?.trim() || null,
        description: payload.description.trim(),
        amount: totalAmount.toFixed(2),
        fund_id: payload.fund_id,
        amount_paid: isSettledOnCreate ? totalAmount.toFixed(2) : 0,
        status: isSettledOnCreate ? 'PAID' : 'UNPAID',
        created_by: userId,
        paid_by: isSettledOnCreate ? userId : null,
        paid_at: isSettledOnCreate ? trx.fn.now() : null,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .returning('*') as BillRow[];
    if (!bill) throw new Error('Failed to create bill');

    const [transaction] = await trx('transactions')
      .insert({
        date: payload.date,
        description: `Bill: ${payload.description.trim()} (${payload.bill_number?.trim() || 'no #'})`,
        reference_no: payload.bill_number?.trim() || null,
        fund_id: payload.fund_id,
        created_by: userId,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .returning('*') as TransactionRow[];
    if (!transaction) throw new Error('Failed to create bill transaction');

    await trx('bills')
      .where({ id: bill.id })
      .update({ created_transaction_id: transaction.id });

    await createBillLineItems(bill.id, payload.line_items, trx);
    
    await createMultiLineJournalEntries(
      transaction.id,
      bill.id,
      payload.line_items,
      payload.fund_id,
      apAccount.id,
      payload.contact_id,
      contact.name,
      payload.bill_number?.trim(),
      trx
    );

    return { bill, transaction };
  });

  const billWithLineItems = await getBillWithLineItems(result.bill.id);
  return { bill: billWithLineItems, transaction: result.transaction };
}

async function updateBill(id: string, payload: UpdateBillInput, userId: number): Promise<BillMutationResult> {
  let bill = await db('bills').where({ id }).first() as BillRow | undefined;
  if (!bill) {
    return { errors: ['Bill not found'] };
  }

  if (bill.status !== 'UNPAID') {
    return { errors: [`Cannot edit ${bill.status} bills`] };
  }

  const existingApplications = await db('bill_credit_applications')
    .where({ target_bill_id: id })
    .whereNull('unapplied_at')
    .count('id as count')
    .first() as { count: string | number } | undefined;

  const hasAppliedCredits = parseInt(String(existingApplications?.count || 0), 10) > 0;
  const sourcedApplications = await db('bill_credit_applications')
    .where({ credit_bill_id: id })
    .whereNull('unapplied_at')
    .count('id as count')
    .first() as { count: string | number } | undefined;
  const isActiveCreditSource = parseInt(String(sourcedApplications?.count || 0), 10) > 0;

  if (isActiveCreditSource) {
    return { errors: ['Cannot edit this credit bill while it is applied to other bills'] };
  }

  if (hasAppliedCredits && !payload.confirm_unapply_credits) {
    return { errors: ['Bill has applied credits. Confirm unapply before editing.'] };
  }

  const errors = validateBillData(payload, true);
  if (errors.length) return { errors };

  if (payload.contact_id !== undefined) {
    const contact = await db('contacts')
      .where({ id: payload.contact_id })
      .where('is_active', true)
      .first() as ContactRow | undefined;

    if (!contact) {
      return { errors: ['Vendor not found or inactive'] };
    }

    if (!['PAYEE', 'BOTH'].includes(contact.type)) {
      return { errors: ['Contact must be a vendor (PAYEE or BOTH type)'] };
    }
  }

  if (payload.fund_id !== undefined) {
    const fund = await db('funds')
      .where({ id: payload.fund_id })
      .where('is_active', true)
      .first() as FundRow | undefined;

    if (!fund) {
      return { errors: ['Fund not found or inactive'] };
    }
  }

  if (payload.line_items !== undefined) {
    const accountErrors = await validateLineItemAccounts(payload.line_items);
    if (accountErrors.length) {
      return { errors: accountErrors };
    }
  }

  let hasPartialPayments = dec(bill.amount_paid).gt(0);
  let hasLineItemChanges = false;
  if (payload.line_items !== undefined) {
    const existingLineItems = await db('bill_line_items')
      .where({ bill_id: id })
      .orderBy('id', 'asc')
      .select('expense_account_id', 'amount', 'rounding_adjustment', 'description', 'tax_rate_id') as BillLineItemComparisonRow[];

    const normaliseExistingLineItem = (line: BillLineItemComparisonRow) => ({
      expense_account_id: Number(line.expense_account_id),
      amount: dec(line.amount).toFixed(2),
      rounding_adjustment: dec(line.rounding_adjustment ?? 0).toFixed(2),
      description: line.description?.trim() || null,
      tax_rate_id: line.tax_rate_id ?? null,
    });

    const normalisePayloadLineItem = (line: BillLineItemInput) => ({
      expense_account_id: Number(line.expense_account_id),
      amount: dec(line.amount).toFixed(2),
      rounding_adjustment: dec(line.rounding_adjustment ?? 0).toFixed(2),
      description: line.description?.trim() || null,
      tax_rate_id: line.tax_rate_id ?? null,
    });

    const normalisedExisting = existingLineItems.map(normaliseExistingLineItem);
    const normalisedIncoming = payload.line_items.map(normalisePayloadLineItem);
    hasLineItemChanges =
      normalisedExisting.length !== normalisedIncoming.length
      || normalisedExisting.some((line, index) => {
        const next = normalisedIncoming[index];
        if (!next) return true;
        return (
          line.expense_account_id !== next.expense_account_id
          || line.amount !== next.amount
          || line.rounding_adjustment !== next.rounding_adjustment
          || line.description !== next.description
          || line.tax_rate_id !== next.tax_rate_id
        );
      });
  }

  if (hasAppliedCredits && payload.confirm_unapply_credits) {
    const unapplied = await unapplyBillCredits(id, userId);
    if (unapplied.errors) return { errors: unapplied.errors };
    bill = await db('bills').where({ id }).first() as BillRow | undefined;
    if (!bill) return { errors: ['Bill not found'] };
    if (bill.status !== 'UNPAID') {
      return { errors: [`Cannot edit ${bill.status} bills`] };
    }
    hasPartialPayments = dec(bill.amount_paid).gt(0);
  }

  if (hasPartialPayments && hasLineItemChanges) {
    return { errors: ['Cannot edit a bill that has partial payments. Reverse all payments first.'] };
  }

  const shouldRewriteLineItems = payload.line_items !== undefined && hasLineItemChanges;
  const newLineItems = shouldRewriteLineItems ? payload.line_items || [] : [];
  const taxRateMap = newLineItems.length > 0 ? await resolveTaxRateMap(newLineItems, db) : {};
  const newTotalAmount = newLineItems.length > 0
    ? calculateGrossTotalFromLineItems(newLineItems, taxRateMap)
    : dec(bill.amount);
  const nextOutstanding = newTotalAmount.minus(dec(bill.amount_paid));
  const isSettledAfterUpdate = isSettledOutstanding(nextOutstanding);

  await db.transaction(async (trx: Knex.Transaction) => {
    if (!bill.created_transaction_id) {
      throw Object.assign(new Error('Bill has no linked transaction'), { status: 422 });
    }
    const existingBillTx = await trx('transactions')
      .where({ id: bill.created_transaction_id })
      .select('date')
      .first() as Pick<TransactionRow, 'date'> | undefined;
    if (!existingBillTx) {
      throw Object.assign(new Error('Linked transaction not found'), { status: 422 });
    }
    const existingDate = normalizeDateOnly(existingBillTx.date);
    const proposedDate = payload.date !== undefined ? payload.date : existingDate;
    await assertNotClosedPeriod(existingDate, trx);
    await assertNotClosedPeriod(proposedDate, trx);

    if (shouldRewriteLineItems) {
      await trx('bill_line_items')
        .where({ bill_id: id })
        .delete();

      if (newLineItems.length > 0) {
        await createBillLineItems(id, newLineItems, trx);
      }

      if (bill.created_transaction_id) {
        await trx('journal_entries')
          .where({ transaction_id: bill.created_transaction_id })
          .delete();

        const apAccount = await trx('accounts')
          .where({ code: AP_ACCOUNT_CODE })
          .first() as AccountRow | undefined;
        if (!apAccount) throw new Error(`Accounts Payable account (${AP_ACCOUNT_CODE}) not found`);

        const contact = await trx('contacts')
          .where({ id: payload.contact_id || bill.contact_id })
          .first() as ContactRow | undefined;
        if (!contact) throw new Error('Vendor not found');

        await createMultiLineJournalEntries(
          bill.created_transaction_id,
          id,
          newLineItems,
          payload.fund_id || bill.fund_id,
          apAccount.id,
          payload.contact_id !== undefined ? payload.contact_id : bill.contact_id,
          contact.name,
          bill.bill_number || '',
          trx
        );
      }
    }

    const updateData = {
      contact_id: payload.contact_id !== undefined ? payload.contact_id : bill.contact_id,
      date: payload.date !== undefined ? payload.date : bill.date,
      due_date: payload.due_date !== undefined ? (payload.due_date || null) : bill.due_date,
      bill_number: payload.bill_number !== undefined ? payload.bill_number?.trim() || null : bill.bill_number,
      description: payload.description !== undefined ? payload.description.trim() : bill.description,
      amount: shouldRewriteLineItems ? newTotalAmount.toFixed(2) : bill.amount,
      amount_paid: shouldRewriteLineItems ? (isSettledAfterUpdate ? newTotalAmount.toFixed(2) : bill.amount_paid) : bill.amount_paid,
      status: shouldRewriteLineItems ? toBillStatus(nextOutstanding) : bill.status,
      paid_by: shouldRewriteLineItems ? (isSettledAfterUpdate ? userId : null) : bill.paid_by,
      paid_at: shouldRewriteLineItems ? (isSettledAfterUpdate ? trx.fn.now() : null) : bill.paid_at,
      transaction_id: shouldRewriteLineItems ? (isSettledAfterUpdate ? bill.transaction_id : null) : bill.transaction_id,
      fund_id: payload.fund_id !== undefined ? payload.fund_id : bill.fund_id,
      updated_at: trx.fn.now(),
    };

    await trx('bills')
      .where({ id })
      .update(updateData)
      .returning('*');
  });

  const billWithLineItems = await getBillWithLineItems(id);
  return { bill: billWithLineItems };
}

async function payBill(id: string, paymentData: PayBillInput, userId: number): Promise<BillMutationResult> {
  const bill = await getBillWithLineItems(id);
  if (!bill) {
    return { errors: ['Bill not found'] };
  }

  if (bill.status !== 'UNPAID') {
    return { errors: [`Cannot pay a ${bill.status} bill`] };
  }

  const errors: string[] = [];
  if (!paymentData.payment_date) errors.push('payment_date is required');
  if (!paymentData.bank_account_id) errors.push('bank_account_id is required');
  
  if (errors.length) return { errors };

  const bankAccount = await db('accounts')
    .where({ id: paymentData.bank_account_id })
    .where('is_active', true)
    .first() as AccountRow | undefined;

  if (!bankAccount) {
    return { errors: ['Bank account not found or inactive'] };
  }

  if (bankAccount.type !== 'ASSET') {
    return { errors: ['Selected account must be an ASSET type (bank account)'] };
  }

  const outstanding = dec(bill.amount).minus(dec(bill.amount_paid));
  if (outstanding.lte(0)) {
    return { errors: ['Bill has no payable balance'], outstanding: parseFloat(outstanding.toFixed(2)) };
  }
  
  if (paymentData.amount !== undefined) {
    if (typeof paymentData.amount !== 'number' || !Number.isFinite(paymentData.amount)) {
      return { errors: ['Payment amount must be a valid number'], outstanding: parseFloat(outstanding.toFixed(2)) };
    }
  }

  const paymentAmount = paymentData.amount !== undefined ? dec(paymentData.amount) : outstanding;
  if (paymentAmount.lte(0)) {
    return { errors: ['Payment amount must be greater than zero'], outstanding: parseFloat(outstanding.toFixed(2)) };
  }
  if (paymentAmount.decimalPlaces() > 2) {
    return { errors: ['Payment amount cannot have more than 2 decimal places'], outstanding: parseFloat(outstanding.toFixed(2)) };
  }
  if (paymentAmount.gt(outstanding)) {
    return {
      errors: [`Payment amount ($${paymentAmount.toFixed(2)}) exceeds outstanding balance ($${outstanding.toFixed(2)})`],
      outstanding: parseFloat(outstanding.toFixed(2)),
    };
  }

  const apAccount = await db('accounts')
    .where({ code: AP_ACCOUNT_CODE })
    .where('is_active', true)
    .first() as AccountRow | undefined;

  if (!apAccount) {
    return { errors: [`Accounts Payable account (${AP_ACCOUNT_CODE}) not found`] };
  }

  const result = await db.transaction(async (trx: Knex.Transaction) => {
    await assertNotClosedPeriod(paymentData.payment_date!, trx);

    const [transaction] = await trx('transactions')
      .insert({
        date: paymentData.payment_date,
        description: `Payment for bill ${bill.bill_number || `#${bill.id}`} - ${bill.description}`,
        reference_no: paymentData.reference_no?.trim() || null,
        fund_id: bill.fund_id,
        created_by: userId,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      })
      .returning('*') as TransactionRow[];
    if (!transaction) throw new Error('Failed to create payment transaction');

    const amount = paymentAmount.toFixed(2);

    const billRef = bill.bill_number || `#${bill.id}`;
    const journalLines: object[] = [
      {
        transaction_id: transaction.id,
        account_id: apAccount.id,
        fund_id: bill.fund_id,
        contact_id: bill.contact_id,
        debit: amount,
        credit: 0,
        memo: `Payment for bill ${billRef}`,
        is_reconciled: false,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      },
      {
        transaction_id: transaction.id,
        account_id: bankAccount.id,
        fund_id: bill.fund_id,
        contact_id: bill.contact_id,
        debit: 0,
        credit: amount,
        memo: `Payment for bill ${billRef}`,
        is_reconciled: false,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      },
    ];

    await trx('journal_entries').insert(journalLines);

    const newAmountPaid = dec(bill.amount_paid).plus(paymentAmount);
    const newOutstanding = dec(bill.amount).minus(newAmountPaid);
    const isFullyPaid = isSettledOutstanding(newOutstanding);

    const [updatedBill] = await trx('bills')
      .where({ id })
      .update({
        amount_paid: newAmountPaid.toFixed(2),
        status: toBillStatus(newOutstanding),
        transaction_id: transaction.id,
        paid_by: isFullyPaid ? userId : null,
        paid_at: isFullyPaid ? trx.fn.now() : null,
        updated_at: trx.fn.now(),
      })
      .returning('*') as BillRow[];
    if (!updatedBill) throw new Error('Failed to mark bill paid');

    return { transaction, bill: updatedBill };
  });

  const billWithLineItems = await getBillWithLineItems(id);
  return { bill: billWithLineItems, transaction: result.transaction };
}

async function voidBill(id: string, userId: number): Promise<BillMutationResult> {
  const bill = await getBillWithLineItems(id);
  if (!bill) {
    return { errors: ['Bill not found'] };
  }

  if (bill.status === 'PAID') {
    return { errors: ['Cannot void a paid bill'] };
  }

  if (dec(bill.amount_paid).gt(0)) {
    return { errors: ['Cannot void a bill that has partial payments. Reverse all payments first.'] };
  }

  if (bill.status === 'VOID') {
    return { errors: ['Bill is already voided'] };
  }

  const apAccount = await db('accounts')
    .where({ code: AP_ACCOUNT_CODE })
    .where('is_active', true)
    .first() as AccountRow | undefined;

  if (!apAccount) {
    return { errors: [`Accounts Payable account (${AP_ACCOUNT_CODE}) not found`] };
  }

  const result = await db.transaction(async (trx: Knex.Transaction) => {
    // Set is_voided flag on the original transaction
    if (bill.created_transaction_id) {
      const existingBillTransaction = await trx('transactions')
        .where({ id: bill.created_transaction_id })
        .select('date')
        .first() as Pick<TransactionRow, 'date'> | undefined;
      if (!existingBillTransaction) throw new Error('Linked transaction not found');
      await assertNotClosedPeriod(normalizeDateOnly(existingBillTransaction.date), trx);

      await trx('transactions')
        .where({ id: bill.created_transaction_id })
        .update({
          is_voided: true,
          updated_at: trx.fn.now(),
        });
    }

    const [updatedBill] = await trx('bills')
      .where({ id })
      .update({
        status: 'VOID',
        updated_at: trx.fn.now(),
      })
      .returning('*') as BillRow[];
    if (!updatedBill) throw new Error('Failed to void bill');

    return { bill: updatedBill };
  });

  const billWithLineItems = await getBillWithLineItems(id);
  return { bill: billWithLineItems, transaction: null };
}

function dayNumberFromDateOnly(dateOnly: string) {
  const [year, month, day] = dateOnly.split('-').map((n) => parseInt(n, 10));
  return Date.UTC(year || 0, (month || 1) - 1, day || 1);
}

async function getAgingReport(asOfDate: string | Date = getChurchToday(getChurchTimeZone())): Promise<BillAgingReportResponse['report']> {
  const asOfInput = typeof asOfDate === 'string' ? asOfDate : normalizeDateOnly(asOfDate);
  const asOf = parseDateOnlyStrict(asOfInput)
    ? asOfInput
    : getChurchToday(getChurchTimeZone());
  
  const bills = await db('bills as b')
    .join('contacts as c', 'c.id', 'b.contact_id')
    .where('b.status', 'UNPAID')
    .select(
      'b.id',
      'b.contact_id',
      'c.name as vendor_name',
      'b.bill_number',
      'b.description',
      'b.amount',
      'b.amount_paid',
      'b.due_date',
    ) as AgingSourceBillRow[];

  const aging: AgingBucket = { current: [], days31_60: [], days61_90: [], days90_plus: [] };

  bills.forEach(bill => {
    const dueDate = normalizeDateOnly(bill.due_date) || asOf;
    const daysOverdue = Math.floor((dayNumberFromDateOnly(asOf) - dayNumberFromDateOnly(dueDate)) / (1000 * 60 * 60 * 24));
    const outstanding = parseFloat(dec(bill.amount).minus(dec(bill.amount_paid)).toFixed(2));
    if (outstanding <= 0) return;

    const billData: AgingBill = {
      ...bill,
      amount: parseFloat(String(bill.amount)),
      amount_paid: parseFloat(String(bill.amount_paid)),
      due_date: dueDate,
      outstanding,
      days_overdue: daysOverdue,
    };

    if (daysOverdue <= 30) {
      aging.current.push(billData);
    } else if (daysOverdue <= 60) {
      aging.days31_60.push(billData);
    } else if (daysOverdue <= 90) {
      aging.days61_90.push(billData);
    } else {
      aging.days90_plus.push(billData);
    }
  });

  const byVendor: Record<string, {
    contact_id: number;
    current: number;
    days31_60: number;
    days61_90: number;
    days90_plus: number;
    total: number;
  }> = {};
  Object.entries(aging).forEach(([bucket, bucketBills]) => {
    bucketBills.forEach(bill => {
      if (!byVendor[bill.vendor_name]) {
        byVendor[bill.vendor_name] = {
          contact_id: bill.contact_id,
          current: 0,
          days31_60: 0,
          days61_90: 0,
          days90_plus: 0,
          total: 0,
        };
      }
      const vendor = byVendor[bill.vendor_name]!;
      vendor[bucket as keyof Omit<typeof vendor, 'contact_id' | 'total'>] += bill.outstanding;
      vendor.total += bill.outstanding;
    });
  });

  const vendorAging: VendorAgingItem[] = Object.entries(byVendor).map(([name, data]) => ({
    vendor_name: name,
    contact_id: data.contact_id,
    current: parseFloat(data.current.toFixed(2)),
    days31_60: parseFloat(data.days31_60.toFixed(2)),
    days61_90: parseFloat(data.days61_90.toFixed(2)),
    days90_plus: parseFloat(data.days90_plus.toFixed(2)),
    total: parseFloat(data.total.toFixed(2)),
  }));

  const totals: BillAgingReportResponse['report']['totals'] = {
    current: parseFloat(aging.current.reduce((sum, b) => sum + b.outstanding, 0).toFixed(2)),
    days31_60: parseFloat(aging.days31_60.reduce((sum, b) => sum + b.outstanding, 0).toFixed(2)),
    days61_90: parseFloat(aging.days61_90.reduce((sum, b) => sum + b.outstanding, 0).toFixed(2)),
    days90_plus: parseFloat(aging.days90_plus.reduce((sum, b) => sum + b.outstanding, 0).toFixed(2)),
    total: 0,
  };
  totals.total = totals.current + totals.days31_60 + totals.days61_90 + totals.days90_plus;

  return {
    as_of_date: asOf,
    vendor_aging: vendorAging,
    totals,
    buckets: {
      current: aging.current,
      days31_60: aging.days31_60,
      days61_90: aging.days61_90,
      days90_plus: aging.days90_plus,
    },
  };
}

async function getUnpaidSummary(): Promise<BillSummaryResponse['summary']> {
  const summary = await db('bills')
    .where('status', 'UNPAID')
    .select(
      db.raw('SUM(CASE WHEN amount - amount_paid > 0 THEN 1 ELSE 0 END) as count'),
      db.raw('SUM(CASE WHEN amount - amount_paid > 0 THEN amount - amount_paid ELSE 0 END) as total_outstanding'),
      db.raw('MIN(CASE WHEN amount - amount_paid > 0 THEN due_date ELSE NULL END) as earliest_due'),
    )
    .first() as UnpaidSummaryRow | undefined;

  return {
    count: parseInt(String(summary?.count ?? 0), 10),
    total_outstanding: parseFloat(dec(summary?.total_outstanding ?? 0).toFixed(2)),
    earliest_due: summary?.earliest_due ?? null,
  };
}

export = {
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
};
