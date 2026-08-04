import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'

import { worker } from '../test/msw/browser'
import { renderWithProviders } from '../test/renderWithProviders'
import Reports from './Reports'
import type { FinancialReportExportInput } from './reports/reportExports'

import type { ReconciliationSummary, ReconciliationReport } from '@shared/contracts'

const CHURCH_TODAY = '2026-08-03'
// Must land on 2026-08-03 in the default church timezone (America/Toronto, UTC-4).
const FIXED_NOW = new Date('2026-08-03T12:00:00Z')
const FISCAL_YEAR_START = '2026-01-01'

const closedRec1000: ReconciliationSummary = {
  id: 10,
  account_id: 1,
  account_name: 'Checking',
  account_code: '1000',
  statement_date: '2026-07-31',
  statement_balance: 5000,
  opening_balance: 4000,
  is_closed: true,
  created_at: '2026-08-01T00:00:00.000Z',
  created_by_name: 'Admin',
}

const closedRec1000Newer: ReconciliationSummary = {
  ...closedRec1000,
  id: 11,
}

const openRec1000: ReconciliationSummary = {
  ...closedRec1000,
  id: 12,
  is_closed: false,
}

const closedRecOtherAccount: ReconciliationSummary = {
  ...closedRec1000,
  id: 20,
  account_code: '2000',
  account_name: 'Savings',
  account_id: 2,
}

const reconReport: ReconciliationReport = {
  account_name: 'Checking',
  account_code: '1000',
  account_type: 'ASSET',
  is_closed: true,
  status: 'BALANCED',
  statement_period_start: '2026-07-01',
  statement_period_end: '2026-07-31',
  reconciliation_date: '2026-08-01T14:30:00.000Z',
  reconciler_name: 'Admin',
  opening_balance: 4000,
  cleared_in: 1000,
  cleared_out: 500,
  statement_ending_balance: 4500,
  in_transit: 0,
  outstanding_out: 0,
  adjusted_bank_balance: 4500,
  book_balance: 4500,
  difference: 0,
  cleared_in_items: [],
  cleared_out_items: [],
  in_transit_items: [],
  outstanding_out_items: [],
  fund_activity: [],
}

let capturedUrls: Record<string, string> = {}

function stubFinancialExportApis(reconciliations: ReconciliationSummary[]) {
  capturedUrls = {}
  worker.use(
    http.get('/api/reconciliations', () =>
      HttpResponse.json({ reconciliations }),
    ),
    http.get('/api/reports/trial-balance', ({ request }) => {
      capturedUrls['trial-balance'] = new URL(request.url).search
      return HttpResponse.json({
        report: {
          type: 'trial-balance',
          generated_at: `${CHURCH_TODAY}T00:00:00Z`,
          filters: { as_of: CHURCH_TODAY },
          data: {
            accounts: [],
            grand_total_debit: 0,
            grand_total_credit: 0,
            is_balanced: true,
            as_of: CHURCH_TODAY,
            fiscal_year_start: FISCAL_YEAR_START,
            diagnostics: [],
            last_hard_close_date: null,
          },
        },
      })
    }),
    http.get('/api/reports/balance-sheet', ({ request }) => {
      capturedUrls['balance-sheet'] = new URL(request.url).search
      return HttpResponse.json({
        report: {
          type: 'balance-sheet',
          generated_at: `${CHURCH_TODAY}T00:00:00Z`,
          filters: { as_of: CHURCH_TODAY },
          data: {
            assets: [],
            liabilities: [],
            equity: [],
            total_assets: 0,
            total_liabilities: 0,
            total_equity: 0,
            total_liabilities_and_equity: 0,
            is_balanced: true,
            diagnostics: [],
            last_hard_close_date: null,
          },
        },
      })
    }),
    http.get('/api/reconciliations/:id/report', ({ params }) => {
      const { id } = params as { id: string }
      capturedUrls['reconciliation-report'] = String(id)
      return HttpResponse.json({ report: { ...reconReport } })
    }),
    http.get('/api/reports/pl', ({ request }) => {
      capturedUrls['pl'] = new URL(request.url).search
      return HttpResponse.json({
        report: {
          type: 'pl',
          generated_at: `${CHURCH_TODAY}T00:00:00Z`,
          filters: { from: FISCAL_YEAR_START, to: CHURCH_TODAY },
          data: {
            income: [],
            expenses: [],
            total_income: 0,
            total_expenses: 0,
            net_surplus: 0,
          },
        },
      })
    }),
  )
}

