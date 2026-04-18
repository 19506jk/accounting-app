import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type { BillLineItemInput } from '@shared/contracts';

type Numeric = string | number;

export interface TaxRateRow {
  id: number;
  name: string;
  rate: Numeric;
  recoverable_account_id: number;
}

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

export const ROUNDING_ACCOUNT_CODE = '59999';

const TOLERANCE = 0.01;

export function getUniqueTaxRateIds(lineItems: BillLineItemInput[]) {
  return [...new Set(lineItems.map((li) => li.tax_rate_id).filter((id): id is number => Boolean(id)))];
}

export function calculateGrossTotalFromLineItems(
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

function formatBillMemo(billNumber: string | null | undefined, description: string | null | undefined) {
  const billLabel = billNumber ? `Bill ${billNumber}` : 'Bill';
  return description ? `${billLabel} - ${description}` : billLabel;
}

export async function createMultiLineJournalEntries(
  transactionId: number,
  lineItems: BillLineItemInput[],
  fundId: number,
  apAccountId: number,
  contactId: number | null,
  contactName: string,
  billNumber: string | null | undefined,
  trx: Knex.Transaction
) {
  const taxRateIds = getUniqueTaxRateIds(lineItems);
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
    const lineMemo = formatBillMemo(billNumber, line.description);

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
        `${taxRate.name} on ${lineMemo}`,
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
    formatBillMemo(billNumber, contactName),
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
