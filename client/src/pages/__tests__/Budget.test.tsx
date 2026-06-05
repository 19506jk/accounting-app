import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { http, HttpResponse } from 'msw'

import { worker } from '../../test/msw/browser'
import { renderWithProviders } from '../../test/renderWithProviders'
import { getCurrentFiscalYear } from '../../utils/fiscalYear'
import Budget from '../Budget'
import type { AccountBudgetRow } from '@shared/contracts'

function budgetRow(overrides: Partial<AccountBudgetRow>): AccountBudgetRow {
  return {
    account_id: 1,
    account_code: '4000',
    account_name: 'Account',
    account_type: 'INCOME',
    budget_amount: 0,
    actual_amount: 0,
    prior_budget_amount: 0,
    prior_actual_amount: 0,
    ...overrides,
  }
}

// Stubs the two GETs the page makes. `fiscal_year_start` drives the picker's
// default fiscal year; the /api/budgets handler captures which year the page
// requested so tests can assert the selection actually drove the query.
function stubBudgetApis(fiscalYearStart: string) {
  const captured: { fiscalYear: string | null } = { fiscalYear: null }
  worker.use(
    http.get('/api/settings', () =>
      HttpResponse.json({ values: { fiscal_year_start: fiscalYearStart } }),
    ),
    http.get('/api/budgets', ({ request }) => {
      captured.fiscalYear = new URL(request.url).searchParams.get('fiscal_year')
      return HttpResponse.json({ rows: [] })
    }),
  )
  return captured
}

describe('Budget fiscal year picker', () => {
  it('defaults to the current fiscal year and offers next / current / prior (January start)', async () => {
    stubBudgetApis('1')
    const fy = getCurrentFiscalYear(1)

    const screen = await renderWithProviders(<Budget />)

    const select = screen.getByRole('combobox')
    await expect.element(select).toHaveValue(String(fy))

    await expect.element(screen.getByRole('option', { name: `FY${fy + 1}` })).toBeInTheDocument()
    await expect.element(screen.getByRole('option', { name: `FY${fy}` })).toBeInTheDocument()
    await expect.element(screen.getByRole('option', { name: `FY${fy - 1}` })).toBeInTheDocument()
    // The old 6-year lookback would have included FY-2; it must not.
    // screen.getByRole returns a lazy Locator in vitest-browser-react — it does
    // not throw on absent elements, so .not.toBeInTheDocument() is correct here.
    await expect.element(screen.getByRole('option', { name: `FY${fy - 2}` })).not.toBeInTheDocument()
  })

  it('uses the settings-driven start month for the default year (July start, post-July date)', async () => {
    // Pin to August 2026 so getCurrentFiscalYear(1)=2026 and getCurrentFiscalYear(7)=2027.
    // If Budget.tsx wrongly locks in the January fallback before settings load,
    // selectedYear would be 2026; the correct value is 2027.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-08-15'))
    try {
      stubBudgetApis('7')
      const screen = await renderWithProviders(<Budget />)
      await expect.element(screen.getByRole('combobox')).toHaveValue('2027')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows current-year totals with difference/% and prior-year totals', async () => {
    const fy = getCurrentFiscalYear(1)
    worker.use(
      http.get('/api/settings', () =>
        HttpResponse.json({ values: { fiscal_year_start: '1' } }),
      ),
      http.get('/api/budgets', () =>
        HttpResponse.json({
          rows: [
            budgetRow({
              account_id: 1,
              account_type: 'INCOME',
              budget_amount: 1000,
              actual_amount: 800,
              prior_budget_amount: 900,
              prior_actual_amount: 850,
            }),
            budgetRow({
              account_id: 2,
              account_type: 'EXPENSE',
              budget_amount: 600,
              actual_amount: 500,
              prior_budget_amount: 550,
              prior_actual_amount: 520,
            }),
          ],
        }),
      ),
    )

    const screen = await renderWithProviders(<Budget />)
    await expect.element(screen.getByRole('combobox')).toHaveValue(String(fy))

    // Current-year totals (budget figures also appear in per-group totals rows → .first()).
    await expect.element(screen.getByText(`FY${fy} Summary`)).toBeVisible()
    await expect.element(screen.getByText('$1,000.00').first()).toBeVisible() // income budget
    await expect.element(screen.getByText('$800.00')).toBeVisible()           // income actual
    await expect.element(screen.getByText('$500.00')).toBeVisible()           // expense actual
    await expect.element(screen.getByText('$400.00')).toBeVisible()           // net budget
    await expect.element(screen.getByText('$300.00')).toBeVisible()           // net actual

    // Difference + percentage (income: 800 − 1000 = −200, −20.0%).
    await expect.element(screen.getByText('-$200.00')).toBeVisible()
    await expect.element(screen.getByText('-20.0%')).toBeVisible()

    // Prior-year totals (also shown in each account's prior columns → .first()).
    await expect.element(screen.getByText(`FY${fy - 1} (Prior Year)`)).toBeVisible()
    await expect.element(screen.getByText('$900.00').first()).toBeVisible() // prior income budget
    await expect.element(screen.getByText('$850.00').first()).toBeVisible() // prior income actual
    await expect.element(screen.getByText('$550.00').first()).toBeVisible() // prior expense budget
    await expect.element(screen.getByText('$520.00').first()).toBeVisible() // prior expense actual
  })

  it('keeps a manually-jumped year in the dropdown and refetches it', async () => {
    const captured = stubBudgetApis('1')
    const fy = getCurrentFiscalYear(1)

    const screen = await renderWithProviders(<Budget />)
    await expect.element(screen.getByRole('combobox')).toHaveValue(String(fy))

    const jump = screen.getByLabelText('Jump to fiscal year')
    await userEvent.fill(jump, '2020')
    await userEvent.keyboard('{Enter}')

    const select = screen.getByRole('combobox')
    await expect.element(select).toHaveValue('2020')
    await expect.element(screen.getByRole('option', { name: 'FY2020' })).toBeInTheDocument()
    // The jump box clears so it never disagrees with the <select>.
    await expect.poll(() => (jump.element() as HTMLInputElement).value).toBe('')
    // The jump drove the budgets query.
    await expect.poll(() => captured.fiscalYear).toBe('2020')
  })

  it('applies a jumped year on blur and ignores out-of-range input', async () => {
    stubBudgetApis('1')
    const fy = getCurrentFiscalYear(1)

    const screen = await renderWithProviders(<Budget />)
    await expect.element(screen.getByRole('combobox')).toHaveValue(String(fy))

    const jump = screen.getByLabelText('Jump to fiscal year')

    // Out-of-range value is ignored; selection unchanged.
    await userEvent.fill(jump, '200')
    await userEvent.click(screen.getByRole('combobox')) // blur the jump input
    await expect.element(screen.getByRole('combobox')).toHaveValue(String(fy))

    // A valid year applies on blur.
    await userEvent.fill(jump, '2019')
    await userEvent.click(screen.getByRole('combobox'))
    await expect.element(screen.getByRole('combobox')).toHaveValue('2019')
  })
})
