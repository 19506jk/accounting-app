import type { Knex } from 'knex';
import Decimal from 'decimal.js';

import type { BillRow } from '../../types/db';

type Numeric = string | number;

const dec = (value: Numeric | null | undefined) => new Decimal(value ?? 0);

export const AP_ACCOUNT_CODE = '20000';

const SETTLEMENT_TOLERANCE = new Decimal('0.01');

export function getOutstanding(amount: Numeric, amountPaid: Numeric) {
  return dec(amount).minus(dec(amountPaid));
}

export function isSettledOutstanding(outstanding: Decimal) {
  return outstanding.abs().lt(SETTLEMENT_TOLERANCE);
}

export function toBillStatus(outstanding: Decimal): BillRow['status'] {
  return isSettledOutstanding(outstanding) ? 'PAID' : 'UNPAID';
}

function getAmountPaidFromOutstanding(amount: Numeric, outstanding: Decimal) {
  return dec(amount).minus(outstanding).toFixed(2);
}

export function buildBillSettlementPatch(
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

export function formatBillReference(bill: Pick<BillRow, 'id' | 'bill_number'>) {
  return bill.bill_number ? `#${bill.bill_number}` : `#${bill.id}`;
}
