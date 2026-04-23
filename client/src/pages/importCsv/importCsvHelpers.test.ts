import { describe, expect, it } from 'vitest'

import { enrichParsedRows } from './importCsvHelpers'
import type { ContactSummary, ImportTransactionRow } from '@shared/contracts'
import type { StatementRowMetadata } from './importCsvTypes'

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
})
