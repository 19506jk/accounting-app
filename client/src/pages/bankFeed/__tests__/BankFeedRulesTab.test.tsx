import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { http, HttpResponse } from 'msw'

import { worker } from '../../../test/msw/browser'
import { renderWithProviders } from '../../../test/renderWithProviders'

import BankFeedRulesTab from '../BankFeedRulesTab'

describe('BankFeedRulesTab', () => {
  it('renders empty rules table and create button', async () => {
    worker.use(
      http.get('/api/accounts', () => HttpResponse.json({ accounts: [] })),
      http.get('/api/bank-matching-rules', () => HttpResponse.json({ rules: [] }))
    )
    const screen = renderWithProviders(
      <BankFeedRulesTab isActive={false} />
    )

    await expect.element(screen.getByRole('heading', { name: 'Bank Matching Rules' })).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'New Rule' })).toBeVisible()
    await expect.element(screen.getByText('No bank matching rules found.')).toBeVisible()
  })

  it('confirms and submits rule deletion', async () => {
    let deletedPath = ''

    worker.use(
      http.get('/api/accounts', () => HttpResponse.json({
        accounts: [
          {
            id: 1,
            code: '1000',
            name: 'Chequing',
            type: 'ASSET',
            account_class: 'ASSET',
            normal_balance: 'DEBIT',
            parent_id: null,
            is_active: true,
          },
        ],
      })),
      http.get('/api/bank-matching-rules', () => HttpResponse.json({
        rules: [
          {
            id: 7,
            name: 'Interac contains',
            transaction_type: 'withdrawal',
            match_type: 'contains',
            match_pattern: 'INTERAC',
            bank_account_id: 1,
            offset_account_id: null,
            payee_id: null,
            contact_id: null,
            is_active: true,
            priority: 10,
            deleted_at: null,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
            splits: [],
          },
        ],
      })),
      http.delete('/api/bank-matching-rules/:id', ({ params }) => {
        deletedPath = `/api/bank-matching-rules/${params.id}`
        return HttpResponse.json({ message: 'deleted' })
      })
    )

    const screen = renderWithProviders(
      <BankFeedRulesTab isActive />
    )

    await expect.element(screen.getByText('Interac contains')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await expect.element(screen.getByText('Confirm delete?')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))

    await vi.waitFor(() => {
      expect(deletedPath).toBe('/api/bank-matching-rules/7')
      expect(screen.container.textContent || '').toContain('Rule deleted.')
    })
  })

  it('opens edit/new modals and renders scope fallbacks', async () => {
    worker.use(
      http.get('/api/accounts', () => HttpResponse.json({
        accounts: [
          {
            id: 1,
            code: '1000',
            name: 'Chequing',
            type: 'ASSET',
            account_class: 'ASSET',
            normal_balance: 'DEBIT',
            parent_id: null,
            is_active: true,
          },
        ],
      })),
      http.get('/api/funds', () => HttpResponse.json({ funds: [{ id: 1, name: 'General', is_active: true }] })),
      http.get('/api/contacts', () => HttpResponse.json({ contacts: [] })),
      http.get('/api/tax-rates', () => HttpResponse.json({ tax_rates: [] })),
      http.get('/api/bank-matching-rules', () => HttpResponse.json({
        rules: [
          {
            id: 7,
            name: 'All-account rule',
            transaction_type: 'withdrawal',
            match_type: 'contains',
            match_pattern: 'INTERAC',
            bank_account_id: null,
            offset_account_id: null,
            payee_id: null,
            contact_id: null,
            is_active: false,
            priority: 10,
            deleted_at: null,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
            splits: [],
          },
          {
            id: 8,
            name: 'Unknown-account rule',
            transaction_type: 'deposit',
            match_type: 'exact',
            match_pattern: 'DONATION',
            bank_account_id: 999,
            offset_account_id: null,
            payee_id: null,
            contact_id: null,
            is_active: true,
            priority: 5,
            deleted_at: null,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
            splits: [],
          },
        ],
      })),
    )

    const screen = renderWithProviders(
      <BankFeedRulesTab isActive />
    )

    await expect.element(screen.getByText('All accounts')).toBeVisible()
    await expect.element(screen.getByText('Account #999')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }).first())
    await expect.element(screen.getByText('Confirm delete?')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }).first())
    await expect.element(screen.getByRole('heading', { name: 'Edit Rule' })).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Cancel' }).last()).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }).last())

    await userEvent.click(screen.getByRole('button', { name: 'New Rule' }))
    await expect.element(screen.getByRole('heading', { name: 'New Rule' })).toBeVisible()
  })

  it('shows delete failure toast when API delete fails', async () => {
    worker.use(
      http.get('/api/accounts', () => HttpResponse.json({
        accounts: [
          {
            id: 1,
            code: '1000',
            name: 'Chequing',
            type: 'ASSET',
            account_class: 'ASSET',
            normal_balance: 'DEBIT',
            parent_id: null,
            is_active: true,
          },
        ],
      })),
      http.get('/api/bank-matching-rules', () => HttpResponse.json({
        rules: [
          {
            id: 7,
            name: 'Interac contains',
            transaction_type: 'withdrawal',
            match_type: 'contains',
            match_pattern: 'INTERAC',
            bank_account_id: 1,
            offset_account_id: null,
            payee_id: null,
            contact_id: null,
            is_active: true,
            priority: 10,
            deleted_at: null,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
            splits: [],
          },
        ],
      })),
      http.delete('/api/bank-matching-rules/:id', () => HttpResponse.json(
        { error: 'cannot delete rule' },
        { status: 500 },
      )),
    )

    const screen = renderWithProviders(
      <BankFeedRulesTab isActive />
    )

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))

    await vi.waitFor(async () => {
      await expect.element(screen.getByText('cannot delete rule')).toBeVisible()
    })
  })
})
