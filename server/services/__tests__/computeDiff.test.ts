import { describe, expect, it } from 'vitest';

import { computeDiff } from '../auditLog.js';

describe('computeDiff', () => {
  it('returns only changed scalar fields in old/new/fields_changed', () => {
    const before = {
      description: 'Office supplies',
      amount: 100,
      reference_no: 'INV-1',
    };
    const after = {
      description: 'Office supplies correction',
      amount: 113,
      reference_no: 'INV-1',
    };

    const diff = computeDiff(before, after);

    expect(diff.fields_changed).toEqual({
      description: { from: 'Office supplies', to: 'Office supplies correction' },
      amount: { from: 100, to: 113 },
    });
    expect(diff.old).toEqual({
      description: 'Office supplies',
      amount: 100,
    });
    expect(diff.new).toEqual({
      description: 'Office supplies correction',
      amount: 113,
    });
  });

  it('returns empty maps when there are no changes', () => {
    const before = {
      description: 'No change',
      amount: 42,
    };
    const after = {
      description: 'No change',
      amount: 42,
    };

    const diff = computeDiff(before, after);

    expect(diff).toEqual({
      old: {},
      new: {},
      fields_changed: {},
    });
  });

  it('excludes created_at and updated_at changes by default', () => {
    const before = {
      description: 'Same',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    const after = {
      description: 'Same',
      created_at: '2026-01-02T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    };

    const diff = computeDiff(before, after);

    expect(diff).toEqual({
      old: {},
      new: {},
      fields_changed: {},
    });
  });

  it('treats array changes as a single value change', () => {
    const before = {
      entries: [
        { account_id: 101, debit: '100.00', credit: '0.00' },
        { account_id: 205, debit: '0.00', credit: '100.00' },
      ],
    };
    const after = {
      entries: [
        { account_id: 101, debit: '113.00', credit: '0.00' },
        { account_id: 205, debit: '0.00', credit: '113.00' },
      ],
    };

    const diff = computeDiff(before, after);

    expect(Object.keys(diff.fields_changed)).toEqual(['entries']);
    expect(diff.fields_changed.entries).toEqual({ from: before.entries, to: after.entries });
    expect(diff.old).toEqual({ entries: before.entries });
    expect(diff.new).toEqual({ entries: after.entries });
  });
});
