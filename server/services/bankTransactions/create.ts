import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type { CreateFromBankRowInput, TransactionEntryInput } from '@shared/contracts';
import { isValidDateOnly } from '../../utils/date.js';
import { assertNotClosedPeriod } from '../../utils/hardCloseGuard.js';

const dec = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
const ROUNDING_ACCOUNT_CODE = '59999';
const MAX_ROUNDING_ADJUSTMENT = dec('0.10');

interface TaxRateRow {
  id: number;
  name: string;
  rate: string | number;
  recoverable_account_id: number | null;
}

interface AccountIdRow {
  id: number;
}

interface BuildEntryContext {
  taxRateMap: Map<number, TaxRateRow>;
  activeRecoverableAccountIds: Set<number>;
  roundingAccount: AccountIdRow | null;
}

interface BuiltTransactionEntry extends TransactionEntryInput {
  tax_rate_id?: number | null;
}

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

function validateAndBuildEntries(
  payload: CreateFromBankRowInput & { bank_account_id: number; fund_id: number },
  context: BuildEntryContext
): BuiltTransactionEntry[] {
  const amount = dec(payload.amount).toDecimalPlaces(2);
  if (amount.lte(0)) throw serviceError('amount must be greater than 0', 400);

  const hasSplits = Array.isArray(payload.splits) && payload.splits.length > 0;
  const entries: BuiltTransactionEntry[] = [];

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
      if (splitAmount.lte(0)) throw serviceError(`splits[${index}].amount must be greater than 0`, 400);
      if (splitAmount.decimalPlaces() > 2) throw serviceError(`splits[${index}].amount cannot have more than 2 decimal places`, 400);
      const expenseAccountId = ensurePositiveInteger(split.expense_account_id, `splits[${index}].expense_account_id`);
      const splitFundId = ensurePositiveInteger(split.fund_id, `splits[${index}].fund_id`);

      const preTaxAmount = dec(split.pre_tax_amount).toDecimalPlaces(2);
      if (preTaxAmount.lte(0)) throw serviceError(`splits[${index}].pre_tax_amount must be greater than 0`, 400);
      if (preTaxAmount.decimalPlaces() > 2) throw serviceError(`splits[${index}].pre_tax_amount cannot have more than 2 decimal places`, 400);

      const roundingAdjustment = dec(split.rounding_adjustment ?? 0).toDecimalPlaces(2);
      if (roundingAdjustment.decimalPlaces() > 2) throw serviceError(`splits[${index}].rounding_adjustment cannot have more than 2 decimal places`, 400);
      if (roundingAdjustment.abs().gt(MAX_ROUNDING_ADJUSTMENT)) {
        throw serviceError(`splits[${index}].rounding_adjustment cannot exceed ${MAX_ROUNDING_ADJUSTMENT.toFixed(2)} in absolute value`, 400);
      }

      const taxRateId = split.tax_rate_id === undefined || split.tax_rate_id === null ? null : ensurePositiveInteger(split.tax_rate_id, `splits[${index}].tax_rate_id`);
      const taxRate = taxRateId ? context.taxRateMap.get(taxRateId) : null;
      if (taxRateId && !taxRate) {
        throw serviceError(`splits[${index}].tax_rate_id #${taxRateId} does not exist or is inactive`, 400);
      }
      if (taxRateId && taxRate && !taxRate.recoverable_account_id) {
        throw serviceError(`splits[${index}].selected tax rate has no recoverable_account_id configured`, 400);
      }
      if (
        taxRate?.recoverable_account_id
        && !context.activeRecoverableAccountIds.has(Number(taxRate.recoverable_account_id))
      ) {
        throw serviceError(`splits[${index}].recoverable account #${taxRate.recoverable_account_id} does not exist or is inactive`, 400);
      }

      const taxAmount = taxRate ? preTaxAmount.times(dec(taxRate.rate)).toDecimalPlaces(2) : dec(0);
      const computedGross = preTaxAmount.plus(taxAmount).plus(roundingAdjustment).toDecimalPlaces(2);
      if (!computedGross.equals(splitAmount)) {
        throw serviceError(`splits[${index}].amount ${splitAmount.toFixed(2)} must equal pre_tax + tax + rounding (${computedGross.toFixed(2)})`, 400);
      }

      entries.push({
        account_id: Number(expenseAccountId),
        fund_id: Number(splitFundId),
        debit: Number(preTaxAmount.toFixed(2)),
        credit: 0,
        contact_id: Number(payeeId),
        memo: split.description ?? undefined,
        tax_rate_id: taxRateId,
      });

      if (taxAmount.gt(0) && taxRate?.recoverable_account_id) {
        entries.push({
          account_id: Number(taxRate.recoverable_account_id),
          fund_id: Number(splitFundId),
          debit: Number(taxAmount.toFixed(2)),
          credit: 0,
          contact_id: Number(payeeId),
          memo: `${taxRate.name || 'Tax'} on ${split.description || payload.description}`,
        });
      }

      if (!roundingAdjustment.isZero()) {
        if (!context.roundingAccount) {
          throw serviceError(`Rounding account ${ROUNDING_ACCOUNT_CODE} is missing or inactive`, 400);
        }
        entries.push({
          account_id: context.roundingAccount.id,
          fund_id: Number(splitFundId),
          debit: roundingAdjustment.gt(0) ? Number(roundingAdjustment.toFixed(2)) : 0,
          credit: roundingAdjustment.lt(0) ? Number(roundingAdjustment.abs().toFixed(2)) : 0,
          contact_id: Number(payeeId),
          memo: split.description ? `Rounding adjustment - ${split.description}` : 'Rounding adjustment',
        });
      }
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

function getWithdrawalSplitTaxRateIds(payload: CreateFromBankRowInput) {
  if (payload.type !== 'withdrawal' || !Array.isArray(payload.splits)) return [];
  return Array.from(new Set(
    payload.splits
      .map((split) => split.tax_rate_id)
      .filter((id): id is number => Number.isInteger(Number(id)) && Number(id) > 0)
      .map(Number)
  ));
}

function hasNonZeroRounding(payload: CreateFromBankRowInput) {
  if (payload.type !== 'withdrawal' || !Array.isArray(payload.splits)) return false;
  return payload.splits.some((split) => {
    try {
      return !dec(split.rounding_adjustment ?? 0).toDecimalPlaces(2).isZero();
    } catch {
      return false;
    }
  });
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

  const taxRateIds = getWithdrawalSplitTaxRateIds(payload);
  const taxRates = taxRateIds.length > 0
    ? await trx('tax_rates')
      .whereIn('id', taxRateIds)
      .where('is_active', true)
      .select('id', 'name', 'rate', 'recoverable_account_id') as TaxRateRow[]
    : [];
  const taxRateMap = new Map(taxRates.map((taxRate) => [taxRate.id, taxRate]));
  const recoverableAccountIds = Array.from(new Set(
    taxRates
      .map((taxRate) => taxRate.recoverable_account_id)
      .filter((id): id is number => Number.isInteger(Number(id)) && Number(id) > 0)
      .map(Number)
  ));
  const recoverableAccounts = recoverableAccountIds.length > 0
    ? await trx('accounts')
      .whereIn('id', recoverableAccountIds)
      .where('is_active', true)
      .select('id') as AccountIdRow[]
    : [];
  const roundingAccount = hasNonZeroRounding(payload)
    ? await trx('accounts')
      .where({ code: ROUNDING_ACCOUNT_CODE, is_active: true })
      .first('id') as AccountIdRow | undefined
    : null;

  const entries = validateAndBuildEntries(payload, {
    taxRateMap,
    activeRecoverableAccountIds: new Set(recoverableAccounts.map((account) => account.id)),
    roundingAccount: roundingAccount ?? null,
  });
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
      tax_rate_id: entry.tax_rate_id ?? null,
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
