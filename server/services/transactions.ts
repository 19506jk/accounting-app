import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type {
  CreateTransactionInput,
  TransactionCreateResult,
  TransactionDetail,
  TransactionEntryDetail,
  UpdateTransactionInput,
} from '@shared/contracts';
import type {
  AccountRow,
  FundRow,
  JournalEntryRow,
  TransactionEntryDetailRow,
  TransactionRow,
} from '../types/db';
import { addDaysDateOnly, compareDateOnly, getChurchToday, normalizeDateOnly, parseDateOnlyStrict } from '../utils/date.js';
import { getChurchTimeZone } from './churchTimeZone.js';
import { assertNotClosedPeriod } from '../utils/hardCloseGuard.js';

const db = require('../db') as Knex;

type DbHandle = Knex | Knex.Transaction;

const dec = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);

function serviceError(message: string, status: number, validationErrors?: string[]) {
  return Object.assign(new Error(message), {
    status,
    statusCode: status,
    validationErrors,
  });
}

async function validateTransaction(body: CreateTransactionInput, dbOrTrx: DbHandle = db): Promise<string[]> {
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
      const fund = await dbOrTrx('funds').where({ id: fundId }).first() as FundRow | undefined;
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
  const accounts = await dbOrTrx('accounts').whereIn('id', accountIds).where('is_active', true) as AccountRow[];
  const foundAccIds = new Set(accounts.map((a) => a.id));
  for (const id of accountIds) {
    if (!foundAccIds.has(id)) errors.push(`Account #${id} does not exist or is inactive`);
  }

  const fundIds = [...new Set(entries.map((e) => e.fund_id))];
  const funds = await dbOrTrx('funds').whereIn('id', fundIds).where('is_active', true) as FundRow[];
  const foundFundIds = new Set(funds.map((f) => f.id));
  for (const id of fundIds) {
    if (!foundFundIds.has(id)) errors.push(`Fund #${id} does not exist or is inactive`);
  }

  const entryContactIds = [...new Set(entries.map((e) => e.contact_id).filter(Boolean))] as number[];
  if (entryContactIds.length > 0) {
    const entryContacts = await dbOrTrx('contacts').whereIn('id', entryContactIds).where('is_active', true) as { id: number }[];
    const foundContactIds = new Set(entryContacts.map((c) => c.id));
    for (const id of entryContactIds) {
      if (!foundContactIds.has(id)) errors.push(`Contact #${id} does not exist or is inactive`);
    }
  }

  return errors;
}

