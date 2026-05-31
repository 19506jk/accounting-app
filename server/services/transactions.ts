import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type {
  CreateTransactionInput,
  TransactionCreateResult,
  TransactionDetail,
  TransactionEntryDetail,
  TransactionEntryInput,
  UpdateTransactionEntryInput,
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
import { computeDiff, type ForensicContext, writeForensicEntry } from './auditLog.js';
import { formatPaymentMethodList, isValidPaymentMethod } from './transactions/paymentMethods.js';

const db = require('../db') as Knex;

type DbHandle = Knex | Knex.Transaction;
type TransactionValidationResult = {
  errors: string[];
  accountTypesById: Map<number, AccountRow['type']>;
};
type TransactionValidationOptions = {
  requirePaymentMethod?: boolean;
};

const dec = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);

function serviceError(message: string, status: number, validationErrors?: string[]) {
  return Object.assign(new Error(message), {
    status,
    statusCode: status,
    validationErrors,
  });
}

function transactionSnapshot(
  row: TransactionRow,
  entries?: Array<Pick<TransactionEntryDetailRow, 'credit' | 'payment_method'> | Pick<JournalEntryRow, 'credit' | 'payment_method'>>
) {
  return {
    id: row.id,
    date: normalizeDateOnly(row.date),
    description: row.description,
    reference_no: row.reference_no,
    fund_id: row.fund_id,
    payment_method: entries ? deriveRepresentativePaymentMethod(entries) : null,
  };
}

function entrySnapshots(entries: JournalEntryRow[]) {
  return entries.map((entry) => ({
    id: entry.id,
    account_id: entry.account_id,
    fund_id: entry.fund_id,
    debit: entry.debit,
    credit: entry.credit,
    payment_method: entry.payment_method ?? null,
    memo: entry.memo,
    contact_id: entry.contact_id,
  }));
}

function deriveRepresentativePaymentMethod(
  entries: Array<Pick<TransactionEntryDetailRow, 'credit' | 'payment_method'> | Pick<JournalEntryRow, 'credit' | 'payment_method'>>
) {
  const creditEntries = entries.filter((entry) => dec(entry.credit).gt(0));
  if (creditEntries.length === 0) return null;

  const methods = new Set(creditEntries.map((entry) => entry.payment_method ?? null));
  if (methods.size !== 1) return null;

  const [method] = methods;
  return method ?? null;
}

function classifyTransactionType(hasIncomeCredit: boolean, hasExpenseDebit: boolean): TransactionDetail['transaction_type'] {
  return hasIncomeCredit ? 'deposit' : hasExpenseDebit ? 'withdrawal' : 'transfer';
}

function paymentMethodValidationError(paymentMethod: string | null | undefined, allowsPaymentMethod: boolean) {
  if (paymentMethod != null && !isValidPaymentMethod(paymentMethod)) {
    return `payment_method must be one of: ${formatPaymentMethodList()}`;
  }
  if (paymentMethod != null && !allowsPaymentMethod) {
    return 'payment_method is only allowed on credit entries';
  }
  return null;
}

function normalizePaymentMethodForPersistence(
  paymentMethod: string | null | undefined,
  allowsPaymentMethod: boolean,
  entryPrefix?: string
) {
  const prefix = entryPrefix ? `${entryPrefix} ` : '';
  const error = paymentMethodValidationError(paymentMethod, allowsPaymentMethod);
  if (error) {
    throw serviceError('Validation failed', 400, [`${prefix}${error}`]);
  }
  return paymentMethod ?? null;
}

function normalizeUpdatedEntryPaymentMethod(
  paymentMethod: string | null | undefined,
  allowsPaymentMethod: boolean,
  entryIndex: number
) {
  const entryPrefix = `Entry ${entryIndex + 1}:`;
  return normalizePaymentMethodForPersistence(paymentMethod, allowsPaymentMethod, entryPrefix);
}

function normalizeReplacementEntryPaymentMethods(entries: UpdateTransactionEntryInput[]) {
  return entries.map((entry, index) => normalizeUpdatedEntryPaymentMethod(
    entry.payment_method,
    dec(entry.credit ?? 0).gt(0),
    index
  ));
}

