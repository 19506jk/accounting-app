import { describe, expect, it, vi } from 'vitest';

import {
  calculateGrossTotalFromLineItems,
  createMultiLineJournalEntries,
  getUniqueTaxRateIds,
} from './billPosting';

describe('billPosting pure helpers', () => {
  it('deduplicates truthy tax rate ids in line item order', () => {
    expect(getUniqueTaxRateIds([
      { expense_account_id: 300, amount: 10, tax_rate_id: 2 },
      { expense_account_id: 301, amount: 15, tax_rate_id: null },
      { expense_account_id: 302, amount: 20, tax_rate_id: 2 },
      { expense_account_id: 303, amount: 25, tax_rate_id: 3 },
    ])).toEqual([2, 3]);
  });

  it('calculates gross totals with tax and rounding adjustments', () => {
    const total = calculateGrossTotalFromLineItems([
      {
        expense_account_id: 300,
        amount: 100,
        description: 'Taxed',
        tax_rate_id: 1,
        rounding_adjustment: 0.01,
      },
      {
        expense_account_id: 301,
        amount: 50,
        description: 'Untaxed',
        tax_rate_id: null,
        rounding_adjustment: -0.02,
      },
    ], {
      1: {
        id: 1,
        name: 'HST',
        rate: '0.13',
        recoverable_account_id: 150,
      },
    });

    expect(total.toFixed(2)).toBe('162.99');
  });
});

