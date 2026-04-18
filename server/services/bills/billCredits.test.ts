import dotenv from 'dotenv';
import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.NODE_ENV = 'development';

dotenv.config();

let applyBillCredits: typeof import('./billCredits.js').applyBillCredits;
let getAvailableCreditsForBill: typeof import('./billCredits.js').getAvailableCreditsForBill;

beforeAll(async () => {
  const billCredits = await import('./billCredits.js');
  applyBillCredits = billCredits.applyBillCredits;
  getAvailableCreditsForBill = billCredits.getAvailableCreditsForBill;
});

function makeFirstQuery(row: unknown) {
  const query: any = {
    where: vi.fn(() => query),
    first: vi.fn().mockResolvedValue(row),
  };
  return query;
}

function makeCreditListQuery(rows: unknown[]) {
  const query: any = {
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    select: vi.fn().mockResolvedValue(rows),
  };
  return query;
}

describe('applyBillCredits validation', () => {
  it.each([
    [
      'missing applications',
      {},
      ['applications is required'],
    ],
    [
      'empty applications',
      { applications: [] },
      ['applications is required'],
    ],
    [
      'non-array applications',
      { applications: {} },
      ['applications is required'],
    ],
    [
      'non-positive amounts',
      {
        applications: [
          { credit_bill_id: 1, amount: 0 },
          { credit_bill_id: 2, amount: -5 },
        ],
      },
      ['At least one positive application amount is required'],
    ],
    [
      'too many decimal places',
      {
        applications: [
          { credit_bill_id: 1, amount: 10.123 },
        ],
      },
      ['Application amount cannot have more than 2 decimal places'],
    ],
    [
      'duplicate credit bills',
      {
        applications: [
          { credit_bill_id: 1, amount: 5 },
          { credit_bill_id: 1, amount: 10 },
        ],
      },
      ['Duplicate credit bill in applications is not allowed'],
    ],
  ])('rejects %s before opening a transaction', async (_name, payload, errors) => {
    await expect(applyBillCredits('10', payload as any, 42)).resolves.toEqual({ errors });
  });

  it('returns bill-not-found from the transaction path when valid input targets a missing bill', async () => {
    const targetQuery: any = {
      where: vi.fn(() => targetQuery),
      first: vi.fn(() => targetQuery),
      forUpdate: vi.fn().mockResolvedValue(undefined),
    };
    const trx = vi.fn((table: string) => {
      if (table === 'bills') return targetQuery;
      throw new Error(`Unexpected table ${table}`);
    }) as any;
    const executor = {
      transaction: vi.fn(async (callback) => callback(trx)),
    } as any;

    await expect(applyBillCredits(
      '10',
      { applications: [{ credit_bill_id: 1, amount: 5 }] },
      42,
      executor
    )).resolves.toEqual({ errors: ['Bill not found'] });

    expect(executor.transaction).toHaveBeenCalledTimes(1);
    expect(targetQuery.where).toHaveBeenCalledWith({ id: '10' });
    expect(targetQuery.forUpdate).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'no payable balance',
      { id: 10, amount: '100.00', amount_paid: '100.00' },
      ['Bill has no payable balance'],
    ],
    [
      'target is a credit bill',
      { id: 10, amount: '-100.00', amount_paid: '-150.00' },
      ['Credits can only be applied to a positive bill'],
    ],
  ])('rejects %s from the transaction path', async (_name, targetBill, errors) => {
    const targetQuery: any = {
      where: vi.fn(() => targetQuery),
      first: vi.fn(() => targetQuery),
      forUpdate: vi.fn().mockResolvedValue(targetBill),
    };
    const trx = vi.fn((table: string) => {
      if (table === 'bills') return targetQuery;
      throw new Error(`Unexpected table ${table}`);
    }) as any;
    const executor = {
      transaction: vi.fn(async (callback) => callback(trx)),
    } as any;

    await expect(applyBillCredits(
      '10',
      { applications: [{ credit_bill_id: 1, amount: 5 }] },
      42,
      executor
    )).resolves.toEqual({ errors });

    expect(executor.transaction).toHaveBeenCalledTimes(1);
    expect(targetQuery.where).toHaveBeenCalledWith({ id: '10' });
    expect(targetQuery.forUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('applyBillCredits credit selection rules', () => {
  const targetBill = {
    id: 10,
    contact_id: 20,
    fund_id: 30,
    amount: '200.00',
    amount_paid: '0.00',
  };

  function makeApplyTrx(creditRows: unknown[]) {
    const targetQuery: any = {
      where: vi.fn(() => targetQuery),
      first: vi.fn(() => targetQuery),
      forUpdate: vi.fn().mockResolvedValue(targetBill),
    };
    const creditsQuery: any = {
      where: vi.fn(() => creditsQuery),
      orderBy: vi.fn(() => creditsQuery),
      forUpdate: vi.fn().mockResolvedValue(creditRows),
    };
    let billsCallCount = 0;
    const trx = vi.fn((table: string) => {
      if (table === 'bills') return billsCallCount++ === 0 ? targetQuery : creditsQuery;
      throw new Error(`Unexpected table: ${table}`);
    }) as any;
    return {
      transaction: vi.fn(async (callback: (trx: any) => unknown) => callback(trx)),
    } as any;
  }

  it('rejects a credit id not in the available list', async () => {
    const executor = makeApplyTrx([
      { id: 11, bill_number: 'CR-11', date: '2026-04-01', amount: '-40.00', amount_paid: '0.00' },
    ]);

    await expect(applyBillCredits(
      '10',
      { applications: [{ credit_bill_id: 99, amount: 25 }] },
      42,
      executor,
    )).resolves.toEqual({ errors: ['One or more selected credits are unavailable for this bill'] });
  });

  it('rejects a selection that skips an earlier FIFO credit', async () => {
    const executor = makeApplyTrx([
      { id: 11, bill_number: 'CR-11', date: '2026-04-01', amount: '-40.00', amount_paid: '0.00' },
      { id: 12, bill_number: 'CR-12', date: '2026-04-02', amount: '-30.00', amount_paid: '0.00' },
    ]);

    await expect(applyBillCredits(
      '10',
      { applications: [{ credit_bill_id: 12, amount: 30 }] },
      42,
      executor,
    )).resolves.toEqual({ errors: ['Credits must be applied in FIFO order'] });
  });

  it('rejects a requested amount that exceeds the credit available balance', async () => {
    const executor = makeApplyTrx([
      { id: 11, bill_number: 'CR-11', date: '2026-04-01', amount: '-40.00', amount_paid: '-15.00' },
    ]);

    await expect(applyBillCredits(
      '10',
      { applications: [{ credit_bill_id: 11, amount: 30 }] },
      42,
      executor,
    )).resolves.toEqual({ errors: ['Credit bill #CR-11 exceeds available balance'] });
  });
});

describe('applyBillCredits happy path', () => {
  const NOW = '2026-04-17T00:00:00.000Z';

  function makeHappyPathTrx({
    target,
    creditBill,
    apAccount,
    applyTransaction,
    insertedApps,
    detailedApps,
  }: {
    target: any;
    creditBill: any;
    apAccount: any;
    applyTransaction: any;
    insertedApps: any[];
    detailedApps: any[];
  }) {
    let billsCallCount = 0;
    let billsAsBCallCount = 0;
    let bcaCallCount = 0;

    const targetQuery: any = {
      where: vi.fn(() => targetQuery),
      first: vi.fn(() => targetQuery),
      forUpdate: vi.fn().mockResolvedValue(target),
    };
    const creditsQuery: any = {
      where: vi.fn(() => creditsQuery),
      orderBy: vi.fn(() => creditsQuery),
      forUpdate: vi.fn().mockResolvedValue([creditBill]),
    };
    const creditUpdateQuery: any = {
      where: vi.fn(() => creditUpdateQuery),
      update: vi.fn().mockResolvedValue(1),
    };
    const targetUpdateQuery: any = {
      where: vi.fn(() => targetUpdateQuery),
      update: vi.fn().mockResolvedValue(1),
    };
    const apAccountQuery: any = {
      where: vi.fn(() => apAccountQuery),
      first: vi.fn().mockResolvedValue(apAccount),
    };
    const fiscalPeriodsQuery: any = {
      orderBy: vi.fn(() => fiscalPeriodsQuery),
      select: vi.fn(() => fiscalPeriodsQuery),
      first: vi.fn().mockResolvedValue(undefined),
    };
    const transactionsInsertMock = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([applyTransaction]),
    });
    const journalInsertMock = vi.fn().mockResolvedValue(undefined);
    const bcaInsertMock = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(insertedApps),
    });
    const bcaDetailedQuery: any = {
      leftJoin: vi.fn(() => bcaDetailedQuery),
      whereIn: vi.fn(() => bcaDetailedQuery),
      select: vi.fn().mockResolvedValue(detailedApps),
    };
    const bcaGetBillQuery: any = {
      leftJoin: vi.fn(() => bcaGetBillQuery),
      where: vi.fn(() => bcaGetBillQuery),
      whereNull: vi.fn(() => bcaGetBillQuery),
      orderBy: vi.fn(() => bcaGetBillQuery),
      select: vi.fn().mockResolvedValue([]),
    };
    const billsAsBDetailQuery: any = {
      leftJoin: vi.fn(() => billsAsBDetailQuery),
      where: vi.fn(() => billsAsBDetailQuery),
      select: vi.fn(() => billsAsBDetailQuery),
      first: vi.fn().mockResolvedValue({
        id: target.id,
        contact_id: target.contact_id,
        date: '2026-04-17',
        due_date: '2026-05-17',
        bill_number: target.bill_number,
        description: 'Office supplies',
        amount: target.amount,
        amount_paid: target.amount,
        status: 'PAID',
        fund_id: target.fund_id,
        transaction_id: applyTransaction.id,
        created_transaction_id: 76,
        created_by: 42,
        paid_by: 42,
        paid_at: NOW,
        created_at: NOW,
        updated_at: NOW,
        vendor_name: 'Acme Supply',
        vendor_email: null,
        vendor_phone: null,
        fund_name: 'General',
        created_by_name: 'Admin User',
        paid_by_name: 'Admin User',
      }),
    };
    const billsAsBCreditsQuery: any = {
      where: vi.fn(() => billsAsBCreditsQuery),
      select: vi.fn().mockResolvedValue([]),
    };
    const lineItemsQuery: any = {
      join: vi.fn(() => lineItemsQuery),
      leftJoin: vi.fn(() => lineItemsQuery),
      where: vi.fn(() => lineItemsQuery),
      whereNull: vi.fn(() => lineItemsQuery),
      orderBy: vi.fn(() => lineItemsQuery),
      select: vi.fn().mockResolvedValue([]),
    };

    const trx = vi.fn((table: string) => {
      if (table === 'bills') {
        billsCallCount++;
        if (billsCallCount === 1) return targetQuery;
        if (billsCallCount === 2) return creditsQuery;
        if (billsCallCount === 3) return creditUpdateQuery;
        return targetUpdateQuery;
      }
      if (table === 'accounts') return apAccountQuery;
      if (table === 'fiscal_periods') return fiscalPeriodsQuery;
      if (table === 'transactions') return { insert: transactionsInsertMock };
      if (table === 'journal_entries') return { insert: journalInsertMock };
      if (table === 'bill_credit_applications') return { insert: bcaInsertMock };
      if (table === 'bill_credit_applications as bca') return ++bcaCallCount === 1 ? bcaDetailedQuery : bcaGetBillQuery;
      if (table === 'bills as b') return ++billsAsBCallCount === 1 ? billsAsBDetailQuery : billsAsBCreditsQuery;
      if (table === 'bill_line_items as bli') return lineItemsQuery;
      throw new Error(`Unexpected table: ${table}`);
    }) as any;
    trx.raw = vi.fn().mockResolvedValue(undefined);
    trx.fn = { now: vi.fn(() => NOW) };

    return {
      executor: {
        transaction: vi.fn(async (callback: (trx: any) => unknown) => callback(trx)),
      } as any,
      journalInsertMock,
      creditUpdateQuery,
      targetUpdateQuery,
      bcaInsertMock,
    };
  }

  it('fully applies a credit memo, settles both bills, and returns the correct journal pair', async () => {
    const target = { id: 10, bill_number: 'INV-10', contact_id: 20, fund_id: 30, amount: '40.00', amount_paid: '0.00', status: 'UNPAID' };
    const creditBill = { id: 11, bill_number: 'CR-11', date: '2026-04-01', contact_id: 20, fund_id: 30, amount: '-40.00', amount_paid: '0.00', status: 'UNPAID' };
    const applyTransaction = { id: 99, date: '2026-04-17', fund_id: 30 };
    const insertedApp = { id: 200, target_bill_id: 10, credit_bill_id: 11, amount: '40.00', apply_transaction_id: 99, applied_by: 42, applied_at: NOW, unapplied_at: null, unapplied_by: null };
    const detailedApp = { ...insertedApp, applied_by_name: 'Admin User', credit_bill_number: 'CR-11', credit_bill_date: '2026-04-01' };

    const { executor, journalInsertMock, creditUpdateQuery, targetUpdateQuery, bcaInsertMock } = makeHappyPathTrx({
      target,
      creditBill,
      apAccount: { id: 500 },
      applyTransaction,
      insertedApps: [insertedApp],
      detailedApps: [detailedApp],
    });

    const result = await applyBillCredits(
      '10',
      { applications: [{ credit_bill_id: 11, amount: 40 }] },
      42,
      executor,
    );

    expect(result.errors).toBeUndefined();
    expect(result.transaction).toEqual(expect.objectContaining({ id: 99 }));

    const journalRows = journalInsertMock.mock.calls[0]?.[0];
    expect(journalRows).toEqual([
      expect.objectContaining({ transaction_id: 99, account_id: 500, fund_id: 30, contact_id: 20, debit: '40.00', credit: 0, memo: 'Applied Credit #CR-11 to Bill #INV-10' }),
      expect.objectContaining({ transaction_id: 99, account_id: 500, fund_id: 30, contact_id: 20, debit: 0, credit: '40.00', memo: 'Applied Credit #CR-11 to Bill #INV-10' }),
    ]);

    expect(creditUpdateQuery.where).toHaveBeenCalledWith({ id: 11 });
    expect(creditUpdateQuery.update).toHaveBeenCalledWith(expect.objectContaining({ amount_paid: '-40.00', status: 'PAID', paid_by: 42 }));

    expect(targetUpdateQuery.where).toHaveBeenCalledWith({ id: 10 });
    expect(targetUpdateQuery.update).toHaveBeenCalledWith(expect.objectContaining({ amount_paid: '40.00', status: 'PAID', paid_by: 42 }));

    const appRows = bcaInsertMock.mock.calls[0]?.[0];
    expect(appRows).toEqual([
      expect.objectContaining({ target_bill_id: 10, credit_bill_id: 11, amount: '40.00', apply_transaction_id: 99, applied_by: 42, unapplied_at: null }),
    ]);

    expect(result.applications).toEqual([
      expect.objectContaining({ id: 200, target_bill_id: 10, credit_bill_id: 11, amount: 40, credit_bill_number: 'CR-11' }),
    ]);
    expect(result.bill).toEqual(expect.objectContaining({ id: 10 }));
  });

  it('partially applies a credit memo, leaves both bills unpaid, and records the partial amount', async () => {
    const target = { id: 10, bill_number: 'INV-10', contact_id: 20, fund_id: 30, amount: '100.00', amount_paid: '0.00', status: 'UNPAID' };
    const creditBill = { id: 11, bill_number: 'CR-11', date: '2026-04-01', contact_id: 20, fund_id: 30, amount: '-40.00', amount_paid: '0.00', status: 'UNPAID' };
    const applyTransaction = { id: 99, date: '2026-04-17', fund_id: 30 };
    const insertedApp = { id: 200, target_bill_id: 10, credit_bill_id: 11, amount: '25.00', apply_transaction_id: 99, applied_by: 42, applied_at: NOW, unapplied_at: null, unapplied_by: null };
    const detailedApp = { ...insertedApp, applied_by_name: 'Admin User', credit_bill_number: 'CR-11', credit_bill_date: '2026-04-01' };

    const { executor, journalInsertMock, creditUpdateQuery, targetUpdateQuery } = makeHappyPathTrx({
      target,
      creditBill,
      apAccount: { id: 500 },
      applyTransaction,
      insertedApps: [insertedApp],
      detailedApps: [detailedApp],
    });

    const result = await applyBillCredits(
      '10',
      { applications: [{ credit_bill_id: 11, amount: 25 }] },
      42,
      executor,
    );

    expect(result.errors).toBeUndefined();

    const journalRows = journalInsertMock.mock.calls[0]?.[0];
    expect(journalRows).toEqual([
      expect.objectContaining({ debit: '25.00', credit: 0, memo: 'Applied Credit #CR-11 to Bill #INV-10' }),
      expect.objectContaining({ debit: 0, credit: '25.00', memo: 'Applied Credit #CR-11 to Bill #INV-10' }),
    ]);

    // Credit stays UNPAID: nextOutstanding = -40 + 25 = -15, amount_paid = -40 - (-15) = -25
    expect(creditUpdateQuery.update).toHaveBeenCalledWith(expect.objectContaining({ amount_paid: '-25.00', status: 'UNPAID', paid_by: null }));

    // Target stays UNPAID: nextOutstanding = 100 - 25 = 75, amount_paid = 100 - 75 = 25
    expect(targetUpdateQuery.update).toHaveBeenCalledWith(expect.objectContaining({ amount_paid: '25.00', status: 'UNPAID', paid_by: null }));
  });
});

