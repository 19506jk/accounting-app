import { describe, expect, it } from 'vitest'

import type { ContactSummary } from '@shared/contracts'
import {
  buildDonorIndexes,
  isEtransferDescription,
  isInteracEtransferPaymentMethod,
  matchDonorFromSender,
} from '../etransferEnrich'

function donor(overrides: Partial<ContactSummary>): ContactSummary {
  return {
    id: 1,
    type: 'DONOR',
    contact_class: 'INDIVIDUAL',
    name: 'Default Donor',
    first_name: null,
    last_name: null,
    email: null,
    phone: null,
    address_line1: null,
    address_line2: null,
    city: null,
    province: null,
    postal_code: null,
    donor_id: null,
    is_active: true,
    ...overrides,
  }
}

describe('etransferEnrich helpers', () => {
  it('detects Interac payment method and e-transfer descriptions', () => {
    expect(isInteracEtransferPaymentMethod('Interac e-Transfer')).toBe(true)
    expect(isInteracEtransferPaymentMethod('Wire')).toBe(false)

    expect(isEtransferDescription('AutoDeposit Interac e-transfer received')).toBe(true)
    expect(isEtransferDescription('Cheque deposit')).toBe(false)
  })

  it('prefers household contact over individual for same email and name', () => {
    const indexes = buildDonorIndexes([
      donor({ id: 11, name: 'Jane Doe', email: 'jane@example.com', contact_class: 'INDIVIDUAL' }),
      donor({ id: 22, name: 'Jane Doe', email: 'jane@example.com', contact_class: 'HOUSEHOLD' }),
    ])

    expect(indexes.donorByEmail.get('jane@example.com')?.id).toBe(22)
    expect(indexes.donorByName.get('jane doe')?.id).toBe(22)
  })

  it('marks ambiguous same-class collisions as null and skips inactive contacts', () => {
    const indexes = buildDonorIndexes([
      donor({ id: 11, name: 'Alex', email: 'alex@example.com', contact_class: 'INDIVIDUAL' }),
      donor({ id: 12, name: 'Alex', email: 'alex@example.com', contact_class: 'INDIVIDUAL' }),
      donor({ id: 13, name: 'Inactive Alex', email: 'inactive@example.com', is_active: false }),
    ])

    expect(indexes.donorByEmail.get('alex@example.com')).toBeNull()
    expect(indexes.donorByName.get('alex')).toBeNull()
    expect(indexes.donorByEmail.has('inactive@example.com')).toBe(false)
  })

  it('matches by email first', () => {
    const indexes = buildDonorIndexes([
      donor({ id: 31, name: 'Casey Family', email: 'casey@example.com', contact_class: 'HOUSEHOLD' }),
    ])

    expect(matchDonorFromSender('casey@example.com', 'Some Other Name', indexes)).toBe(31)
  })

  it('matches by exact name when email is absent', () => {
    const indexes = buildDonorIndexes([
      donor({ id: 41, name: 'Taylor Smith', email: null, contact_class: 'INDIVIDUAL' }),
    ])

    expect(matchDonorFromSender(null, 'Taylor Smith', indexes)).toBe(41)
  })

  it('matches unique household partials and rejects ambiguous partials', () => {
    const uniqueIndexes = buildDonorIndexes([
      donor({ id: 51, name: 'Miller Family', contact_class: 'HOUSEHOLD' }),
      donor({ id: 52, name: 'Sarah Miller', contact_class: 'INDIVIDUAL' }),
    ])

    expect(matchDonorFromSender(null, 'Sarah Miller Family Donation', uniqueIndexes)).toBe(51)

    const ambiguousIndexes = buildDonorIndexes([
      donor({ id: 61, name: 'Miller Family', contact_class: 'HOUSEHOLD' }),
      donor({ id: 62, name: 'Miller Household', contact_class: 'HOUSEHOLD' }),
    ])

    expect(matchDonorFromSender(null, 'Miller', ambiguousIndexes)).toBeNull()
  })
})
