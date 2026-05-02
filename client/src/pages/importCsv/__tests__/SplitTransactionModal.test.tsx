import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
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

  it('saves balanced deposit split payload', async () => {
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
          date: '2026-03-01',
          amount: 100,
          description: 'Sunday offering',
        } as never}
        defaultFundId={1}
        offsetAccountOptions={[{ value: 1100, label: '1100 - Donation Income' }]}
        fundOptions={[{ value: 1, label: 'General' }]}
        donorOptions={[{ value: 9, label: 'Jane Doe' }]}
        payeeOptions={[]}
        expenseAccountOptions={[]}
        activeExpenseAccountIds={[]}
      />
    )

    await userEvent.click(screen.getByTitle('Fill remaining amount'))
    await userEvent.click(screen.getByText(/Offset account…|1100 - Donation Income/))
    await userEvent.click(screen.getByText('1100 - Donation Income'))

    await expect.element(screen.getByRole('button', { name: 'Save Split' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Save Split' }))

    expect(onSave).toHaveBeenCalledWith([
      {
        amount: 100,
        offset_account_id: 1100,
        fund_id: 1,
        contact_id: null,
        memo: 'Sunday offering',
      },
    ])
  })

  it('shows legacy warning for inactive mapped withdrawal expense account', async () => {
    worker.use(
      http.get('/api/tax-rates', () => HttpResponse.json({
        tax_rates: [{ id: 1, name: 'GST', rate: 0.05, recoverable_account_id: 2100 }],
      }))
    )

    const screen = renderWithProviders(
      <SplitTransactionModal
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        row={{
          type: 'withdrawal',
          date: '2026-03-02',
          amount: 10,
          description: 'Legacy bill payment',
          splits: [
            {
              amount: 10,
              offset_account_id: 9999,
              fund_id: 1,
              contact_id: 10,
              memo: 'Legacy mapping',
            },
          ],
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

    await expect.element(
      screen.getByText(/Legacy split mapping detected on row 1/)
    ).toBeVisible()
  })

  it('saves balanced withdrawal split payload with payee and tax metadata', async () => {
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
          date: '2026-03-03',
          amount: 11.3,
          description: 'Office supplies',
          payee_id: 10,
          splits: [
            {
              amount: 11.3,
              fund_id: 1,
              expense_account_id: 5000,
              tax_rate_id: 1,
              pre_tax_amount: 10,
              rounding_adjustment: 0,
              description: 'Stationery',
            },
          ],
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

    await expect.element(screen.getByRole('button', { name: 'Save Split' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Save Split' }))

    expect(onSave).toHaveBeenCalledWith({
      payee_id: 10,
      splits: [
        {
          amount: 11.3,
          fund_id: 1,
          expense_account_id: 5000,
          tax_rate_id: 1,
          pre_tax_amount: 10,
          rounding_adjustment: 0,
          description: 'Stationery',
        },
      ],
    })
  })
})
