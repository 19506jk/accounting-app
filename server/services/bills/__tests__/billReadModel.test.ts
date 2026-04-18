import dotenv from 'dotenv';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { BillDetail } from '@shared/contracts';

import type { ApplicationJoinedRow } from '../billReadModel.js';

process.env.NODE_ENV = 'development';

dotenv.config();

let getBillWithLineItems: (
  billId: string | number,
  executor: any
) => Promise<BillDetail | null>;
let normaliseApplications: (rows: ApplicationJoinedRow[]) => unknown;

beforeAll(async () => {
  const billReadModel = await import('../billReadModel.js');
  getBillWithLineItems = billReadModel.getBillWithLineItems;
  normaliseApplications = billReadModel.normaliseApplications;
});

function makeFirstQuery(result: unknown) {
  const query: any = {
    leftJoin: vi.fn(() => query),
    where: vi.fn(() => query),
    select: vi.fn(() => query),
    first: vi.fn().mockResolvedValue(result),
  };
  return query;
}

function makeSelectQuery(result: unknown[]) {
  const query: any = {
    join: vi.fn(() => query),
    leftJoin: vi.fn(() => query),
    where: vi.fn(() => query),
    whereNull: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    select: vi.fn().mockResolvedValue(result),
  };
  return query;
}

describe('normaliseApplications', () => {
  it('normalises application amounts and date fields', () => {
    expect(normaliseApplications([
      {
        id: 1,
        target_bill_id: 10,
        credit_bill_id: 11,
        amount: '7.50',
        apply_transaction_id: 99,
        applied_by: 5,
        applied_at: '2026-04-16T12:00:00.000Z',
        unapplied_by: null,
        unapplied_at: null,
        applied_by_name: 'Admin User',
        credit_bill_number: 'CR-1',
        credit_bill_date: '2026-04-15',
      },
    ])).toEqual([
      {
        id: 1,
        target_bill_id: 10,
        credit_bill_id: 11,
        amount: 7.5,
        apply_transaction_id: 99,
        applied_by: 5,
        applied_by_name: 'Admin User',
        applied_at: '2026-04-16T12:00:00.000Z',
        unapplied_at: null,
        credit_bill_number: 'CR-1',
        credit_bill_date: '2026-04-15',
      },
    ]);
  });
});

describe('getBillWithLineItems', () => {
  it('returns null when the bill does not exist', async () => {
    const billQuery = makeFirstQuery(undefined);
    const executor = vi.fn((table: string) => {
      if (table === 'bills as b') return billQuery;
      throw new Error(`Unexpected table ${table}`);
    }) as any;

    await expect(getBillWithLineItems(123, executor)).resolves.toBeNull();
    expect(executor).toHaveBeenCalledTimes(1);
    expect(billQuery.where).toHaveBeenCalledWith('b.id', 123);
  });

  it('maps bill details, line items, applied credits, and available credit totals', async () => {
    const billQuery = makeFirstQuery({
      id: 123,
      contact_id: 44,
      date: '2026-04-10',
      due_date: '2026-04-30',
      bill_number: 'B-123',
      description: 'Office supplies',
      amount: '125.50',
      amount_paid: '25.25',
      status: 'UNPAID',
      fund_id: 12,
      transaction_id: 99,
      created_transaction_id: 98,
      created_by: 5,
      paid_by: null,
      paid_at: null,
      created_at: '2026-04-10T12:00:00.000Z',
      updated_at: '2026-04-11T12:00:00.000Z',
      vendor_name: 'Acme Supply',
      vendor_email: 'ap@example.com',
      vendor_phone: '555-0100',
      fund_name: 'General',
      created_by_name: 'Admin User',
      paid_by_name: null,
    });
    const lineItemsQuery = makeSelectQuery([
      {
        id: 1,
        expense_account_id: 300,
        amount: '100.00',
        rounding_adjustment: '0.01',
        description: 'Paper',
        tax_rate_id: 2,
        expense_account_code: '5000',
        expense_account_name: 'Office Supplies',
        tax_rate_name: 'HST',
        tax_rate_value: '0.13',
      },
    ]);
    const applicationsQuery = makeSelectQuery([
      {
        id: 2,
        target_bill_id: 123,
        credit_bill_id: 124,
        amount: '5.00',
        apply_transaction_id: 77,
        applied_by: 5,
        applied_at: '2026-04-12T12:00:00.000Z',
        unapplied_by: null,
        unapplied_at: null,
        applied_by_name: 'Admin User',
        credit_bill_number: 'CR-124',
        credit_bill_date: '2026-04-09',
      },
    ]);
    const availableCreditsQuery = makeSelectQuery([
      { amount: '-10.00', amount_paid: '-3.00' },
      // Overapplied credits have no remaining available balance.
      { amount: '-4.00', amount_paid: '-5.00' },
    ]);
    let billsAsBCalls = 0;
    const executor = vi.fn((table: string) => {
      if (table === 'bills as b') {
        billsAsBCalls += 1;
        return billsAsBCalls === 1 ? billQuery : availableCreditsQuery;
      }
      if (table === 'bill_line_items as bli') return lineItemsQuery;
      if (table === 'bill_credit_applications as bca') return applicationsQuery;
      throw new Error(`Unexpected table ${table}`);
    }) as any;

    const bill = await getBillWithLineItems(123, executor);

    expect(bill).toEqual(expect.objectContaining({
      id: 123,
      date: '2026-04-10',
      due_date: '2026-04-30',
      amount: 125.5,
      amount_paid: 25.25,
      paid_at: null,
      created_at: '2026-04-10T12:00:00.000Z',
      updated_at: '2026-04-11T12:00:00.000Z',
      available_credit_total: 7,
      applied_credits: [
        expect.objectContaining({
          id: 2,
          amount: 5,
          credit_bill_number: 'CR-124',
          credit_bill_date: '2026-04-09',
        }),
      ],
      line_items: [
        {
          id: 1,
          expense_account_id: 300,
          expense_account_code: '5000',
          expense_account_name: 'Office Supplies',
          amount: 100,
          rounding_adjustment: 0.01,
          description: 'Paper',
          tax_rate_id: 2,
          tax_rate_name: 'HST',
          tax_rate_value: 0.13,
          tax_amount: 13,
        },
      ],
    }));
    expect(executor).toHaveBeenCalledTimes(4);
    expect(availableCreditsQuery.where).toHaveBeenCalledWith('b.id', '<>', 123);
  });
});