function deriveTransactionTypeForEntries<T>(
  entries: T[],
  getAccountType: (entry: T) => AccountRow['type'] | undefined,
  getCredit: (entry: T) => Decimal.Value | null | undefined,
  getDebit: (entry: T) => Decimal.Value | null | undefined
): TransactionDetail['transaction_type'] {
  const hasIncomeCredit = entries.some((entry) => getAccountType(entry) === 'INCOME' && dec(getCredit(entry)).gt(0));
  const hasExpenseDebit = entries.some((entry) => getAccountType(entry) === 'EXPENSE' && dec(getDebit(entry)).gt(0));
  return classifyTransactionType(hasIncomeCredit, hasExpenseDebit);
}

function deriveTransactionType(
  entries: Array<Pick<TransactionEntryDetailRow, 'account_type' | 'credit' | 'debit'>>
): TransactionDetail['transaction_type'] {
  return deriveTransactionTypeForEntries(
    entries,
    (entry) => entry.account_type,
    (entry) => entry.credit,
    (entry) => entry.debit
  );
}

function deriveTransactionTypeFromInputs(
  entries: TransactionEntryInput[],
  accountTypeById: Map<number, AccountRow['type']>
): TransactionDetail['transaction_type'] {
  return deriveTransactionTypeForEntries(
    entries,
    (entry) => accountTypeById.get(entry.account_id),
    (entry) => entry.credit,
    (entry) => entry.debit
  );
}

