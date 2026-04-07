import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type {
  BillAgingReportResponse,
  BillDetail,
  BillLineItemInput,
  BillSummaryResponse,
  CreateBillInput,
  PayBillInput,
  UpdateBillInput,
} from '@shared/contracts';
import type { BillRow, TransactionRow } from '../types/db';
import {
  compareDateOnly,
  getChurchToday,
  isValidDateOnly,
  normalizeDateOnly,
  parseDateOnlyStrict,
  toUtcIsoString,
} from '../utils/date.js';
import { getChurchTimeZone } from './churchTimeZone.js';

const db = require('../db') as Knex;

type Numeric = string | number;

type PaymentBillInput = PayBillInput & {
  amount?: Numeric;
  reference_no?: string;
};

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
  debit: Numeric;
  credit: Numeric;
  memo: string;
  is_reconciled: boolean;
  tax_rate_id: number | null;
  is_tax_line: boolean;
  created_at: unknown;
  updated_at: unknown;
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

const dec = (value: Numeric | null | undefined) => new Decimal(value ?? 0);
const asDateOnlyString = (value: string | Date) => normalizeDateOnly(value);
const asDateTimeString = (value: string | Date) => toUtcIsoString(value);

const ROUNDING_ACCOUNT_CODE = '59999';
const AP_ACCOUNT_CODE = '20000';
const TOLERANCE = 0.01;

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
    if (!data.amount) errors.push('amount is required');
    else if (dec(data.amount).lte(0)) errors.push('amount must be greater than 0');
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

  return {
    ...bill,
    date: asDateOnlyString(bill.date),
    due_date: bill.due_date ? asDateOnlyString(bill.due_date) : null,
    paid_at: bill.paid_at ? asDateTimeString(bill.paid_at) : null,
    created_at: asDateTimeString(bill.created_at),
    updated_at: asDateTimeString(bill.updated_at),
    amount: parseFloat(String(bill.amount)),
    amount_paid: parseFloat(String(bill.amount_paid)),
    line_items: lineItems.map(li => ({
      id: li.id,
      expense_account_id: li.expense_account_id,
      expense_account_code: li.expense_account_code,
      expense_account_name: li.expense_account_name,
      amount: parseFloat(String(li.amount)),
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
    const taxRate = line.tax_rate_id ? taxRateMap[line.tax_rate_id] : null;

    if (!taxRate) return sum.plus(net);

    const tax = net.times(dec(taxRate.rate)).toDecimalPlaces(2);
    return sum.plus(net.plus(tax));
  }, dec(0));
}

async function createMultiLineJournalEntries(
  transactionId: number,
  billId: number | string,
  lineItems: BillLineItemInput[],
  fundId: number,
  apAccountId: number,
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

  const journalEntries: JournalEntryInsertRow[] = [];
  let apTotal = dec(0);

  for (const line of lineItems) {
    const net = dec(line.amount); // line.amount is net (before tax)
    const taxRate = line.tax_rate_id ? taxRateMap[line.tax_rate_id] : null;

    if (taxRate) {
      // gross = net + round(net * rate, 2)
      const tax = net.times(dec(taxRate.rate)).toDecimalPlaces(2);
      const gross = net.plus(tax);

      // Expense line — net amount only
      journalEntries.push({
        transaction_id: transactionId,
        account_id:     line.expense_account_id,
        fund_id:        fundId,
        debit:          net.toFixed(2),
        credit:         0,
        memo:           `Bill ${billNumber || ''} - ${line.description || ''}`.trim(),
        is_reconciled:  false,
        tax_rate_id:    line.tax_rate_id ?? null,
        is_tax_line:    false,
        created_at:     trx.fn.now(),
        updated_at:     trx.fn.now(),
      });

      // Tax recoverable line — inherits fund and contact from parent
      journalEntries.push({
        transaction_id: transactionId,
        account_id:     taxRate.recoverable_account_id,
        fund_id:        fundId,
        debit:          tax.toFixed(2),
        credit:         0,
        memo:           `${taxRate.name} on Bill ${billNumber || ''} - ${line.description || ''}`.trim(),
        is_reconciled:  false,
        tax_rate_id:    line.tax_rate_id ?? null,
        is_tax_line:    true,
        created_at:     trx.fn.now(),
        updated_at:     trx.fn.now(),
      });

      apTotal = apTotal.plus(gross); // AP credit = full gross
    } else {
      // No tax — net === gross
      if (net.gte(0)) {
        journalEntries.push({
          transaction_id: transactionId,
          account_id:     line.expense_account_id,
          fund_id:        fundId,
          debit:          net.toFixed(2),
          credit:         0,
          memo:           `Bill ${billNumber || ''} - ${line.description || ''}`.trim(),
          is_reconciled:  false,
          tax_rate_id:    null,
          is_tax_line:    false,
          created_at:     trx.fn.now(),
          updated_at:     trx.fn.now(),
        });
      } else {
        journalEntries.push({
          transaction_id: transactionId,
          account_id:     line.expense_account_id,
          fund_id:        fundId,
          debit:          0,
          credit:         net.abs().toFixed(2),
          memo:           `Bill ${billNumber || ''} - ${line.description || ''}`.trim(),
          is_reconciled:  false,
          tax_rate_id:    null,
          is_tax_line:    false,
          created_at:     trx.fn.now(),
          updated_at:     trx.fn.now(),
        });
      }
      apTotal = apTotal.plus(net);
    }
  }

  // AP credit line — full gross total (tax-inclusive)
  journalEntries.push({
    transaction_id: transactionId,
    account_id:     apAccountId,
    fund_id:        fundId,
    debit:          0,
    credit:         apTotal.toFixed(2),
    memo:           `Bill ${billNumber || ''} - ${contactName}`,
    is_reconciled:  false,
    tax_rate_id:    null,
    is_tax_line:    false,
    created_at:     trx.fn.now(),
    updated_at:     trx.fn.now(),
  });

  // Rounding check: sum of all debits vs AP credit
  const totalDebits = journalEntries.reduce((sum, e) => sum.plus(dec(e.debit)), dec(0));
  const diff = totalDebits.minus(apTotal).abs();
  if (diff.gt(0) && diff.lte(TOLERANCE)) {
    const roundingAccount = await trx('accounts')
      .where({ code: ROUNDING_ACCOUNT_CODE })
      .first() as AccountRow | undefined;
    if (roundingAccount) {
      journalEntries.push({
        transaction_id: transactionId,
        account_id:     roundingAccount.id,
        fund_id:        fundId,
        debit:          totalDebits.lt(apTotal) ? diff.toFixed(2) : 0,
        credit:         totalDebits.gt(apTotal) ? diff.toFixed(2) : 0,
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

    if (dec(line.amount).lt(0) && account.code !== ROUNDING_ACCOUNT_CODE) {
      errors.push(`Line ${i + 1}: Negative amounts only allowed in account ${ROUNDING_ACCOUNT_CODE} (Rounding & Adjustments)`);
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

  const result = await db.transaction(async (trx: Knex.Transaction) => {
    const [bill] = await trx('bills')
      .insert({
        contact_id: payload.contact_id,
        date: payload.date,
        due_date: payload.due_date || null,
        bill_number: payload.bill_number?.trim() || null,
        description: payload.description.trim(),
        amount: totalAmount.toFixed(2),
        fund_id: payload.fund_id,
        amount_paid: 0,
        status: 'UNPAID',
        created_by: userId,
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
  const bill = await db('bills').where({ id }).first() as BillRow | undefined;
  if (!bill) {
    return { errors: ['Bill not found'] };
  }

  if (bill.status !== 'UNPAID') {
    return { errors: [`Cannot edit ${bill.status} bills`] };
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

  const newLineItems = payload.line_items || [];
  const taxRateMap = newLineItems.length > 0 ? await resolveTaxRateMap(newLineItems, db) : {};
  const newTotalAmount = newLineItems.length > 0
    ? calculateGrossTotalFromLineItems(newLineItems, taxRateMap)
    : dec(bill.amount);

  if (payload.line_items !== undefined || Boolean(bill.created_transaction_id)) {
    await db.transaction(async (trx: Knex.Transaction) => {
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
          contact.name,
          bill.bill_number || '',
          trx
        );
      }
    });
  }

  const updateData = {
    contact_id: payload.contact_id !== undefined ? payload.contact_id : bill.contact_id,
    date: payload.date !== undefined ? payload.date : bill.date,
    due_date: payload.due_date !== undefined ? (payload.due_date || null) : bill.due_date,
    bill_number: payload.bill_number !== undefined ? payload.bill_number?.trim() || null : bill.bill_number,
    description: payload.description !== undefined ? payload.description.trim() : bill.description,
    amount: newTotalAmount.toFixed(2),
    fund_id: payload.fund_id !== undefined ? payload.fund_id : bill.fund_id,
    updated_at: db.fn.now(),
  };

  await db('bills')
    .where({ id })
    .update(updateData)
    .returning('*');

  const billWithLineItems = await getBillWithLineItems(id);
  return { bill: billWithLineItems };
}

async function payBill(id: string, paymentData: PaymentBillInput, userId: number): Promise<BillMutationResult> {
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
  
  if (paymentData.amount !== undefined) {
    const paymentAmount = dec(paymentData.amount);
    if (!paymentAmount.equals(outstanding)) {
      return { 
        errors: [`Payment amount must equal outstanding balance ($${outstanding.toFixed(2)})`],
        outstanding: parseFloat(outstanding.toFixed(2))
      };
    }
  }

  const apAccount = await db('accounts')
    .where({ code: AP_ACCOUNT_CODE })
    .where('is_active', true)
    .first() as AccountRow | undefined;

  if (!apAccount) {
    return { errors: [`Accounts Payable account (${AP_ACCOUNT_CODE}) not found`] };
  }

  const result = await db.transaction(async (trx: Knex.Transaction) => {
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

    const amount = outstanding.toFixed(2);
    await trx('journal_entries').insert([
      {
        transaction_id: transaction.id,
        account_id: apAccount.id,
        fund_id: bill.fund_id,
        debit: amount,
        credit: 0,
        memo: `Payment for bill ${bill.bill_number || `#${bill.id}`}`,
        is_reconciled: false,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      },
      {
        transaction_id: transaction.id,
        account_id: bankAccount.id,
        fund_id: bill.fund_id,
        debit: 0,
        credit: amount,
        memo: `Payment for bill ${bill.bill_number || `#${bill.id}`}`,
        is_reconciled: false,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      },
    ]);

    const [updatedBill] = await trx('bills')
      .where({ id })
      .update({
        amount_paid: dec(bill.amount).toFixed(2),
        status: 'PAID',
        transaction_id: transaction.id,
        paid_by: userId,
        paid_at: trx.fn.now(),
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
      db.raw('COUNT(*) as count'),
      db.raw('SUM(amount - amount_paid) as total_outstanding'),
      db.raw('MIN(due_date) as earliest_due'),
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
  getAgingReport,
  getUnpaidSummary,
  getBillWithLineItems,
};
