import { describe, expect, it, vi } from 'vitest';

import {
  resolveTaxRateMap,
  validateBillData,
  validateLineItemAccountsWithExecutor,
} from '../billValidation';

describe('validateBillData', () => {
  it('accepts a complete bill payload', () => {
    expect(validateBillData({
      contact_id: 10,
      date: '2026-04-16',
      due_date: '2026-04-30',
      description: 'Office supplies',
      amount: 100.25,
      fund_id: 1,
      line_items: [
        {
          expense_account_id: 300,
          amount: 100.25,
          description: 'Paper',
          rounding_adjustment: 0,
          tax_rate_id: null,
        },
      ],
    })).toEqual([]);
  });

  it('reports required fields and invalid line items for creates', () => {
    expect(validateBillData({
      contact_id: 0,
      date: '',
      description: '',
      amount: 100.123,
      fund_id: 0,
      line_items: [
        {
          expense_account_id: 0,
          amount: 10.123,
          rounding_adjustment: 0.11,
        },
      ],
    })).toEqual([
      'contact_id (vendor) is required',
      'date is required',
      'amount cannot have more than 2 decimal places',
      'fund_id is required',
      'Line 1: expense account is required',
      'Line 1: amount cannot have more than 2 decimal places',
      'Line 1: rounding_adjustment cannot exceed 0.10 in absolute value',
    ]);
  });

  it('validates date ordering and date-only formats', () => {
    expect(validateBillData({
      contact_id: 10,
      date: '2026-04-16',
      due_date: '2026-04-15',
      description: 'Office supplies',
      amount: 100,
      fund_id: 1,
      line_items: [
        {
          expense_account_id: 300,
          amount: 100,
        },
      ],
    })).toContain('due_date cannot be before bill date');

    expect(validateBillData({
      contact_id: 10,
      date: '04/16/2026',
      due_date: '2026-04-30',
      description: 'Office supplies',
      amount: 100,
      fund_id: 1,
      line_items: [
        {
          expense_account_id: 300,
          amount: 100,
        },
      ],
    })).toContain('date must be a valid date (YYYY-MM-DD)');
  });

  it('only validates supplied fields on update', () => {
    expect(validateBillData({}, true)).toEqual([]);
    expect(validateBillData({ line_items: [] }, true)).toEqual([
      'at least one line item is required',
    ]);
    expect(validateBillData({ due_date: 'not-a-date' }, true)).toEqual([
      'due_date must be a valid date (YYYY-MM-DD)',
    ]);
    expect(validateBillData({ date: 'not-a-date', due_date: '2026-04-10' }, true)).toEqual([
      'date must be a valid date (YYYY-MM-DD)',
    ]);
  });
});

describe('resolveTaxRateMap', () => {
  it('returns an id-keyed map for active line-item tax rates', async () => {
    const whereIn = vi.fn().mockResolvedValue([
      { id: 2, name: 'GST', rate: '0.05', recoverable_account_id: 150 },
      { id: 3, name: 'HST', rate: '0.13', recoverable_account_id: 151 },
    ]);
    const executor = vi.fn((table: string) => {
      if (table === 'tax_rates') return { whereIn };
      throw new Error(`Unexpected table ${table}`);
    }) as any;

    const taxRateMap = await resolveTaxRateMap([
      { expense_account_id: 300, amount: 10, tax_rate_id: 2 },
      { expense_account_id: 301, amount: 20, tax_rate_id: 3 },
      { expense_account_id: 302, amount: 30, tax_rate_id: 2 },
    ], executor);

    expect(whereIn).toHaveBeenCalledWith('id', [2, 3]);
    expect(taxRateMap).toEqual({
      2: { id: 2, name: 'GST', rate: '0.05', recoverable_account_id: 150 },
      3: { id: 3, name: 'HST', rate: '0.13', recoverable_account_id: 151 },
    });
  });

  it('returns empty map when no line items have tax rate ids', async () => {
    const executor = vi.fn() as any;
    const taxRateMap = await resolveTaxRateMap([
      { expense_account_id: 300, amount: 10, tax_rate_id: null },
    ], executor);

    expect(taxRateMap).toEqual({});
    expect(executor).not.toHaveBeenCalled();
  });
});

describe('validateLineItemAccountsWithExecutor', () => {
  it('accepts active expense accounts without tax or rounding lookups', async () => {
    const accountsWhereIn = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ id: 300, type: 'EXPENSE' }]),
    });
    const accountsWhere = vi.fn();
    const db = vi.fn((table: string) => {
      if (table === 'accounts') {
        return {
          whereIn: accountsWhereIn,
          where: accountsWhere,
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }) as any;

    const errors = await validateLineItemAccountsWithExecutor([
      { expense_account_id: 300, amount: 10, tax_rate_id: null, rounding_adjustment: 0 },
    ], db);

    expect(errors).toEqual([]);
    expect(db).toHaveBeenCalledTimes(1);
    expect(db).toHaveBeenCalledWith('accounts');
    expect(accountsWhereIn).toHaveBeenCalledWith('id', [300]);
    expect(accountsWhere).not.toHaveBeenCalled();
  });

  it('validates account types and active tax rates', async () => {
    const db = vi.fn((table: string) => {
      if (table === 'tax_rates') {
        return {
          whereIn: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 2 }]),
          }),
        };
      }
      if (table === 'accounts') {
        return {
          whereIn: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { id: 300, type: 'EXPENSE' },
              { id: 301, type: 'ASSET' },
            ]),
          }),
          where: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue({ id: 999, type: 'EXPENSE' }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }) as any;

    const errors = await validateLineItemAccountsWithExecutor([
      { expense_account_id: 300, amount: 10, tax_rate_id: 2 },
      { expense_account_id: 301, amount: 20, tax_rate_id: 3 },
      { expense_account_id: 302, amount: 30, tax_rate_id: null },
    ], db);

    expect(errors).toEqual([
      'Line 2: Selected account must be an EXPENSE type',
      'Line 2: Tax can only be applied to EXPENSE accounts',
      'Line 2: Tax rate #3 does not exist or is inactive',
      'Line 3: Expense account not found or inactive',
    ]);
  });

  it('requires rounding account when rounding adjustments are present', async () => {
    const db = vi.fn((table: string) => {
      if (table === 'tax_rates') {
        return {
          whereIn: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        };
      }
      if (table === 'accounts') {
        return {
          whereIn: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 300, type: 'EXPENSE' }]),
          }),
          where: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue(undefined),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }) as any;

    const errors = await validateLineItemAccountsWithExecutor([
      { expense_account_id: 300, amount: 10, rounding_adjustment: 0.01 },
    ], db);

    expect(errors).toContain('Rounding account (59999) is missing or inactive');
  });

  it('accepts rounding adjustments when the rounding account is active', async () => {
    const roundingAccountFirst = vi.fn().mockResolvedValue({ id: 999, type: 'EXPENSE' });
    const db = vi.fn((table: string) => {
      if (table === 'accounts') {
        return {
          whereIn: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 300, type: 'EXPENSE' }]),
          }),
          where: vi.fn().mockReturnValue({
            first: roundingAccountFirst,
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }) as any;

    const errors = await validateLineItemAccountsWithExecutor([
      { expense_account_id: 300, amount: 10, rounding_adjustment: -0.01 },
    ], db);

    expect(errors).toEqual([]);
    expect(roundingAccountFirst).toHaveBeenCalledTimes(1);
  });
});
