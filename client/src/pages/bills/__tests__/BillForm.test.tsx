import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

import { worker } from '../../../test/msw/browser'
import { renderWithProviders } from '../../../test/renderWithProviders'
import BillForm from '../BillForm'

describe('BillForm', () => {
  it('shows read-only actions without save buttons', async () => {
    worker.use(
      http.get('/api/contacts', () => HttpResponse.json({ contacts: [] })),
      http.get('/api/accounts', () => HttpResponse.json({ accounts: [] })),
      http.get('/api/funds', () => HttpResponse.json({ funds: [{ id: 1, name: 'General', is_active: true }] })),
      http.get('/api/tax-rates', () => HttpResponse.json({ tax_rates: [] }))
    )
    const screen = renderWithProviders(
      <BillForm
        readOnly
        bill={{
          id: 11,
          contact_id: 22,
          date: '2026-03-01',
          due_date: '2026-03-15',
          amount: 120,
          amount_paid: 0,
          amount_outstanding: 120,
          fund_id: 1,
          status: 'UNPAID',
          vendor_name: 'Stationery Co',
          description: 'Supplies',
          line_items: [],
          is_voided: false,
        } as never}
        onClose={vi.fn()}
      />
    )

    await expect.element(screen.getByRole('button', { name: 'Close' })).toBeVisible()
    expect(screen.container.textContent || '').not.toContain('Save & Pay')
    expect(screen.container.textContent || '').not.toContain('Update')
  })
})