describe('Reports financial export', () => {
  let exporter = vi.fn<(input: FinancialReportExportInput) => Promise<void>>()

  beforeEach(() => {
    vi.useFakeTimers({ now: FIXED_NOW, toFake: ['Date'] })
    exporter = vi.fn<(input: FinancialReportExportInput) => Promise<void>>()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('triggers financial export with correct two-wave orchestration', async () => {
    stubFinancialExportApis([closedRec1000])

    const screen = await renderWithProviders(
      <Reports financialReportExporter={exporter} />,
    )

    const btn = screen.getByText('Export Financial Report')
    await btn.click()

    await vi.waitFor(() => {
      expect(exporter).toHaveBeenCalledTimes(1)
    })

    const firstCall = exporter.mock.calls[0]
    expect(firstCall).toBeDefined()
    const call = firstCall![0]
    expect(call.reportDate).toBe(CHURCH_TODAY)
    expect(call.reconciliation.account_code).toBe('1000')

    expect(call.pl.filters.from).toBe(FISCAL_YEAR_START)
    expect(call.pl.filters.to).toBe(CHURCH_TODAY)
    expect(call.pl.filters.fund_id).toBeUndefined()

    expect(call.balanceSheet.filters.as_of).toBe(CHURCH_TODAY)
    expect(call.balanceSheet.filters.fund_id).toBeUndefined()
    expect(call.trialBalance.filters.as_of).toBe(CHURCH_TODAY)
    expect(call.trialBalance.filters.fund_id).toBeUndefined()

    expect(call.pl.data).toHaveProperty('income')
    expect(call.balanceSheet.data).toHaveProperty('assets')
    expect(call.trialBalance.data).toHaveProperty('accounts')
  })

  it('selects the latest closed account-1000 reconciliation', async () => {
    stubFinancialExportApis([closedRec1000, closedRec1000Newer, openRec1000, closedRecOtherAccount])

    const screen = await renderWithProviders(
      <Reports financialReportExporter={exporter} />,
    )

    const btn = screen.getByText('Export Financial Report')
    await btn.click()

    await vi.waitFor(() => {
      expect(exporter).toHaveBeenCalledTimes(1)
    })

    expect(capturedUrls['reconciliation-report']).toBe('11')
  })

  it('shows error toast when no closed account-1000 reconciliation exists', async () => {
    stubFinancialExportApis([openRec1000])

    const screen = await renderWithProviders(
      <Reports financialReportExporter={exporter} />,
    )

    const btn = screen.getByText('Export Financial Report')
    await btn.click()

    await vi.waitFor(() => {
      expect(screen.getByText('No closed reconciliation found for account 1000.')).toBeTruthy()
    })
    expect(exporter).not.toHaveBeenCalled()
  })

  it('shows error for failed reconciliation list fetch', async () => {
    worker.use(
      http.get('/api/reconciliations', () =>
        HttpResponse.json({ error: 'Server error' }, { status: 500 }),
      ),
      http.get('/api/reports/trial-balance', () =>
        HttpResponse.json({
          report: {
            type: 'trial-balance',
            generated_at: `${CHURCH_TODAY}T00:00:00Z`,
            filters: { as_of: CHURCH_TODAY },
            data: {
              accounts: [],
              grand_total_debit: 0,
              grand_total_credit: 0,
              is_balanced: true,
              as_of: CHURCH_TODAY,
              fiscal_year_start: FISCAL_YEAR_START,
              diagnostics: [],
              last_hard_close_date: null,
            },
          },
        }),
      ),
      http.get('/api/reports/balance-sheet', () =>
        HttpResponse.json({
          report: {
            type: 'balance-sheet',
            generated_at: `${CHURCH_TODAY}T00:00:00Z`,
            filters: { as_of: CHURCH_TODAY },
            data: {
              assets: [],
              liabilities: [],
              equity: [],
              total_assets: 0,
              total_liabilities: 0,
              total_equity: 0,
              total_liabilities_and_equity: 0,
              is_balanced: true,
              diagnostics: [],
              last_hard_close_date: null,
            },
          },
        }),
      ),
    )

    const screen = await renderWithProviders(
      <Reports financialReportExporter={exporter} />,
    )

    const btn = screen.getByText('Export Financial Report')
    await btn.click()

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Failed to fetch reconciliation list')
    })
    expect(exporter).not.toHaveBeenCalled()
  })

  it('shows error for failed Trial Balance fetch', async () => {
    worker.use(
      http.get('/api/reconciliations', () =>
        HttpResponse.json({ reconciliations: [closedRec1000] }),
      ),
      http.get('/api/reports/trial-balance', () =>
        HttpResponse.json({ error: 'Server error' }, { status: 500 }),
      ),
      http.get('/api/reports/balance-sheet', () =>
        HttpResponse.json({
          report: {
            type: 'balance-sheet',
            generated_at: `${CHURCH_TODAY}T00:00:00Z`,
            filters: { as_of: CHURCH_TODAY },
            data: {
              assets: [],
              liabilities: [],
              equity: [],
              total_assets: 0,
              total_liabilities: 0,
              total_equity: 0,
              total_liabilities_and_equity: 0,
              is_balanced: true,
              diagnostics: [],
              last_hard_close_date: null,
            },
          },
        }),
      ),
    )

    const screen = await renderWithProviders(
      <Reports financialReportExporter={exporter} />,
    )

    const btn = screen.getByText('Export Financial Report')
    await btn.click()

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Failed to fetch Trial Balance')
    })
    expect(exporter).not.toHaveBeenCalled()
  })

  it('disables export buttons while pending and re-enables after', async () => {
    let resolveExport: (value: void) => void
    const exportPromise = new Promise<void>((resolve) => {
      resolveExport = resolve
    })
    const deferredExporter = vi.fn<(input: FinancialReportExportInput) => Promise<void>>()
      .mockReturnValue(exportPromise)

    stubFinancialExportApis([closedRec1000])

    const screen = await renderWithProviders(
      <Reports financialReportExporter={deferredExporter} />,
    )

    const financialBtn = screen.getByText('Export Financial Report')
    await financialBtn.click()

    await vi.waitFor(() => {
      expect(financialBtn).toBeDisabled()
    })

    resolveExport!()

    await vi.waitFor(() => {
      expect(financialBtn).not.toBeDisabled()
    })
  })

  it('cross-disables single-report export button during financial export', async () => {
    let resolveExport: (value: void) => void
    const exportPromise = new Promise<void>((resolve) => {
      resolveExport = resolve
    })
    const deferredExporter = vi.fn<(input: FinancialReportExportInput) => Promise<void>>()
      .mockReturnValue(exportPromise)

    stubFinancialExportApis([closedRec1000])

    const screen = await renderWithProviders(
      <Reports financialReportExporter={deferredExporter} />,
    )

    const runBtn = screen.getByText('Run Report')
    await runBtn.click()

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Export Excel')
    })

    const financialBtn = screen.getByText('Export Financial Report')
    await financialBtn.click()

    const singleBtn = screen.getByText('Export Excel')
    expect(financialBtn).toBeDisabled()
    expect(singleBtn).toBeDisabled()

    resolveExport!()

    await vi.waitFor(() => {
      expect(financialBtn).not.toBeDisabled()
    })
    expect(singleBtn).not.toBeDisabled()
  })
})
