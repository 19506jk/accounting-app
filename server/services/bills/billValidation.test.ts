import { describe, expect, it } from 'vitest';

import { validateBillData } from './billValidation';

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
