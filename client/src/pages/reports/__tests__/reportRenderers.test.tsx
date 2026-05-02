import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import {
  BalanceSheetReport,
  DonorDetailReport,
  DonorSummaryReport,
  LedgerReport,
  PLReport,
  TrialBalanceReport,
} from '../reportRenderers'

describe('reportRenderers', () => {
  it('renders PL totals', async () => {
    const screen = render(
      <PLReport
        data={{
          income: [{ id: 1, name: 'Donations', amount: 500 }],
          expenses: [{ id: 2, code: '5000', name: 'Rent', amount: 200 }],
          total_income: 500,
          total_expenses: 200,
          net_surplus: 300,
        } as never}
      />
    )

    await expect.element(screen.getByText('Total Income')).toBeVisible()
    await expect.element(screen.getByText('Total Expenses')).toBeVisible()
    await expect.element(screen.getByText('Net Surplus / (Deficit)')).toBeVisible()
  })

  it('renders balance badge and diagnostics', async () => {
    const screen = render(
      <BalanceSheetReport
        onInvestigate={vi.fn()}
        data={{
          diagnostics: [{ code: 'W', severity: 'warning', message: 'Mismatch' }],
          assets: [{ id: 1, code: '1000', name: 'Cash', balance: 100 }],
          liabilities: [{ id: 2, code: '2000', name: 'AP', balance: 40 }],
          equity: [{ id: 3, code: '3000', name: 'Equity', balance: 60, is_synthetic: false }],
          total_assets: 100,
          total_liabilities: 40,
          total_equity: 60,
          total_liabilities_and_equity: 100,
          is_balanced: true,
        } as never}
      />
    )

    await expect.element(screen.getByText('Warnings')).toBeVisible()
    await expect.element(screen.getByText('✓ Balanced')).toBeVisible()
  })

  it('renders ledger table details including opening and closing balances', async () => {
    const screen = render(
      <LedgerReport
        data={{
          ledger: [
            {
              account: { id: 1, code: '1000', name: 'Chequing' },
              opening_balance: 50,
              closing_balance: 75,
              rows: [
                {
                  date: '2026-04-10',
                  reference_no: '',
                  description: 'Deposit',
                  contact_name: '',
                  fund_name: 'General',
                  debit: 25,
                  credit: 0,
                  balance: 75,
                },
              ],
            },
          ],
        } as never}
      />
    )

    await expect.element(screen.getByText('Opening Balance')).toBeVisible()
    await expect.element(screen.getByText('Closing Balance')).toBeVisible()
    await expect.element(screen.getByText('Unassigned')).toBeVisible()
  })

  it('renders trial balance rows, synthetic marker, totals, and unbalanced badge', async () => {
    const screen = render(
      <TrialBalanceReport
        onInvestigate={vi.fn()}
        data={{
          diagnostics: [],
          accounts: [
            { id: 1, code: '1000', name: 'Cash', net_debit: 300, net_credit: 0, is_synthetic: false },
            { id: 2, code: '3000', name: 'Opening Balance Equity', net_debit: 0, net_credit: 200, is_synthetic: true },
          ],
          grand_total_debit: 300,
          grand_total_credit: 200,
          is_balanced: false,
        } as never}
      />
    )

    await expect.element(screen.getByText('Synthetic')).toBeVisible()
    await expect.element(screen.getByText('TOTALS')).toBeVisible()
    await expect.element(screen.getByText('✗ Not Balanced')).toBeVisible()
  })

  it('renders donor summary and donor detail anonymous sections', async () => {
    const summaryScreen = render(
      <DonorSummaryReport
        data={{
          donors: [{ contact_id: 10, contact_name: 'Jane Doe', transaction_count: 2, total: 75 }],
          anonymous: { transaction_count: 1, total: 25 },
          grand_total: 100,
        } as never}
      />
    )

    await expect.element(summaryScreen.getByText('Grand Total')).toBeVisible()
    await expect.element(summaryScreen.getByText('Anonymous')).toBeVisible()

    const detailScreen = render(
      <DonorDetailReport
        data={{
          donors: [
            {
              contact_id: 10,
              contact_name: 'Jane Doe',
              donor_id: 'D-100',
              total: 75,
              transactions: [
                {
                  date: '2026-04-01',
                  description: 'Sunday donation',
                  account_name: 'Donations',
                  fund_name: 'General',
                  amount: 75,
                },
              ],
            },
          ],
          anonymous: {
            total: 25,
            transactions: [
              {
                date: '2026-04-02',
                description: 'Loose offering',
                account_name: 'Donations',
                fund_name: 'General',
                amount: 25,
              },
            ],
          },
        } as never}
      />
    )

    await expect.element(detailScreen.getByText('ID: D-100')).toBeVisible()
    await expect.element(detailScreen.getByText(/Anonymous \(1 donations\)/)).toBeVisible()
    await expect.element(detailScreen.getByRole('cell', { name: 'Subtotal' }).first()).toBeVisible()
  })
})
