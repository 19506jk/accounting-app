import { describe, expect, it, vi } from 'vitest';

import { createMultiLineJournalEntries } from './billPosting';

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
});
