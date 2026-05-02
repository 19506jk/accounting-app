import { describe, expect, it } from 'vitest'
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
})