async function getTransactionDetailById(id: string | number, dbOrTrx: DbHandle = db): Promise<TransactionDetail | null> {
  const transaction = await dbOrTrx('transactions as t')
    .leftJoin('users as u', 'u.id', 't.created_by')
    .where('t.id', id)
    .select(
      't.id',
      't.date',
      't.description',
      't.reference_no',
      't.fund_id',
      't.created_at',
      't.is_voided',
      'u.name as created_by_name'
    )
    .first() as (TransactionRow & { created_by_name: string | null }) | undefined;

  if (!transaction) return null;

  const entries = await dbOrTrx('journal_entries as je')
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

async function createTransaction(payload: CreateTransactionInput, userId: number): Promise<TransactionCreateResult> {
  const { date, description, reference_no, entries } = payload || {};
  const errors = await validateTransaction(payload);
  if (errors.length) throw serviceError('Validation failed', 400, errors);

  const result: { transaction: TransactionRow; entries: JournalEntryRow[] } = await db.transaction(async (trx: Knex.Transaction) => {
    const firstEntry = entries[0];
    if (!firstEntry) throw new Error('At least one entry is required');

    await assertNotClosedPeriod(date, trx);

    const [transaction] = await trx('transactions')
      .insert({
        date,
        description: description.trim(),
        reference_no: reference_no?.trim() || null,
        fund_id: firstEntry.fund_id,
        created_by: userId,
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

  return {
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
}

async function updateTransaction(id: string, payload: UpdateTransactionInput): Promise<TransactionDetail> {
  const { date, description, reference_no, entries } = payload || {};

  const transaction = await db('transactions').where({ id }).first() as TransactionRow | undefined;
  if (!transaction) throw serviceError('Transaction not found', 404);
  if (transaction.is_voided) throw serviceError('Voided transactions cannot be edited.', 422);

  if (date) {
    if (!parseDateOnlyStrict(date)) {
      throw serviceError('date is not a valid date (YYYY-MM-DD)', 400);
    }
    const timezone = getChurchTimeZone();
    const today = getChurchToday(timezone);
    const maxDate = addDaysDateOnly(today, 1, timezone);
    if (compareDateOnly(date, maxDate) > 0) {
      throw serviceError('Transaction date cannot be more than 1 day in the future', 400);
    }
  }

  const nextDate = date || normalizeDateOnly(transaction.date);
  const nextDescription = description?.trim() || transaction.description;
  const nextReferenceNo = reference_no !== undefined ? reference_no?.trim() || null : transaction.reference_no;

  await db.transaction(async (trx: Knex.Transaction) => {
    const existingTx = await trx('transactions')
      .where({ id })
      .select('date', 'is_voided')
      .first() as Pick<TransactionRow, 'date' | 'is_voided'> | undefined;
    if (!existingTx) {
      throw serviceError('Transaction not found', 404);
    }
    if (existingTx.is_voided) {
      throw serviceError('Voided transactions cannot be edited.', 422);
    }
    await assertNotClosedPeriod(normalizeDateOnly(existingTx.date), trx);
    await assertNotClosedPeriod(nextDate, trx);

    if (entries !== undefined) {
      const validationPayload: CreateTransactionInput = {
        date: nextDate,
        description: nextDescription,
        reference_no: nextReferenceNo ?? undefined,
        entries,
      };
      const errors = await validateTransaction(validationPayload, trx);
      if (errors.length) {
        throw serviceError('Validation failed', 400, errors);
      }

      const existingEntries = await trx('journal_entries')
        .where({ transaction_id: id })
        .orderBy('id', 'asc') as JournalEntryRow[];

      const isAnyReconciled = existingEntries.some((e) => e.is_reconciled);

      if (isAnyReconciled) {
        if (entries.length !== existingEntries.length) {
          throw serviceError('Cannot add/remove lines on reconciled transactions', 400);
        }

        for (let i = 0; i < entries.length; i += 1) {
          const incoming = entries[i];
          const current = existingEntries[i];
          if (!incoming || !current) {
            throw serviceError('Invalid journal entry payload', 400);
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
            throw serviceError('Reconciled transactions only allow donor/payee changes', 400);
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
  if (!detail) throw serviceError('Transaction not found', 404);
  return detail;
}

async function deleteTransaction(id: string): Promise<void> {
  await db.transaction(async (trx: Knex.Transaction) => {
    const transaction = await trx('transactions')
      .where({ id })
      .select('date', 'is_closing_entry', 'is_voided')
      .first() as Pick<TransactionRow, 'date' | 'is_closing_entry' | 'is_voided'> | undefined;
    if (!transaction) throw serviceError('Transaction not found', 404);

    if (transaction.is_voided) {
      throw serviceError('Voided transactions cannot be deleted.', 422);
    }

    if (transaction.is_closing_entry) {
      throw serviceError('Closing entries cannot be deleted. Use the Reopen Period utility.', 422);
    }

    await assertNotClosedPeriod(normalizeDateOnly(transaction.date), trx);

    const reconciledEntry = await trx('journal_entries')
      .where({ transaction_id: id, is_reconciled: true })
      .first() as JournalEntryRow | undefined;

    if (reconciledEntry) {
      throw serviceError('Transaction cannot be deleted — one or more entries have been reconciled.', 409);
    }

    await trx('transactions').where({ id }).delete();
  });
}

export = {
  getTransactionDetailById,
  createTransaction,
  updateTransaction,
  deleteTransaction,
};
