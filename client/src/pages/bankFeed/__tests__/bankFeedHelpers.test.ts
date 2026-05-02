import { describe, expect, it } from 'vitest'

import { buildBillMatchRequestGroups, formatCurrency, groupBillSuggestions } from '../bankFeedHelpers'

describe('buildBillMatchRequestGroups', () => {
  it('groups bill-match rows by bank account without dropping row indexes', () => {
    const groups = buildBillMatchRequestGroups([
      {
        row_index: 101,
        date: '2026-04-01',
        amount: 25,
        type: 'withdrawal',
        account_id: 10,
      },
      {
        row_index: 102,
        date: '2026-04-02',
        amount: 50,
        type: 'withdrawal',
        account_id: 20,
      },
      {
        row_index: 103,
        date: '2026-04-03',
        amount: 75,
        type: 'withdrawal',
        account_id: 10,
      },
    ])

    expect(groups).toEqual([
      {
        bank_account_id: 10,
        rows: [
          {
            row_index: 101,
            date: '2026-04-01',
            amount: 25,
            type: 'withdrawal',
          },
          {
            row_index: 103,
            date: '2026-04-03',
            amount: 75,
            type: 'withdrawal',
          },
        ],
      },
      {
        bank_account_id: 20,
        rows: [
          {
            row_index: 102,
            date: '2026-04-02',
            amount: 50,
            type: 'withdrawal',
          },
        ],
      },
    ])
  })
})

describe('groupBillSuggestions', () => {
  it('groups suggestions by row index', () => {
    const grouped = groupBillSuggestions([
      {
        row_index: 1,
        bill_id: 10,
        bill_number: 'B-10',
        vendor_name: 'Vendor A',
        bill_date: '2026-03-01',
        due_date: null,
        balance_due: 80,
        confidence: 'exact',
      },
      {
        row_index: 1,
        bill_id: 11,
        bill_number: null,
        vendor_name: 'Vendor B',
        bill_date: '2026-03-02',
        due_date: null,
        balance_due: 40,
        confidence: 'possible',
      },
      {
        row_index: 2,
        bill_id: 12,
        bill_number: 'B-12',
        vendor_name: 'Vendor C',
        bill_date: '2026-03-03',
        due_date: null,
        balance_due: 120,
        confidence: 'exact',
      },
    ])

    expect(Object.keys(grouped)).toEqual(['1', '2'])
    expect(grouped[1]).toHaveLength(2)
    expect(grouped[2]?.[0]?.bill_id).toBe(12)
  })
})

describe('formatCurrency', () => {
  it('formats numbers in CAD locale format', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50')
  })
})
