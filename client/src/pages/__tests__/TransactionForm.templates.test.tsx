import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'

import { worker } from '../../test/msw/browser'
import { renderWithProviders } from '../../test/renderWithProviders'
import { TransactionForm } from '../Transactions'

const ACCOUNTS = [
  { id: 1000, code: '1000', name: 'Checking', type: 'ASSET', is_active: true },
  { id: 4000, code: '4000', name: 'Tithes Income', type: 'INCOME', is_active: true },
]

const FUNDS = [
  { id: 1, name: 'General', is_active: true },
]

function stubApis() {
  worker.use(
    http.get('/api/accounts', () => HttpResponse.json({ accounts: ACCOUNTS })),
    http.get('/api/funds', () => HttpResponse.json({ funds: FUNDS })),
    http.get('/api/contacts', () => HttpResponse.json({ contacts: [] })),
  )
}

/** Seed a template with debit/credit amounts into localStorage. */
function seedAmountsTemplate(userId: number) {
  const template = {
    id: 'tmpl-amounts',
    name: 'With Amounts',
    description: 'Has debit/credit',
    rows: [
      { account_id: '1000', fund_id: '1', contact_id: '', memo: 'bank', debit: '500.00', credit: '' },
      { account_id: '4000', fund_id: '1', contact_id: '', memo: 'income', debit: '', credit: '500.00' },
    ],
    created_at: '2026-01-01T00:00:00.000Z',
  }
  localStorage.setItem(`transaction_entry_templates_u${userId}`, JSON.stringify([template]))
}

/** Seed a legacy template whose rows have no debit/credit keys. */
function seedLegacyTemplate(userId: number) {
  const template = {
    id: 'tmpl-legacy',
    name: 'Legacy Template',
    description: 'No amounts',
    rows: [
      { account_id: '1000', fund_id: '1', contact_id: '', memo: 'old deposit' },
      { account_id: '4000', fund_id: '1', contact_id: '', memo: 'old income' },
    ],
    created_at: '2025-06-01T00:00:00.000Z',
  }
  localStorage.setItem(`transaction_entry_templates_u${userId}`, JSON.stringify([template]))
}

/** Seed BOTH template types in the same localStorage key — two templates side by side. */
function seedBothTemplates(userId: number) {
  const templates = [
    {
      id: 'tmpl-amounts',
      name: 'With Amounts',
      description: 'Has debit/credit',
      rows: [
        { account_id: '1000', fund_id: '1', contact_id: '', memo: 'bank', debit: '500.00', credit: '' },
        { account_id: '4000', fund_id: '1', contact_id: '', memo: 'income', debit: '', credit: '500.00' },
      ],
      created_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'tmpl-legacy',
      name: 'Legacy Template',
      description: 'No amounts',
      rows: [
        { account_id: '1000', fund_id: '1', contact_id: '', memo: 'old deposit' },
        { account_id: '4000', fund_id: '1', contact_id: '', memo: 'old income' },
      ],
      created_at: '2025-06-01T00:00:00.000Z',
    },
  ]
  localStorage.setItem(`transaction_entry_templates_u${userId}`, JSON.stringify(templates))
}

/** Collect all number-input values (debit/credit columns) in DOM order. */
function getAmountValues(screen: { container: HTMLElement }) {
  const inputs = screen.container.querySelectorAll('input[type="number"]')
  return Array.from(inputs).map((el) => (el as HTMLInputElement).value)
}

describe('TransactionForm template loading', () => {
  it('loads amount and legacy templates, restoring debit/credit while preserving date and reference', async () => {
    stubApis()
    seedBothTemplates(33)

    const noop = () => {}
    const screen = await renderWithProviders(
      <TransactionForm onClose={noop} />,
      { auth: { id: 33, name: 'Tester', email: 'tester@example.com', role: 'admin', avatar_url: null } },
    )

    // Capture initial date and reference before any template load.
    const dateInput = () => screen.container.querySelector('input[type="date"]') as HTMLInputElement
    const refInput = () => screen.getByLabelText('Reference No')
    const originalDate = dateInput().value
    expect(originalDate).toBeTruthy()

    // ── Load the amounts template ──────────────────────────────────────────
    await screen.getByRole('button', { name: 'Load Template (2)' }).click()
    await screen.getByText('With Amounts').click()
    await expect.element(screen.getByText(/Template "With Amounts" loaded/)).toBeVisible()

    // Debit/credit inputs must reflect the saved values.
    expect(getAmountValues(screen)).toEqual(['500.00', '', '', '500.00'])

    // Description is restored.
    await expect.element(screen.getByLabelText('Description')).toHaveValue('Has debit/credit')

    // Date and reference must NOT be overwritten.
    expect(dateInput().value).toBe(originalDate)
    await expect.element(refInput()).toHaveValue('')

    // ── Load the legacy template ───────────────────────────────────────────
    await screen.getByRole('button', { name: 'Load Template (2)' }).click()
    await screen.getByText('Legacy Template').click()
    await expect.element(screen.getByText(/Template "Legacy Template" loaded/)).toBeVisible()

    // Rows without debit/credit keys must fall back to empty inputs.
    expect(getAmountValues(screen)).toEqual(['', '', '', ''])

    // Legacy memo fields still load.
    const textInputs = screen.container.querySelectorAll('input[type="text"]')
    const memoValues = Array.from(textInputs).map((el) => (el as HTMLInputElement).value)
    expect(memoValues).toContain('old deposit')
    expect(memoValues).toContain('old income')

    // Date and reference must still be preserved after the second load.
    expect(dateInput().value).toBe(originalDate)
    await expect.element(refInput()).toHaveValue('')
  })
})
