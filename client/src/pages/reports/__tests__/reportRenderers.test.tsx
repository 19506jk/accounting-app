import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { BalanceSheetReport, PLReport } from '../reportRenderers'

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
})
