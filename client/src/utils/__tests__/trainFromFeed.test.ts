import { describe, expect, it } from 'vitest'

import type { BankTransaction, TransactionSplit } from '@shared/contracts'
import { buildTrainFromFeedDraft, extractTrainPattern } from '../trainFromFeed'

function bankRow(overrides: Partial<Pick<BankTransaction, 'account_id' | 'raw_description' | 'sender_name' | 'bank_description_2'>>) {
  return {
    account_id: 10,
    raw_description: 'POS PURCHASE STARBUCKS 1234',
    sender_name: null,
    bank_description_2: null,
    ...overrides,
  }
}

function split(overrides: Partial<TransactionSplit>): TransactionSplit {
  return {
    amount: 50,
    fund_id: 1,
    ...overrides,
  }
}

describe('extractTrainPattern', () => {
  it('prefers sender name for e-transfer rows', () => {
    expect(extractTrainPattern(bankRow({
      raw_description: 'INTERAC E-TRANSFER AUTODEPOSIT',
      sender_name: 'Jane D.',
      bank_description_2: 'autodeposit',
    }))).toBe('jane d')
  })

  it('strips noise tokens and keeps merchant signal', () => {
    expect(extractTrainPattern(bankRow({
      raw_description: 'POS PURCHASE STARBUCKS 1234 TORONTO',
    }))).toBe('starbucks 1234 toronto')
  })

  it('returns empty string when no usable pattern exists', () => {
    expect(extractTrainPattern(bankRow({
      raw_description: 'interac e-transfer online',
      sender_name: '',
      bank_description_2: '',
    }))).toBe('')
  })
})

describe('buildTrainFromFeedDraft', () => {
  it('builds deposit draft without splits', () => {
    const result = buildTrainFromFeedDraft(bankRow({ raw_description: 'Donation ACME' }), {
      type: 'deposit',
      offset_account_id: 123,
      contact_id: 77,
    })

    expect(result.error).toBeNull()
    expect(result.pattern).toBe('donation acme')
    expect(result.draft).toEqual(expect.objectContaining({
      transaction_type: 'deposit',
      offset_account_id: 123,
      contact_id: 77,
      bank_account_id: 10,
    }))
  })

  it('builds withdrawal draft without splits', () => {
    const result = buildTrainFromFeedDraft(bankRow({ raw_description: 'Payment Hydro' }), {
      type: 'withdrawal',
      offset_account_id: 456,
      payee_id: 90,
    })

    expect(result.error).toBeNull()
    expect(result.draft).toEqual(expect.objectContaining({
      transaction_type: 'withdrawal',
      offset_account_id: 456,
      payee_id: 90,
    }))
  })

  it('returns validation errors for missing required non-split fields', () => {
    expect(buildTrainFromFeedDraft(bankRow({ raw_description: 'Cafe' }), {
      type: 'deposit',
      offset_account_id: undefined,
    }).error).toBe('Offset account is required to preview training.')

    expect(buildTrainFromFeedDraft(bankRow({ raw_description: 'Cafe' }), {
      type: 'withdrawal',
      offset_account_id: 11,
      payee_id: undefined,
    }).error).toBe('Payee is required to preview training for withdrawals.')
  })

  it('builds split draft and keeps percentages summing to 100', () => {
    const result = buildTrainFromFeedDraft(bankRow({ raw_description: 'Groceries' }), {
      type: 'withdrawal',
      payee_id: 12,
      splits: [
        split({ amount: 10, fund_id: 1, expense_account_id: 1001 }),
        split({ amount: 20, fund_id: 1, expense_account_id: 1002 }),
      ],
    })

    expect(result.error).toBeNull()
    expect(result.draft?.splits).toHaveLength(2)

    const totalPct = (result.draft?.splits || []).reduce((sum, row) => sum + row.percentage, 0)
    expect(totalPct).toBeCloseTo(100, 4)
    expect(result.draft?.splits?.[1]?.percentage).toBeCloseTo(66.6667, 4)
  })

  it('returns split validation errors for missing fields', () => {
    expect(buildTrainFromFeedDraft(bankRow({ raw_description: 'Gift' }), {
      type: 'deposit',
      splits: [split({ fund_id: undefined, offset_account_id: 100 })],
    }).error).toBe('Each split must include a fund to preview training.')

    expect(buildTrainFromFeedDraft(bankRow({ raw_description: 'Gift' }), {
      type: 'deposit',
      splits: [split({ fund_id: 1, offset_account_id: undefined })],
    }).error).toBe('Each deposit split must include an offset account to preview training.')

    expect(buildTrainFromFeedDraft(bankRow({ raw_description: 'Bill' }), {
      type: 'withdrawal',
      splits: [split({ fund_id: 1, expense_account_id: undefined })],
    }).error).toBe('Each withdrawal split must include an expense account to preview training.')
  })
})
