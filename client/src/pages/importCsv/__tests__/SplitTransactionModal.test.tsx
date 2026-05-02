import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../../test/renderWithProviders'
import { http, HttpResponse } from 'msw'

import { worker } from '../../../test/msw/browser'
import SplitTransactionModal from '../SplitTransactionModal'

describe('SplitTransactionModal', () => {
  it('blocks save for unbalanced deposit split', async () => {
    worker.use(
      http.get('/api/tax-rates', () => HttpResponse.json({ tax_rates: [] }))
    )
    const onSave = vi.fn()
    const screen = renderWithProviders(
      <SplitTransactionModal
        isOpen
        onClose={vi.fn()}
        onSave={onSave}
        row={{
          type: 'deposit',
          date: '2026-02-15',
          amount: 100,
          description: 'Deposit',
        } as never}
        defaultFundId={1}
        offsetAccountOptions={[{ value: 1100, label: '1100 - Donation Income' }]}
        fundOptions={[{ value: 1, label: 'General' }]}
        donorOptions={[]}
        payeeOptions={[]}
        expenseAccountOptions={[]}
        activeExpenseAccountIds={[]}
      />
    )

    await expect.element(screen.getByRole('button', { name: 'Save Split' })).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('blocks save for unbalanced withdrawal split', async () => {
    worker.use(
      http.get('/api/tax-rates', () => HttpResponse.json({
        tax_rates: [{ id: 1, name: 'HST', rate: 0.13, recoverable_account_id: 2100 }],
      }))
    )
    const onSave = vi.fn()
    const screen = renderWithProviders(
      <SplitTransactionModal
        isOpen
        onClose={vi.fn()}
        onSave={onSave}
        row={{
          type: 'withdrawal',
          date: '2026-02-15',
          amount: 100,
          description: 'Withdrawal',
        } as never}
        defaultFundId={1}
        offsetAccountOptions={[]}
        fundOptions={[{ value: 1, label: 'General' }]}
        donorOptions={[]}
        payeeOptions={[{ value: 10, label: 'Vendor 10' }]}
        expenseAccountOptions={[{ value: 5000, label: '5000 - Expense' }]}
        activeExpenseAccountIds={[5000]}
      />
    )

    await expect.element(screen.getByText(/^Payee\*$/)).toBeVisible()
    await expect.element(screen.getByText(/^Expense Account$/)).toBeVisible()
    await expect.element(screen.getByText(/^Tax Type$/)).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Save Split' })).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
  })
})