async function validateTransaction(
  body: CreateTransactionInput,
  dbOrTrx: DbHandle = db,
  options: TransactionValidationOptions = {}
): Promise<TransactionValidationResult> {
  const errors: string[] = [];
  const accountTypesById = new Map<number, AccountRow['type']>();
  const { date, description, entries } = body;

  if (!date) errors.push('date is required');
  if (!description?.trim()) errors.push('description is required');

  if (!Array.isArray(entries) || entries.length < 2) {
    errors.push('At least 2 journal entry lines are required');
    return { errors, accountTypesById };
  }

  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    if (!e) continue;
    const prefix = `Entry ${i + 1}:`;

    if (!e.account_id) errors.push(`${prefix} account_id is required`);
    if (!e.fund_id) errors.push(`${prefix} fund_id is required`);
    const debit = dec(e.debit ?? 0);
    const credit = dec(e.credit ?? 0);
    if (options.requirePaymentMethod && e.payment_method === undefined && credit.gt(0)) {
      errors.push(`${prefix} payment_method must be provided when updating entries`);
    }

    const paymentMethodError = paymentMethodValidationError(e.payment_method, credit.gt(0));
    if (paymentMethodError) errors.push(`${prefix} ${paymentMethodError}`);

    if (debit.isNegative() || credit.isNegative()) errors.push(`${prefix} amounts must be positive`);
    if (debit.isZero() && credit.isZero()) errors.push(`${prefix} must have either a debit or credit amount`);
    if (!debit.isZero() && !credit.isZero()) errors.push(`${prefix} cannot have both debit and credit amounts`);
    if (debit.decimalPlaces() > 2) errors.push(`${prefix} debit cannot have more than 2 decimal places`);
    if (credit.decimalPlaces() > 2) errors.push(`${prefix} credit cannot have more than 2 decimal places`);
  }

  if (errors.length) return { errors, accountTypesById };

  const totalDebit = entries.reduce((sum, e) => sum.plus(dec(e.debit ?? 0)), dec(0));
  if (totalDebit.isZero()) {
    errors.push('Transaction total cannot be zero');
    return { errors, accountTypesById };
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

  if (errors.length) return { errors, accountTypesById };

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
  accounts.forEach((account) => {
    accountTypesById.set(account.id, account.type);
  });
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

  return { errors, accountTypesById };
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
      'je.payment_method',
      'je.memo',
      'je.is_reconciled',
      'je.contact_id',
      'c.name as contact_name'
    )
    .orderBy('je.id', 'asc') as TransactionEntryDetailRow[];

  const totalAmount = entries.reduce((sum, e) => sum.plus(dec(e.debit)), dec(0));

  return {
    ...transaction,
    payment_method: deriveRepresentativePaymentMethod(entries),
    transaction_type: deriveTransactionType(entries),
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

async function createTransaction(payload: CreateTransactionInput, userId: number, ctx: ForensicContext): Promise<TransactionCreateResult> {
  const { date, description, reference_no, entries } = payload || {};
  const result: { transaction: TransactionRow; entries: JournalEntryRow[]; transactionType: TransactionDetail['transaction_type'] } = await db.transaction(async (trx: Knex.Transaction) => {
    const { errors, accountTypesById } = await validateTransaction(payload, trx);
    if (errors.length) throw serviceError('Validation failed', 400, errors);
    const transactionType = deriveTransactionTypeFromInputs(entries, accountTypesById);
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
      payment_method: normalizePaymentMethodForPersistence(
        e.payment_method,
        dec(e.credit ?? 0).gt(0)
      ),
      memo: e.memo?.trim() || null,
      is_reconciled: false,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    }));

    const insertedEntries = await trx('journal_entries').insert(entryRows).returning('*') as JournalEntryRow[];
    await writeForensicEntry(trx, ctx, {
      entity_type: 'transaction',
      entity_id: transaction.id,
      entity_label: `${normalizeDateOnly(transaction.date)} - ${transaction.description}`,
      action: 'create',
      payload: {
        new: {
          transaction: transactionSnapshot(transaction, insertedEntries),
          entries: entrySnapshots(insertedEntries),
        },
      },
    });
    return { transaction, entries: insertedEntries, transactionType };
  });

  return {
    ...result.transaction,
    payment_method: deriveRepresentativePaymentMethod(result.entries),
    transaction_type: result.transactionType,
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

async function updateTransaction(id: string, payload: UpdateTransactionInput, ctx: ForensicContext): Promise<TransactionDetail> {
  const { date, description, reference_no, entries } = payload || {};

  await db.transaction(async (trx: Knex.Transaction) => {
    const beforeTx = await trx('transactions')
      .where({ id })
      .first() as TransactionRow | undefined;
    if (!beforeTx) {
      throw serviceError('Transaction not found', 404);
    }
    if (beforeTx.is_voided) {
      throw serviceError('Voided transactions cannot be edited.', 422);
    }

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

    const nextDate = date || normalizeDateOnly(beforeTx.date);
    const nextDescription = description?.trim() || beforeTx.description;
    const nextReferenceNo = reference_no !== undefined ? reference_no?.trim() || null : beforeTx.reference_no;

    await assertNotClosedPeriod(normalizeDateOnly(beforeTx.date), trx);
    await assertNotClosedPeriod(nextDate, trx);

    const beforeEntries = await trx('journal_entries')
      .where({ transaction_id: id })
      .orderBy('id', 'asc') as JournalEntryRow[];
    const isAnyReconciled = beforeEntries.some((e) => e.is_reconciled);

    if (entries !== undefined) {
      const validationPayload: CreateTransactionInput = {
        date: nextDate,
        description: nextDescription,
        reference_no: nextReferenceNo ?? undefined,
        entries,
      };
      const { errors } = await validateTransaction(validationPayload, trx, {
        requirePaymentMethod: !isAnyReconciled,
      });
      if (errors.length) {
        throw serviceError('Validation failed', 400, errors);
      }

      if (isAnyReconciled) {
        if (entries.length !== beforeEntries.length) {
          throw serviceError('Cannot add/remove lines on reconciled transactions', 400);
        }

        for (let i = 0; i < entries.length; i += 1) {
          const incoming = entries[i];
          const current = beforeEntries[i];
          if (!incoming || !current) {
            throw serviceError('Invalid journal entry payload', 400);
          }

          const incomingDebit = dec(incoming.debit ?? 0).toFixed(2);
          const currentDebit = dec(current.debit ?? 0).toFixed(2);
          const incomingCredit = dec(incoming.credit ?? 0).toFixed(2);
          const currentCredit = dec(current.credit ?? 0).toFixed(2);
          const accountChanged = Number(incoming.account_id) !== Number(current.account_id);
          const fundChanged = Number(incoming.fund_id) !== Number(current.fund_id);
          const debitChanged = incomingDebit !== currentDebit;
          const creditChanged = incomingCredit !== currentCredit;

          if (accountChanged || fundChanged || debitChanged || creditChanged) {
            throw serviceError('Reconciled transactions only allow contact, memo, and payment method changes', 400);
          }
        }
      }
    }

    const nextFundId = entries?.[0]?.fund_id ?? beforeTx.fund_id;

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

    let finalEntries: JournalEntryRow[];
    if (entries !== undefined && isAnyReconciled) {
      let entriesChanged = false;

      for (let i = 0; i < entries.length; i += 1) {
        const incoming = entries[i];
        const current = beforeEntries[i];
        if (!incoming || !current) continue;

        const incomingContactId = incoming.contact_id ? Number(incoming.contact_id) : null;
        const currentContactId = current.contact_id ? Number(current.contact_id) : null;
        const incomingMemo = incoming.memo?.trim() || null;
        const currentMemo = current.memo || null;
        const currentPaymentMethod = current.payment_method ?? null;
        const incomingPaymentMethod = incoming.payment_method === undefined
          ? currentPaymentMethod
          : normalizePaymentMethodForPersistence(
            incoming.payment_method,
            dec(current.credit).gt(0),
            `Entry ${i + 1}:`
          );
        if (
          incomingContactId === currentContactId
          && incomingMemo === currentMemo
          && incomingPaymentMethod === currentPaymentMethod
        ) continue;

        await trx('journal_entries')
          .where({ id: current.id })
          .update({
            contact_id: incomingContactId,
            memo: incomingMemo,
            payment_method: incomingPaymentMethod,
            updated_at: trx.fn.now(),
          });
        entriesChanged = true;
      }

      finalEntries = entriesChanged
        ? await trx('journal_entries')
          .where({ transaction_id: id })
          .orderBy('id', 'asc') as JournalEntryRow[]
        : beforeEntries;
    } else if (entries !== undefined) {
      const normalizedReplacementPaymentMethods = normalizeReplacementEntryPaymentMethods(entries);

      await trx('journal_entries')
        .where({ transaction_id: id })
        .delete();

      const entryRows = entries.map((e, index) => ({
        transaction_id: Number(id),
        account_id: e.account_id,
        fund_id: e.fund_id,
        contact_id: e.contact_id || null,
        debit: dec(e.debit ?? 0).toFixed(2),
        credit: dec(e.credit ?? 0).toFixed(2),
        payment_method: normalizedReplacementPaymentMethods[index] ?? null,
        memo: e.memo?.trim() || null,
        is_reconciled: false,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      }));
      finalEntries = await trx('journal_entries').insert(entryRows).returning('*') as JournalEntryRow[];
    } else {
      finalEntries = await trx('journal_entries')
        .where({ transaction_id: id })
        .orderBy('id', 'asc') as JournalEntryRow[];
    }

    const beforeHeader = transactionSnapshot(beforeTx, beforeEntries);
    const afterHeader = transactionSnapshot(updated, finalEntries);
    const diff = computeDiff(beforeHeader, afterHeader);

    await writeForensicEntry(trx, ctx, {
      entity_type: 'transaction',
      entity_id: id,
      entity_label: `${afterHeader.date} - ${afterHeader.description}`,
      action: 'update',
      payload: {
        old: {
          transaction: beforeHeader,
          entries: entrySnapshots(beforeEntries),
        },
        new: {
          transaction: afterHeader,
          entries: entrySnapshots(finalEntries),
        },
        fields_changed: diff.fields_changed,
      },
    });
  });

  const detail = await getTransactionDetailById(id);
  if (!detail) throw serviceError('Transaction not found', 404);
  return detail;
}

async function deleteTransaction(id: string, ctx: ForensicContext): Promise<void> {
  await db.transaction(async (trx: Knex.Transaction) => {
    const transaction = await trx('transactions')
      .where({ id })
      .first() as TransactionRow | undefined;
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

    const beforeEntries = await trx('journal_entries')
      .where({ transaction_id: id })
      .orderBy('id', 'asc') as JournalEntryRow[];

    await trx('transactions').where({ id }).delete();

    await writeForensicEntry(trx, ctx, {
      entity_type: 'transaction',
      entity_id: id,
      entity_label: `${normalizeDateOnly(transaction.date)} - ${transaction.description}`,
      action: 'delete',
      payload: {
        old: {
          transaction: transactionSnapshot(transaction, beforeEntries),
          entries: entrySnapshots(beforeEntries),
        },
      },
    });
  });
}

export = {
  getTransactionDetailById,
  createTransaction,
  updateTransaction,
  deleteTransaction,
};
