import { describe, expect, it } from 'vitest'

import type { BillSummary } from '@shared/contracts'
import {
  getBillDisplayStatus,
  getBillOutstanding,
  getBillStatusBadgeVariant,
  isBillVoided,
} from '../billHelpers'

function bill(overrides: Partial<BillSummary>): BillSummary {
  return {
    id: 1,
    contact_id: 1,
    date: '2026-03-10',
    due_date: null,
    bill_number: null,
    description: 'Utility bill',
    amount: 100,
    amount_paid: 0,
    status: 'UNPAID',
    fund_id: 1,
    transaction_id: null,
    created_transaction_id: null,
    created_by: 1,
    paid_by: null,
    paid_at: null,
    created_at: '2026-03-10T00:00:00.000Z',
    updated_at: '2026-03-10T00:00:00.000Z',
    ...overrides,
  }
}

describe('billHelpers', () => {
  it('computes bill outstanding amount', () => {
    expect(getBillOutstanding({ amount: 120.5, amount_paid: 20.25 })).toBe(100.25)
  })

  it('identifies voided bills', () => {
    expect(isBillVoided(bill({ status: 'VOID' }))).toBe(true)
    expect(isBillVoided(bill({ status: 'UNPAID', is_voided: true }))).toBe(true)
    expect(isBillVoided(bill({ status: 'UNPAID', is_voided: false }))).toBe(false)
  })

  it('maps unpaid + partial payment to PARTIAL', () => {
    expect(getBillDisplayStatus(bill({ status: 'UNPAID', amount_paid: 10 }))).toBe('PARTIAL')
    expect(getBillDisplayStatus(bill({ status: 'PAID', amount_paid: 100 }))).toBe('PAID')
    expect(getBillDisplayStatus(bill({ status: 'VOID' }))).toBe('VOID')
  })

  it('maps status to badge variants', () => {
    expect(getBillStatusBadgeVariant('PAID')).toBe('success')
    expect(getBillStatusBadgeVariant('VOID')).toBe('secondary')
    expect(getBillStatusBadgeVariant('PARTIAL')).toBe('info')
    expect(getBillStatusBadgeVariant('UNPAID')).toBe('warning')
  })
})
