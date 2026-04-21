import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type { CreateFromBankRowInput, TransactionEntryInput } from '@shared/contracts';
import { isValidDateOnly } from '../../utils/date.js';
import { assertNotClosedPeriod } from '../../utils/hardCloseGuard.js';

const dec = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);

function serviceError(message: string, statusCode: number) {
  const err = new Error(message) as Error & { statusCode?: number };
  err.statusCode = statusCode;
  return err;
}

function ensurePositiveInteger(value: unknown, field: string, required = true) {
  if (value === undefined || value === null || value === '') {
    if (required) throw serviceError(`${field} must be a positive integer`, 400);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw serviceError(`${field} must be a positive integer`, 400);
  }
  return parsed;
}

function validateAndBuildEntries(payload: CreateFromBankRowInput & { bank_account_id: number; fund_id: number }): TransactionEntryInput[] {
  const amount = dec(payload.amount).toDecimalPlaces(2);
  if (amount.lte(0)) throw serviceError('amount must be greater than 0', 400);

  const hasSplits = Array.isArray(payload.splits) && payload.splits.length > 0;
  const entries: TransactionEntryInput[] = [];

  if (hasSplits) {
    const splitTotal = payload.splits!.reduce((sum, split) => sum.plus(dec(split.amount).toDecimalPlaces(2)), dec(0)).toDecimalPlaces(2);
    if (!splitTotal.equals(amount)) {
      throw serviceError('split amounts must equal amount', 400);
    }
  }

  if (payload.type === 'deposit') {
    entries.push({
      account_id: payload.bank_account_id,
      fund_id: payload.fund_id,
      debit: Number(amount.toFixed(2)),
      credit: 0,
      contact_id: payload.contact_id ?? null,
    });

    if (hasSplits) {
      payload.splits!.forEach((split, index) => {
        const splitAmount = dec(split.amount).toDecimalPlaces(2);
        const offsetAccountId = ensurePositiveInteger(split.offset_account_id, `splits[${index}].offset_account_id`);
        const splitFundId = ensurePositiveInteger(split.fund_id, `splits[${index}].fund_id`);
        entries.push({
          account_id: Number(offsetAccountId),
          fund_id: Number(splitFundId),
          debit: 0,
          credit: Number(splitAmount.toFixed(2)),
          contact_id: split.contact_id ?? null,
          memo: split.memo ?? undefined,
        });
      });
      return entries;
    }

    const offsetAccountId = ensurePositiveInteger(payload.offset_account_id, 'offset_account_id');
    if (offsetAccountId === payload.bank_account_id) {
      throw serviceError('offset_account_id cannot match bank account', 400);
    }
    entries.push({
      account_id: Number(offsetAccountId),
      fund_id: payload.fund_id,
      debit: 0,
      credit: Number(amount.toFixed(2)),
      contact_id: payload.contact_id ?? null,
    });
    return entries;
  }

  entries.push({
    account_id: payload.bank_account_id,
    fund_id: payload.fund_id,
    debit: 0,
    credit: Number(amount.toFixed(2)),
    contact_id: payload.payee_id ?? null,
  });

  if (hasSplits) {
    if (payload.payee_id === undefined || payload.payee_id === null) {
      throw serviceError('payee_id is required for withdrawal splits', 400);
    }
    const payeeId = ensurePositiveInteger(payload.payee_id, 'payee_id');
    payload.splits!.forEach((split, index) => {
      const splitAmount = dec(split.amount).toDecimalPlaces(2);
      const expenseAccountId = ensurePositiveInteger(split.expense_account_id, `splits[${index}].expense_account_id`);
      const splitFundId = ensurePositiveInteger(split.fund_id, `splits[${index}].fund_id`);
      entries.push({
        account_id: Number(expenseAccountId),
        fund_id: Number(splitFundId),
        debit: Number(splitAmount.toFixed(2)),
        credit: 0,
        contact_id: Number(payeeId),
        memo: split.description ?? undefined,
      });
    });
    return entries;
  }

  const offsetAccountId = ensurePositiveInteger(payload.offset_account_id, 'offset_account_id');
  if (offsetAccountId === payload.bank_account_id) {
    throw serviceError('offset_account_id cannot match bank account', 400);
  }
  entries.push({
    account_id: Number(offsetAccountId),
    fund_id: payload.fund_id,
    debit: Number(amount.toFixed(2)),
    credit: 0,
    contact_id: payload.payee_id ?? null,
  });
  return entries;
}

export async function createFromBankRow(
  payload: CreateFromBankRowInput & { bank_account_id: number; fund_id: number },
  userId: number,
  trx: Knex.Transaction,
): Promise<{ transaction_id: number; bank_je_id: number }> {
  if (!isValidDateOnly(payload.date)) throw serviceError('date is not a valid date (YYYY-MM-DD)', 400);
  if (!payload.description || !String(payload.description).trim()) {
    throw serviceError('description is required', 400);
  }
  if (payload.type !== 'deposit' && payload.type !== 'withdrawal') {
    throw serviceError("type must be 'withdrawal' or 'deposit'", 400);
  }

  const entries = validateAndBuildEntries(payload);
  await assertNotClosedPeriod(payload.date, trx);

  const [tx] = await trx('transactions')
    .insert({
      date: payload.date,
      description: payload.description.trim(),
      reference_no: payload.reference_no?.trim() || null,
      fund_id: payload.fund_id,
      created_by: userId,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    })
    .returning('id') as Array<number | { id: number }>;

  const transactionId = typeof tx === 'number' ? tx : tx?.id;
  if (!transactionId) throw new Error('Failed to create transaction');

  await trx('journal_entries').insert(
    entries.map((entry) => ({
      transaction_id: transactionId,
      account_id: entry.account_id,
      fund_id: entry.fund_id,
      contact_id: entry.contact_id ?? null,
      debit: dec(entry.debit ?? 0).toFixed(2),
      credit: dec(entry.credit ?? 0).toFixed(2),
      memo: entry.memo?.trim() || null,
      is_reconciled: false,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    }))
  );

  const bankEntry = await trx('journal_entries')
    .where({ transaction_id: transactionId, account_id: payload.bank_account_id })
    .first('id') as { id: number } | undefined;
  if (!bankEntry) throw new Error('Failed to locate bank-side journal entry');

  return {
    transaction_id: transactionId,
    bank_je_id: bankEntry.id,
  };
}