describe('getAvailableCreditsForBill', () => {
  it('returns no credits when the target bill is missing', async () => {
    const targetQuery = makeFirstQuery(undefined);
    const executor = vi.fn((table: string) => {
      if (table === 'bills') return targetQuery;
      throw new Error(`Unexpected table ${table}`);
    }) as any;

    await expect(getAvailableCreditsForBill(10, executor)).resolves.toEqual([]);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(targetQuery.where).toHaveBeenCalledWith({ id: 10 });
  });

  it('returns no credits when the target bill has no payable balance', async () => {
    const targetQuery = makeFirstQuery({
      id: 10,
      contact_id: 20,
      fund_id: 30,
      amount: '100.00',
      amount_paid: '100.00',
    });
    const executor = vi.fn((table: string) => {
      if (table === 'bills') return targetQuery;
      throw new Error(`Unexpected table ${table}`);
    }) as any;

    await expect(getAvailableCreditsForBill(10, executor)).resolves.toEqual([]);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('maps available vendor credits and skips fully consumed credits', async () => {
    const targetQuery = makeFirstQuery({
      id: 10,
      contact_id: 20,
      fund_id: 30,
      amount: '100.00',
      amount_paid: '25.00',
    });
    const creditsQuery = makeCreditListQuery([
      {
        id: 11,
        bill_number: 'CR-11',
        date: '2026-04-10',
        description: 'Vendor credit',
        amount: '-40.00',
        amount_paid: '-15.00',
      },
      {
        id: 12,
        bill_number: 'CR-12',
        date: '2026-04-11',
        description: 'Fully consumed vendor credit',
        amount: '-10.00',
        amount_paid: '-12.00',
      },
    ]);
    const executor = vi.fn((table: string) => {
      if (table === 'bills') return targetQuery;
      if (table === 'bills as b') return creditsQuery;
      throw new Error(`Unexpected table ${table}`);
    }) as any;

    const credits = await getAvailableCreditsForBill(10, executor);

    expect(creditsQuery.where).toHaveBeenCalledWith({
      contact_id: 20,
      fund_id: 30,
      status: 'UNPAID',
    });
    expect(creditsQuery.where).toHaveBeenCalledWith('b.amount', '<', 0);
    expect(creditsQuery.where).toHaveBeenCalledWith('b.id', '<>', 10);
    expect(credits).toEqual([
      {
        bill_id: 11,
        bill_number: 'CR-11',
        date: '2026-04-10',
        description: 'Vendor credit',
        original_amount: -40,
        amount_paid: -15,
        outstanding: -25,
        available_amount: 25,
      },
    ]);
  });
});