describe('createMultiLineJournalEntries', () => {
  it('creates balanced journal entries with mocked transaction DB calls', async () => {
    const now = '2026-04-16T12:00:00.000Z';
    const returningMock = vi.fn().mockResolvedValue([{ id: 9 }]);
    const insertMock = vi.fn().mockReturnValue({ returning: returningMock });

    const trx = vi.fn((table: string) => {
      if (table === 'journal_entries') {
        return { insert: insertMock };
      }
      throw new Error(`Unexpected table: ${table}`);
    }) as any;
    trx.fn = { now: vi.fn(() => now) };

    const result = await createMultiLineJournalEntries(
      1,
      [
        {
          expense_account_id: 300,
          amount: 50,
          description: 'Office supplies',
          tax_rate_id: null,
          rounding_adjustment: 0,
        },
      ],
      10,
      200,
      null,
      'Acme Supply',
      'B-123',
      trx
    );

    expect(result).toEqual([{ id: 9 }]);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(returningMock).toHaveBeenCalledWith('*');

    const insertedRows = insertMock.mock.calls[0]?.[0];
    expect(insertedRows).toBeDefined();
    if (!insertedRows) throw new Error('Expected journal entries to be inserted');
    expect(insertedRows).toHaveLength(2);
    expect(insertedRows).toEqual([
      {
        transaction_id: 1,
        account_id: 300,
        fund_id: 10,
        contact_id: null,
        debit: '50.00',
        credit: 0,
        memo: 'Bill B-123 - Office supplies',
        is_reconciled: false,
        tax_rate_id: null,
        is_tax_line: false,
        created_at: now,
        updated_at: now,
      },
      {
        transaction_id: 1,
        account_id: 200,
        fund_id: 10,
        contact_id: null,
        debit: 0,
        credit: '50.00',
        memo: 'Bill B-123 - Acme Supply',
        is_reconciled: false,
        tax_rate_id: null,
        is_tax_line: false,
        created_at: now,
        updated_at: now,
      },
    ]);
  });

  it('posts tax lines and AP totals for mixed taxed and untaxed items', async () => {
    const now = '2026-04-16T12:00:00.000Z';
    const returningMock = vi.fn().mockResolvedValue([{ id: 10 }]);
    const insertMock = vi.fn().mockReturnValue({ returning: returningMock });
    const whereInMock = vi.fn().mockResolvedValue([
      { id: 2, name: 'GST', rate: '0.05', recoverable_account_id: 150 },
    ]);

    const trx = vi.fn((table: string) => {
      if (table === 'tax_rates') return { whereIn: whereInMock };
      if (table === 'journal_entries') return { insert: insertMock };
      throw new Error(`Unexpected table: ${table}`);
    }) as any;
    trx.fn = { now: vi.fn(() => now) };

    await createMultiLineJournalEntries(
      5,
      [
        {
          expense_account_id: 300,
          amount: 100,
          description: 'Taxed expense',
          tax_rate_id: 2,
          rounding_adjustment: 0,
        },
        {
          expense_account_id: 301,
          amount: 50,
          description: 'Untaxed expense',
          tax_rate_id: null,
          rounding_adjustment: 0,
        },
      ],
      10,
      200,
      88,
      'Vendor A',
      'B-500',
      trx
    );

    const insertedRows = insertMock.mock.calls[0]?.[0];
    expect(insertedRows).toHaveLength(4);
    expect(insertedRows).toEqual([
      expect.objectContaining({
        transaction_id: 5,
        account_id: 300,
        debit: '100.00',
        credit: 0,
        tax_rate_id: 2,
        is_tax_line: false,
      }),
      expect.objectContaining({
        transaction_id: 5,
        account_id: 150,
        debit: '5.00',
        credit: 0,
        tax_rate_id: 2,
        is_tax_line: true,
      }),
      expect.objectContaining({
        transaction_id: 5,
        account_id: 301,
        debit: '50.00',
        credit: 0,
        tax_rate_id: null,
        is_tax_line: false,
      }),
      expect.objectContaining({
        transaction_id: 5,
        account_id: 200,
        contact_id: 88,
        debit: 0,
        credit: '155.00',
        tax_rate_id: null,
        is_tax_line: false,
      }),
    ]);
    expect(whereInMock).toHaveBeenCalledWith('id', [2]);
  });

  it('posts signed credit memo entries for negative bill amounts', async () => {
    const now = '2026-04-16T12:00:00.000Z';
    const returningMock = vi.fn().mockResolvedValue([{ id: 12 }]);
    const insertMock = vi.fn().mockReturnValue({ returning: returningMock });

    const trx = vi.fn((table: string) => {
      if (table === 'journal_entries') return { insert: insertMock };
      throw new Error(`Unexpected table: ${table}`);
    }) as any;
    trx.fn = { now: vi.fn(() => now) };

    await createMultiLineJournalEntries(
      12,
      [
        {
          expense_account_id: 300,
          amount: -25,
          description: 'Vendor credit',
          tax_rate_id: null,
          rounding_adjustment: 0,
        },
      ],
      10,
      200,
      88,
      'Vendor Credit',
      null,
      trx
    );

    const insertedRows = insertMock.mock.calls[0]?.[0];
    expect(insertedRows).toEqual([
      expect.objectContaining({
        transaction_id: 12,
        account_id: 300,
        contact_id: null,
        debit: 0,
        credit: '25.00',
        memo: 'Bill - Vendor credit',
      }),
      expect.objectContaining({
        transaction_id: 12,
        account_id: 200,
        contact_id: 88,
        debit: '25.00',
        credit: 0,
        memo: 'Bill - Vendor Credit',
      }),
    ]);
  });

  it('posts explicit rounding adjustment lines when a rounding account exists', async () => {
    const now = '2026-04-16T12:00:00.000Z';
    const returningMock = vi.fn().mockResolvedValue([{ id: 13 }]);
    const insertMock = vi.fn().mockReturnValue({ returning: returningMock });
    const roundingAccountFirst = vi.fn().mockResolvedValue({ id: 999 });

    const trx = vi.fn((table: string) => {
      if (table === 'accounts') {
        return { where: vi.fn().mockReturnValue({ first: roundingAccountFirst }) };
      }
      if (table === 'journal_entries') return { insert: insertMock };
      if (table === 'tax_rates') return { whereIn: vi.fn().mockResolvedValue([]) };
      throw new Error(`Unexpected table: ${table}`);
    }) as any;
    trx.fn = { now: vi.fn(() => now) };

    await createMultiLineJournalEntries(
      13,
      [
        {
          expense_account_id: 300,
          amount: 10,
          description: 'Rounded charge',
          tax_rate_id: null,
          rounding_adjustment: -0.02,
        },
      ],
      10,
      200,
      null,
      'Vendor',
      'B-13',
      trx
    );

    const insertedRows = insertMock.mock.calls[0]?.[0];
    expect(insertedRows).toEqual([
      expect.objectContaining({
        transaction_id: 13,
        account_id: 300,
        debit: '10.00',
        credit: 0,
        memo: 'Bill B-13 - Rounded charge',
      }),
      expect.objectContaining({
        transaction_id: 13,
        account_id: 999,
        debit: 0,
        credit: '0.02',
        memo: 'Rounding adjustment - Rounded charge',
      }),
      expect.objectContaining({
        transaction_id: 13,
        account_id: 200,
        debit: 0,
        credit: '9.98',
        memo: 'Bill B-13 - Vendor',
      }),
    ]);
  });

  it('throws when rounding adjustment exists and rounding account is missing', async () => {
    const whereFirst = vi.fn().mockResolvedValue(undefined);
    const trx = vi.fn((table: string) => {
      if (table === 'accounts') return { where: vi.fn().mockReturnValue({ first: whereFirst }) };
      if (table === 'journal_entries') return { insert: vi.fn() };
      if (table === 'tax_rates') return { whereIn: vi.fn().mockResolvedValue([]) };
      throw new Error(`Unexpected table: ${table}`);
    }) as any;
    trx.fn = { now: vi.fn(() => '2026-04-16T12:00:00.000Z') };

    await expect(createMultiLineJournalEntries(
      1,
      [
        {
          expense_account_id: 300,
          amount: 10,
          description: 'Rounded',
          tax_rate_id: null,
          rounding_adjustment: 0.01,
        },
      ],
      10,
      200,
      null,
      'Vendor',
      'B-1',
      trx
    )).rejects.toThrow('Rounding account (59999) is missing or inactive');
  });

  it('adds automatic rounding entry when journal diff is within tolerance', async () => {
    const now = '2026-04-16T12:00:00.000Z';
    const returningMock = vi.fn().mockResolvedValue([{ id: 11 }]);
    const insertMock = vi.fn().mockReturnValue({ returning: returningMock });
    const roundingAccountFirst = vi.fn().mockResolvedValue({ id: 999 });

    const trx = vi.fn((table: string) => {
      if (table === 'accounts') {
        return { where: vi.fn().mockReturnValue({ first: roundingAccountFirst }) };
      }
      if (table === 'journal_entries') return { insert: insertMock };
      if (table === 'tax_rates') return { whereIn: vi.fn().mockResolvedValue([]) };
      throw new Error(`Unexpected table: ${table}`);
    }) as any;
    trx.fn = { now: vi.fn(() => now) };

    await createMultiLineJournalEntries(
      9,
      [
        { expense_account_id: 300, amount: 0.335, description: 'A', tax_rate_id: null, rounding_adjustment: 0 },
        { expense_account_id: 301, amount: 0.335, description: 'B', tax_rate_id: null, rounding_adjustment: 0 },
      ],
      10,
      200,
      null,
      'Vendor',
      'B-9',
      trx
    );

    const insertedRows = insertMock.mock.calls[0]?.[0];
    expect(insertedRows).toHaveLength(4);
    expect(insertedRows[3]).toEqual(expect.objectContaining({
      account_id: 999,
      debit: 0,
      credit: '0.01',
      memo: 'Rounding adjustment',
    }));
  });

  it('does not add automatic rounding entry when the rounding account is unavailable', async () => {
    const now = '2026-04-16T12:00:00.000Z';
    const returningMock = vi.fn().mockResolvedValue([{ id: 14 }]);
    const insertMock = vi.fn().mockReturnValue({ returning: returningMock });
    const roundingAccountFirst = vi.fn().mockResolvedValue(undefined);

    const trx = vi.fn((table: string) => {
      if (table === 'accounts') {
        return { where: vi.fn().mockReturnValue({ first: roundingAccountFirst }) };
      }
      if (table === 'journal_entries') return { insert: insertMock };
      if (table === 'tax_rates') return { whereIn: vi.fn().mockResolvedValue([]) };
      throw new Error(`Unexpected table: ${table}`);
    }) as any;
    trx.fn = { now: vi.fn(() => now) };

    await createMultiLineJournalEntries(
      14,
      [
        { expense_account_id: 300, amount: 0.335, description: 'A', tax_rate_id: null, rounding_adjustment: 0 },
        { expense_account_id: 301, amount: 0.335, description: 'B', tax_rate_id: null, rounding_adjustment: 0 },
      ],
      10,
      200,
      null,
      'Vendor',
      'B-14',
      trx
    );

    const insertedRows = insertMock.mock.calls[0]?.[0];
    expect(roundingAccountFirst).toHaveBeenCalledTimes(1);
    expect(insertedRows).toHaveLength(3);
    expect(insertedRows).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        memo: 'Rounding adjustment',
      }),
    ]));
  });
});
