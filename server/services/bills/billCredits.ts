import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type {
  ApplyBillCreditsInput,
  AvailableBillCredit,
  BillCreditApplication,
  BillDetail,
} from '@shared/contracts';
import type { BillCreditApplicationRow, BillRow, TransactionRow } from '../../types/db';
import {
  getChurchToday,
  isValidDateOnly,
  normalizeDateOnly,
} from '../../utils/date.js';
import { assertNotClosedPeriod } from '../../utils/hardCloseGuard.js';
import { getChurchTimeZone } from '../churchTimeZone.js';
import {
  AP_ACCOUNT_CODE,
  buildBillSettlementPatch,
  formatBillReference,
  getOutstanding,
} from './billSettlement.js';
import {
  getBillWithLineItems,
  normaliseApplications,
  type ApplicationJoinedRow,
} from './billReadModel.js';

const db = require('../../db') as Knex;

type Numeric = string | number;

interface AccountRow {
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

const dec = (value: Numeric | null | undefined) => new Decimal(value ?? 0);
const asDateOnlyString = (value: string | Date) => normalizeDateOnly(value);

async function getClosedBooksThrough(executor: Knex | Knex.Transaction) {
  const row = await executor('settings')
    .where({ key: 'books_closed_through' })
    .select('value')
    .first() as { value?: string | null } | undefined;
  if (!row?.value) return null;
  if (!isValidDateOnly(row.value)) return null;
  return row.value;
}

export async function getAvailableCreditsForBill(
  id: string | number,
  executor: Knex | Knex.Transaction = db
): Promise<AvailableBillCredit[]> {
  const target = await executor('bills').where({ id }).first() as BillRow | undefined;
  if (!target) return [];

  const targetOutstanding = getOutstanding(target.amount, target.amount_paid);
  if (targetOutstanding.lte(0)) return [];

  const credits = await executor('bills as b')
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

export async function unapplyBillCredits(
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

export async function applyBillCredits(
  id: string,
  payload: ApplyBillCreditsInput,
  userId: number,
  executor: Knex = db
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

  const result = await executor.transaction(async (trx: Knex.Transaction) => {
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
