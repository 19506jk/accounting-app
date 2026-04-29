import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { http, HttpResponse } from 'msw'

import { renderWithProviders } from '../../../test/renderWithProviders'
import { worker } from '../../../test/msw/browser'
import CreateFromBankRowModal from '../CreateFromBankRowModal'

describe('CreateFromBankRowModal', () => {
  it('submits the expected create payload for deposits', async () => {
    let requestBody: unknown = null
    let requestPath = ''
    const onClose = vi.fn()
    const onSuccess = vi.fn()

    worker.use(
      http.get('/api/accounts', () => HttpResponse.json({
        accounts: [
          { id: 1, code: '1000', name: 'Main Bank', type: 'ASSET', is_active: true },
          { id: 2, code: '2050', name: 'Donations Clearing', type: 'ASSET', is_active: true },
          { id: 3, code: '6100', name: 'Office Expense', type: 'EXPENSE', is_active: true },
        ],
      })),
      http.get('/api/funds', () => HttpResponse.json({ funds: [{ id: 1, name: 'General', is_active: true }] })),
      http.get('/api/settings', () => HttpResponse.json({ values: { etransfer_deposit_offset_account_id: '2' } })),
      http.get('/api/contacts', ({ request }) => {
        const type = new URL(request.url).searchParams.get('type')
        return HttpResponse.json({
          contacts: [{ id: type === 'DONOR' ? 11 : 12, name: type === 'DONOR' ? 'Alice Donor' : 'Bob Payee', is_active: true }],
        })
      }),
      http.post('/api/bank-transactions/:id/create', async ({ request, params }) => {
        requestBody = await request.json()
        requestPath = `/api/bank-transactions/${params.id}/create`
        return HttpResponse.json({ item: { id: Number(params.id) } })
      }),
    )

    const screen = await renderWithProviders(
      <CreateFromBankRowModal
        bankTransaction={{
          id: 77,
          account_id: 1,
          amount: 120,
          bank_posted_date: '2026-03-10',
          raw_description: 'Interac e-Transfer',
          bank_description_2: 'Alice Donor',
          payment_method: 'E-TRANSFER',
          sender_email: null,
          sender_name: 'Alice Donor',
          bank_transaction_id: 'BTX-1',
          fund_id: 1,
          create_proposal: {
            description: 'Sunday donation',
            reference_no: 'REF-1',
            offset_account_id: 2,
            payee_id: null,
            contact_id: 11,
            splits: undefined,
          },
        } as never}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    )

    await userEvent.fill(screen.getByLabelText('Reference Number'), 'REF-UPDATED')
    await userEvent.click(screen.getByRole('button', { name: 'Create Journal Entry' }))

    await vi.waitFor(() => {
      expect(requestPath).toBe('/api/bank-transactions/77/create')
      expect(requestBody).toEqual({
        date: '2026-03-10',
        description: 'Sunday donation',
        reference_no: 'REF-UPDATED',
        amount: 120,
        type: 'deposit',
        train_from_feed: false,
        offset_account_id: 2,
        contact_id: 11,
      })
      expect(onSuccess).toHaveBeenCalledTimes(1)
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('shows payee selection for withdrawals', async () => {
    worker.use(
      http.get('/api/accounts', () => HttpResponse.json({
        accounts: [
          { id: 1, code: '1000', name: 'Main Bank', type: 'ASSET', is_active: true },
          { id: 3, code: '6100', name: 'Office Expense', type: 'EXPENSE', is_active: true },
        ],
      })),
      http.get('/api/funds', () => HttpResponse.json({ funds: [{ id: 1, name: 'General', is_active: true }] })),
      http.get('/api/settings', () => HttpResponse.json({ values: {} })),
      http.get('/api/contacts', ({ request }) => {
        const type = new URL(request.url).searchParams.get('type')
        return HttpResponse.json({
          contacts: [{ id: type === 'DONOR' ? 11 : 12, name: type === 'DONOR' ? 'Alice Donor' : 'Bob Payee', is_active: true }],
        })
      }),
    )

    const screen = await renderWithProviders(
      <CreateFromBankRowModal
        bankTransaction={{
          id: 78,
          account_id: 1,
          amount: -55,
          bank_posted_date: '2026-03-11',
          raw_description: 'Office supplies',
          bank_description_2: '',
          payment_method: 'CARD',
          sender_email: null,
          sender_name: null,
          bank_transaction_id: 'BTX-2',
          fund_id: 1,
          create_proposal: null,
        } as never}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    )

    await expect.element(screen.getByText('Payee')).toBeVisible()
    expect(screen.container.textContent || '').not.toContain('Optional contact')
  })
})
