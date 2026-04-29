import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { http, HttpResponse } from 'msw'

import { renderWithProviders } from '../../../test/renderWithProviders'
import { worker } from '../../../test/msw/browser'
import BankMatchingRuleModal from '../BankMatchingRuleModal'

describe('BankMatchingRuleModal', () => {
  it('submits updated rule payload', async () => {
    let payload: unknown = null
    let path = ''
    worker.use(
      http.get('/api/accounts', () => HttpResponse.json({ accounts: [{ id: 2, code: '1000', name: 'Cash', type: 'ASSET', is_active: true }] })),
      http.get('/api/funds', () => HttpResponse.json({ funds: [{ id: 1, name: 'General', is_active: true }] })),
      http.get('/api/contacts', ({ request }) => {
        const type = new URL(request.url).searchParams.get('type')
        return HttpResponse.json({ contacts: [{ id: type === 'DONOR' ? 11 : 12, name: 'Contact', is_active: true }] })
      }),
      http.get('/api/tax-rates', () => HttpResponse.json({ tax_rates: [{ id: 5, name: 'GST', rate: 0.05, is_active: true }] })),
      http.put('/api/bank-matching-rules/:id', async ({ request, params }) => {
        path = `/api/bank-matching-rules/${params.id}`
        payload = await request.json()
        return HttpResponse.json({ rule: { id: Number(params.id) } })
      }),
    )

    const screen = await renderWithProviders(
      <BankMatchingRuleModal
        onClose={() => {}}
        rule={{
          id: 9,
          name: 'Match donations',
          transaction_type: 'deposit',
          match_type: 'contains',
          match_pattern: 'etransfer',
          priority: 100,
          is_active: true,
          bank_account_id: 2,
          payee_id: null,
          offset_account_id: 2,
          contact_id: null,
          splits: [],
        } as never}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Save Rule' }))
    await vi.waitFor(() => {
      expect(path).toBe('/api/bank-matching-rules/9')
      expect(payload).toEqual(expect.objectContaining({
        name: 'Match donations',
        match_pattern: 'etransfer',
        offset_account_id: 2,
      }))
    })
  })

  it('adds and removes split rows', async () => {
    worker.use(
      http.get('/api/accounts', () => HttpResponse.json({ accounts: [{ id: 2, code: '1000', name: 'Cash', type: 'ASSET', is_active: true }] })),
      http.get('/api/funds', () => HttpResponse.json({ funds: [{ id: 1, name: 'General', is_active: true }] })),
      http.get('/api/contacts', () => HttpResponse.json({ contacts: [{ id: 11, name: 'Contact', is_active: true }] })),
      http.get('/api/tax-rates', () => HttpResponse.json({ tax_rates: [{ id: 5, name: 'GST', rate: 0.05, is_active: true }] })),
    )

    const screen = await renderWithProviders(<BankMatchingRuleModal onClose={() => {}} />)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Use splits' }))
    await expect.element(screen.getByRole('button', { name: 'Add split row' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Add split row' }))

    const removeButtons = () =>
      Array.from(screen.container.querySelectorAll('button'))
        .filter((button) => button.textContent?.includes('Remove row'))

    expect(removeButtons().length).toBeGreaterThan(1)
    await userEvent.click(removeButtons()[0]!)
    expect(removeButtons().length).toBe(1)
  })
})
