import { describe, expect, it } from 'vitest'

import { dec, enrichParsedRows, fmt, groupBillSuggestions } from '../importCsvHelpers'
import type { ContactSummary, ImportTransactionRow } from '@shared/contracts'
import type { StatementRowMetadata } from '../importCsvTypes'

const donorContacts: ContactSummary[] = [
  {
    id: 91,
    type: 'DONOR',
    contact_class: 'HOUSEHOLD',
    name: 'Jane Doe',
    first_name: null,
    last_name: null,
    email: 'jane@example.com',
    phone: null,
    address_line1: null,
    address_line2: null,
    city: null,
    province: null,
    postal_code: null,
    donor_id: null,
    is_active: true,
  },
]

describe('enrichParsedRows', () => {
  it('prefills e-transfer offset and donor using payment_method', () => {
    const rows: ImportTransactionRow[] = [
      {
        date: '2026-04-01',
        description: 'Donation',
        amount: 100,
        type: 'deposit',
        offset_account_id: 0,
      },
    ]
    const metadata: StatementRowMetadata[] = [
      {
        payment_method: 'Interac e-Transfer',
        sender: 'Jane Doe',
        from: 'jane@example.com',
      },
    ]

    const enriched = enrichParsedRows(rows, metadata, donorContacts, 555)

    expect(enriched[0]).toEqual(expect.objectContaining({
      offset_account_id: 555,
      contact_id: 91,
    }))
  })

  it('falls back to description_1 + description_2 when payment_method is absent', () => {
    const rows: ImportTransactionRow[] = [
      {
        date: '2026-04-02',
        description: 'Donation fallback',
        amount: 80,
        type: 'deposit',
        offset_account_id: 0,
      },
    ]
    const metadata: StatementRowMetadata[] = [
      {
        description_1: 'Incoming transfer',
        description_2: 'Interac e-transfer autodeposit',
        sender: 'Jane Doe',
        from: 'jane@example.com',
      },
    ]

    const enriched = enrichParsedRows(rows, metadata, donorContacts, 777)

    expect(enriched[0]).toEqual(expect.objectContaining({
      offset_account_id: 777,
      contact_id: 91,
    }))
  })

  it('passes through non-deposit rows without e-transfer prefill', () => {
    const rows: ImportTransactionRow[] = [
      {
        date: '2026-04-03',
        description: 'Expense',
        amount: 60,
        type: 'withdrawal',
        offset_account_id: 42,
      },
    ]
    const metadata: StatementRowMetadata[] = [
      {
        payment_method: 'Interac e-Transfer',
        sender: 'Jane Doe',
        from: 'jane@example.com',
      },
    ]

    const enriched = enrichParsedRows(rows, metadata, donorContacts, 999)
    expect(enriched[0]).toEqual(expect.objectContaining({
      type: 'withdrawal',
      offset_account_id: 0,
    }))
    expect(enriched[0]?.contact_id).toBeUndefined()
  })

  it('handles missing metadata without crashing and without donor match', () => {
    const rows: ImportTransactionRow[] = [
      {
        date: '2026-04-04',
        description: 'Deposit no metadata',
        amount: 45,
        type: 'deposit',
        offset_account_id: 0,
      },
    ]

    const enriched = enrichParsedRows(rows, [], donorContacts, 888)
    expect(enriched[0]).toEqual(expect.objectContaining({
      offset_account_id: 0,
    }))
    expect(enriched[0]?.contact_id).toBeUndefined()
  })

  it('prefills e-transfer offset but leaves contact empty when no donor matches', () => {
    const rows: ImportTransactionRow[] = [
      {
        date: '2026-04-05',
        description: 'Donation unmatched',
        amount: 95,
        type: 'deposit',
        offset_account_id: 0,
      },
    ]
    const metadata: StatementRowMetadata[] = [
      {
        payment_method: 'Interac e-Transfer',
        sender: 'Unknown Name',
        from: 'unknown@example.com',
      },
    ]

    const enriched = enrichParsedRows(rows, metadata, donorContacts, 444)
    expect(enriched[0]?.offset_account_id).toBe(444)
    expect(enriched[0]?.contact_id).toBeUndefined()
  })
})

describe('groupBillSuggestions', () => {
  it('groups bill suggestions by row index', () => {
    const grouped = groupBillSuggestions([
      {
        row_index: 0,
        bill_id: 10,
        bill_number: 'B-10',
        vendor_name: 'Vendor A',
        bill_date: '2026-03-01',
        due_date: null,
        balance_due: 50,
        confidence: 'exact',
      },
      {
        row_index: 0,
        bill_id: 11,
        bill_number: 'B-11',
        vendor_name: 'Vendor B',
        bill_date: '2026-03-02',
        due_date: null,
        balance_due: 70,
        confidence: 'possible',
      },
      {
        row_index: 1,
        bill_id: 12,
        bill_number: null,
        vendor_name: 'Vendor C',
        bill_date: '2026-03-03',
        due_date: null,
        balance_due: 80,
        confidence: 'exact',
      },
    ])

    expect(Object.keys(grouped)).toEqual(['0', '1'])
    expect(grouped[0]).toHaveLength(2)
    expect(grouped[1]?.[0]?.bill_id).toBe(12)
  })
})

describe('fmt / dec', () => {
  it('formats currency-like strings and safely parses decimals', () => {
    expect(fmt('1234.5')).toBe('$1,234.50')
    expect(fmt(null)).toBe('$0.00')
    expect(dec('10.25').toNumber()).toBe(10.25)
    expect(dec('bad').toNumber()).toBe(0)
  })
})
