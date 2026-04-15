import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type {
  ApplyBillCreditsInput,
  AvailableBillCredit,
  BillCreditApplication,
  BillDetail,
  BillLineItemInput,
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
} from '../utils/date.js';
import { getChurchTimeZone } from './churchTimeZone.js';
import { assertNotClosedPeriod } from '../utils/hardCloseGuard.js';
import {
  calculateGrossTotalFromLineItems,
  createMultiLineJournalEntries,
  getUniqueTaxRateIds,
  ROUNDING_ACCOUNT_CODE,
  type TaxRateRow,
} from './billPosting.js';
import {
  getBillWithLineItems,
  normaliseApplications,
  type ApplicationJoinedRow,
} from './billReadModel.js';
import {
  getAgingReport,
  getUnpaidSummary,
} from './billReports.js';

const db = require('../db') as Knex;

type Numeric = string | number;

type BillServiceResult = { errors: string[]; outstanding?: number } | { errors?: undefined };
type BillMutationResult = BillServiceResult & { bill?: BillDetail | null; transaction?: TransactionRow | null };

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

const dec = (value: Numeric | null | undefined) => new Decimal(value ?? 0);
const asDateOnlyString = (value: string | Date) => normalizeDateOnly(value);

const AP_ACCOUNT_CODE = '20000';
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

function buildBillSettlementPatch(
  bill: Pick<BillRow, 'amount'>,
  nextOutstanding: Decimal,
  userId: number,
  trx: Knex.Transaction
) {
  const isSettled = isSettledOutstanding(nextOutstanding);
  return {
    amount_paid: getAmountPaidFromOutstanding(bill.amount, nextOutstanding),
    status: toBillStatus(nextOutstanding),
    paid_by: isSettled ? userId : null,
    paid_at: isSettled ? trx.fn.now() : null,
    updated_at: trx.fn.now(),
  };
}

function formatBillReference(bill: Pick<BillRow, 'id' | 'bill_number'>) {
  return bill.bill_number ? `#${bill.bill_number}` : `#${bill.id}`;
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
  const taxRateIds = getUniqueTaxRateIds(lineItems);
  if (taxRateIds.length === 0) return {};

  const taxRates = await executor('tax_rates').whereIn('id', taxRateIds) as TaxRateRow[];
  return Object.fromEntries(taxRates.map((tr) => [tr.id, tr]));
}

async function validateLineItemAccounts(lineItems: BillLineItemInput[]): Promise<string[]> {
  const errors: string[] = [];

  // Pre-fetch all tax rates needed
  const taxRateIds = getUniqueTaxRateIds(lineItems);
  const taxRates = taxRateIds.length > 0
    ? await db('tax_rates').whereIn('id', taxRateIds).where('is_active', true)
    : [] as TaxRateRow[];
  const activeTaxRateIds = new Set((taxRates as TaxRateRow[]).map(tr => tr.id));
  const expenseAccountIds = [...new Set(lineItems.map(line => line?.expense_account_id).filter((id): id is number => Boolean(id)))];
  const accounts = expenseAccountIds.length > 0
    ? await db('accounts')
      .whereIn('id', expenseAccountIds)
      .where('is_active', true) as AccountRow[]
    : [];
  const accountMap = new Map(accounts.map(account => [account.id, account]));
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
    const account = accountMap.get(line.expense_account_id);

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
      const bill = await getBillWithLineItems(id, trx);
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
      .update(buildBillSettlementPatch(targetBill, targetOutstanding, userId, trx));

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
        .update(buildBillSettlementPatch(credit, nextOutstanding, userId, trx));
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

    const bill = await getBillWithLineItems(id, trx);
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
        .update(buildBillSettlementPatch(entry.bill, nextSourceOutstanding, userId, trx));

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
      .update(buildBillSettlementPatch(target, nextTargetOutstanding, userId, trx));

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

    const bill = await getBillWithLineItems(id, trx);
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

    const [updatedBill] = await trx('bills')
      .where({ id })
      .update({
        ...buildBillSettlementPatch(bill, newOutstanding, userId, trx),
        transaction_id: transaction.id,
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
