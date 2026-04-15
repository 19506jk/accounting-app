import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type {
  BillLineItemInput,
  CreateBillInput,
  UpdateBillInput,
} from '@shared/contracts';
import {
  compareDateOnly,
  isValidDateOnly,
} from '../../utils/date.js';
import {
  getUniqueTaxRateIds,
  ROUNDING_ACCOUNT_CODE,
  type TaxRateRow,
} from './billPosting.js';

const db = require('../../db') as Knex;

type Numeric = string | number;

interface AccountRow {
  id: number;
  type: string;
}

const dec = (value: Numeric | null | undefined) => new Decimal(value ?? 0);

export function validateBillData(data: CreateBillInput | UpdateBillInput, isUpdate = false): string[] {
  const errors: string[] = [];

  if (!isUpdate || data.contact_id !== undefined) {
    if (!data.contact_id) errors.push('contact_id (vendor) is required');
  }

  if (!isUpdate || data.date !== undefined) {
    if (!data.date) errors.push('date is required');
    else if (!isValidDateOnly(data.date)) errors.push('date must be a valid date (YYYY-MM-DD)');
  }

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
      }
    }
  }

  if (data.date && data.due_date) {
    if (!isValidDateOnly(data.due_date)) {
      errors.push('due_date must be a valid date (YYYY-MM-DD)');
    } else if (compareDateOnly(data.due_date, data.date) < 0) {
      errors.push('due_date cannot be before bill date');
    }
  }

  return errors;
}

export async function resolveTaxRateMap(
  lineItems: BillLineItemInput[],
  executor: Knex | Knex.Transaction
): Promise<Record<number, TaxRateRow>> {
  const taxRateIds = getUniqueTaxRateIds(lineItems);
  if (taxRateIds.length === 0) return {};

  const taxRates = await executor('tax_rates').whereIn('id', taxRateIds) as TaxRateRow[];
  return Object.fromEntries(taxRates.map((tr) => [tr.id, tr]));
}

export async function validateLineItemAccounts(lineItems: BillLineItemInput[]): Promise<string[]> {
  const errors: string[] = [];

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
