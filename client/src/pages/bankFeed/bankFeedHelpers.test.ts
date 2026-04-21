import { describe, expect, it } from 'vitest'

import { buildBillMatchRequestGroups } from './bankFeedHelpers'

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
