import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

import {
  buildBillSettlementPatch,
  formatBillReference,
  getOutstanding,
  isSettledOutstanding,
  toBillStatus,
} from './billSettlement';

describe('billSettlement helpers', () => {
  it('marks bill as paid when outstanding amount is within tolerance', () => {
    const now = '2026-04-16T12:00:00.000Z';
    const trx = {
      fn: {
        now: vi.fn(() => now),
      },
    } as any;

    const patch = buildBillSettlementPatch(
      { amount: '100.00' } as any,
      new Decimal('0.009'),
      42,
      trx
    );

    expect(patch).toEqual({
      amount_paid: '99.99',
      status: 'PAID',
      paid_by: 42,
      paid_at: now,
      updated_at: now,
    });
    expect(trx.fn.now).toHaveBeenCalledTimes(2);
  });

  it('reports unpaid when outstanding is above tolerance', () => {
    const outstanding = getOutstanding('100.00', '99.98');

    expect(isSettledOutstanding(outstanding)).toBe(false);
    expect(toBillStatus(outstanding)).toBe('UNPAID');
  });

  it('formats bill reference with bill number when present', () => {
    expect(formatBillReference({ id: 8, bill_number: 'B-123' } as any)).toBe('#B-123');
    expect(formatBillReference({ id: 8, bill_number: null } as any)).toBe('#8');
  });
});
