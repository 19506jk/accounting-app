import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type {
  BillDetail,
  BillLineItemInput,
  CreateBillInput,
  PayBillInput,
  UpdateBillInput,
} from '@shared/contracts';
import type { BillRow, TransactionRow } from '../types/db';
import {
  normalizeDateOnly,
} from '../utils/date.js';
import { assertNotClosedPeriod } from '../utils/hardCloseGuard.js';
import {
  calculateGrossTotalFromLineItems,
  createMultiLineJournalEntries,
} from './bills/billPosting.js';
import { getBillWithLineItems } from './bills/billReadModel.js';
import {
  getAgingReport,
  getUnpaidSummary,
} from './bills/billReports.js';
import {
  applyBillCredits,
  getAvailableCreditsForBill,
  unapplyBillCredits,
} from './bills/billCredits.js';
import {
  AP_ACCOUNT_CODE,
  buildBillSettlementPatch,
  isSettledOutstanding,
  toBillStatus,
} from './bills/billSettlement.js';
import {
  resolveTaxRateMap,
  validateBillData,
  validateLineItemAccounts,
} from './bills/billValidation.js';

const db = require('../db') as Knex;

type Numeric = string | number;

type BillServiceResult = { errors: string[]; outstanding?: number } | { errors?: undefined };
type BillMutationResult = BillServiceResult & { bill?: BillDetail | null; transaction?: TransactionRow | null };
type BillPaymentTransactionResult = BillServiceResult & {
  bill?: BillDetail | null;
  transaction?: TransactionRow | null;
  bank_journal_entry_id?: number;
};

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

interface BillLineItemComparisonRow {
  expense_account_id: number;
  amount: Numeric;
  rounding_adjustment: Numeric;
  description: string | null;
  tax_rate_id: number | null;
}

const dec = (value: Numeric | null | undefined) => new Decimal(value ?? 0);

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

async function payBillInTransaction(
  id: string,
  paymentData: PayBillInput,
  userId: number,
  trx: Knex.Transaction,
  requireFullPayment = false
): Promise<BillPaymentTransactionResult> {
  const bill = await getBillWithLineItems(id, trx);
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

  const bankAccount = await trx('accounts')
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
  if (requireFullPayment && !paymentAmount.equals(outstanding)) {
    return {
      errors: [`Payment amount ($${paymentAmount.toFixed(2)}) does not match outstanding balance ($${outstanding.toFixed(2)})`],
      outstanding: parseFloat(outstanding.toFixed(2)),
    };
  }

  const apAccount = await trx('accounts')
    .where({ code: AP_ACCOUNT_CODE })
    .where('is_active', true)
    .first() as AccountRow | undefined;

  if (!apAccount) {
    return { errors: [`Accounts Payable account (${AP_ACCOUNT_CODE}) not found`] };
  }

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

  const bankEntry = await trx('journal_entries')
    .where({ transaction_id: transaction.id, account_id: bankAccount.id })
    .first('id') as { id: number } | undefined;
  if (!bankEntry) throw new Error('Failed to locate bank-side payment journal entry');

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

  const billWithLineItems = await getBillWithLineItems(id, trx);
  return { bill: billWithLineItems, transaction, bank_journal_entry_id: bankEntry.id };
}

async function payBill(id: string, paymentData: PayBillInput, userId: number): Promise<BillMutationResult> {
  const result = await db.transaction((trx: Knex.Transaction) => payBillInTransaction(id, paymentData, userId, trx));
  if (result.errors) return { errors: result.errors, outstanding: result.outstanding };
  return { bill: result.bill, transaction: result.transaction };
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

export {
  createBill,
  updateBill,
  payBill,
  payBillInTransaction,
  voidBill,
  getAvailableCreditsForBill,
  applyBillCredits,
  unapplyBillCredits,
  getAgingReport,
  getUnpaidSummary,
  getBillWithLineItems,
};
