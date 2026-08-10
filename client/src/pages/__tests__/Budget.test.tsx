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
              account_name: 'Donations',
              account_type: 'INCOME',
              budget_amount: 1000,
              actual_amount: 800,
              prior_budget_amount: 900,
              prior_actual_amount: 850,
            }),
            budgetRow({
              account_id: 2,
              account_name: 'Rent',
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

    // Prior-FY difference column header.
    await expect.element(screen.getByText(`FY${fy - 1} Difference`)).toBeVisible()

    // Prior-summary rows, scoped below the 'FY{p} (Prior Year)' group header —
    // .first()/text-matching alone couldn't tell the summary cells apart from
    // the identical values in the account and totals rows.
    const priorTable = screen.getByText(`FY${fy - 1} (Prior Year)`).element().closest('table')!
    const tbodyRows = Array.from(priorTable.querySelectorAll('tbody tr'))
    const priorSection = tbodyRows.slice(
      tbodyRows.indexOf(screen.getByText(`FY${fy - 1} (Prior Year)`).element().closest('tr')!) + 1,
    )
    // Each SummaryRow renders [label, budget, actual, difference, %] cells.
    expect(priorSection[0]!.children[3]!.textContent).toBe('-$50.00') // prior income diff: 850 − 900
    expect(priorSection[0]!.children[4]!.textContent).toBe('—')       // prior income %
    expect(priorSection[1]!.children[3]!.textContent).toBe('-$30.00') // prior expense diff: 520 − 550
    expect(priorSection[1]!.children[4]!.textContent).toBe('—')       // prior expense %

    // Account-level differences, scoped to their rows via unique account names.
    expect(screen.getByText('Donations').element().closest('tr')!.textContent).toContain('-$50.00')
    expect(screen.getByText('Rent').element().closest('tr')!.textContent).toContain('-$30.00')

    // Group totals (the summary panel renders its 'Total Income' label first → .last()).
    expect(screen.getByText('Total Income').last().element().closest('tr')!.textContent).toContain('-$50.00')
    expect(screen.getByText('Total Expenses').last().element().closest('tr')!.textContent).toContain('-$30.00')
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

describe('Budget export', () => {
  it('exports the selected FY with displayed rows and settings-derived range', async () => {
    const serverRows = [
      budgetRow({
        account_id: 1, account_name: 'Donations', account_type: 'INCOME',
        budget_amount: 1000, actual_amount: 800,
        prior_budget_amount: 900, prior_actual_amount: 850,
      }),
      budgetRow({
        account_id: 2, account_name: 'Rent', account_type: 'EXPENSE',
        budget_amount: 600, actual_amount: 500,
        prior_budget_amount: 550, prior_actual_amount: 520,
      }),
    ]
    const exporter = vi.fn(async (rows: AccountBudgetRow[], period: { fiscalYear: number; from: string; to: string }) => {})
    worker.use(
      http.get('/api/settings', () =>
        HttpResponse.json({ values: { fiscal_year_start: '1' } }),
      ),
      http.get('/api/budgets', () => HttpResponse.json({ rows: serverRows })),
    )

    const screen = await renderWithProviders(<Budget budgetExporter={exporter} />)
    const btn = screen.getByRole('button', { name: 'Export Excel' })
    await expect.poll(() => (btn.element() as HTMLButtonElement).disabled).toBe(false)

    // Jump to a non-default FY.
    const jump = screen.getByLabelText('Jump to fiscal year')
    await userEvent.fill(jump, '2020')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => (screen.getByRole('combobox').element() as HTMLSelectElement).value).toBe('2020')

    // Wait out the 2020 refetch before clicking.
    await expect.poll(() => (btn.element() as HTMLButtonElement).disabled).toBe(false)

    await userEvent.click(btn)
    expect(exporter).toHaveBeenCalledTimes(1)
    const [exportedRows, exportedPeriod] = exporter.mock.calls[0]!
    expect(exportedRows).toEqual(serverRows)
    expect(exportedPeriod).toEqual({ fiscalYear: 2020, from: '2020-01-01', to: '2020-12-31' })
  })

  it('keeps export disabled through the post-save refetch and exports refreshed rows', async () => {
    const exporter = vi.fn(async (rows: AccountBudgetRow[], period: { fiscalYear: number; from: string; to: string }) => {})
    let releaseRefetch: () => void = () => {}
    const refetchHeld = new Promise<void>((r) => { releaseRefetch = r })
    let refetchStartedResolve: () => void = () => {}
    const refetchStarted = new Promise<void>((r) => { refetchStartedResolve = r })

    let call = 0
    worker.use(
      http.get('/api/settings', () =>
        HttpResponse.json({ values: { fiscal_year_start: '1' } }),
      ),
      http.put('/api/budgets/:id', () => HttpResponse.json({})),
      http.get('/api/budgets', () => {
        call += 1
        if (call === 1) {
          return HttpResponse.json({ rows: [budgetRow({ account_id: 1, account_name: 'Donations', budget_amount: 1000 })] })
        }
        // Post-save refetch — hold it open until the test releases it.
        refetchStartedResolve()
        return refetchHeld.then(() =>
          HttpResponse.json({ rows: [budgetRow({ account_id: 1, account_name: 'Donations', budget_amount: 1500 })] }),
        )
      }),
    )

    const screen = await renderWithProviders(<Budget budgetExporter={exporter} />)
    const btn = screen.getByRole('button', { name: 'Export Excel' })
    await expect.poll(() => (btn.element() as HTMLButtonElement).disabled).toBe(false)

    // Edit the budget and blur → save triggers the invalidation refetch.
    // (The jump box is also a number input, so scope to the Donations row.)
    const row = screen.getByText('Donations').element().closest('tr')!
    const budgetInput = row.querySelector('input[type="number"]') as HTMLInputElement
    await userEvent.fill(budgetInput, '1500')
    await userEvent.click(screen.getByText('Budget Planning'))

    await refetchStarted
    // Refetch in flight: button stays disabled even though the mutation settled.
    await expect.poll(() => (btn.element() as HTMLButtonElement).disabled).toBe(true)

    // Release the refetch: fresh rows arrive, button re-enables.
    releaseRefetch()
    await expect.poll(() => (btn.element() as HTMLButtonElement).disabled).toBe(false)

    await userEvent.click(btn)
    expect(exporter).toHaveBeenCalledTimes(1)
    const [exportedRows] = exporter.mock.calls[0]!
    expect(exportedRows).toEqual([
      budgetRow({ account_id: 1, account_name: 'Donations', budget_amount: 1500 }),
    ])
  })

  it('shows an error toast and restores the button when export fails', async () => {
    const exporter = vi.fn(async () => { throw new Error('export exploded') })
    worker.use(
      http.get('/api/settings', () =>
        HttpResponse.json({ values: { fiscal_year_start: '1' } }),
      ),
      http.get('/api/budgets', () =>
        HttpResponse.json({ rows: [budgetRow({ account_name: 'Donations' })] }),
      ),
    )

    const screen = await renderWithProviders(<Budget budgetExporter={exporter} />)
    const btn = screen.getByRole('button', { name: 'Export Excel' })
    await expect.poll(() => (btn.element() as HTMLButtonElement).disabled).toBe(false)

    await userEvent.click(btn)
    await expect.element(screen.getByText('Failed to export budget.')).toBeVisible()
    await expect.poll(() => (btn.element() as HTMLButtonElement).disabled).toBe(false)
  })
})
