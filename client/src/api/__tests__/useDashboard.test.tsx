import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { QueryClient } from '@tanstack/react-query'

import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'
import { useBalanceSheet, useMonthlyPLSummary, usePLSummary, useRecentTransactions } from '../useDashboard'
import type { MonthlyPLData } from '@shared/contracts'

function PLSummaryProbe() {
  const { data } = usePLSummary()
  return <div>{String((data as { total_income?: number } | undefined)?.total_income ?? 0)}</div>
}

function MonthlyPLSummaryProbe({ from, to, enabled }: { from: string; to: string; enabled?: boolean }) {
  const { data } = useMonthlyPLSummary(from, to, enabled)
  const total = (data as MonthlyPLData | undefined)?.points?.[0]?.total_income ?? 0
  return <div>{String(total)}</div>
}

function BalanceSheetProbe() {
  const { data } = useBalanceSheet()
  return <div>{String((data as { assets?: number } | undefined)?.assets ?? 0)}</div>
}

function RecentTransactionsProbe() {
  const { data } = useRecentTransactions(4)
  return <div>{String(data?.length ?? 0)}</div>
}

describe('usePLSummary', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('requests previous-month PL summary', async () => {
    let url = ''
    worker.use(http.get('/api/reports/pl', ({ request }) => {
      url = request.url
      return HttpResponse.json({ report: { data: { total_income: 123 } } })
    }))
    const screen = await renderWithProviders(<PLSummaryProbe />)
    await expect.element(screen.getByText('123')).toBeVisible()
    expect(url).toContain('from=2026-07-01')
    expect(url).toContain('to=2026-07-31')
  })
})

describe('useBalanceSheet', () => {
  it('requests balance-sheet using as_of param', async () => {
    let url = ''
    worker.use(http.get('/api/reports/balance-sheet', ({ request }) => {
      url = request.url
      return HttpResponse.json({ report: { data: { assets: 999 } } })
    }))
    const screen = await renderWithProviders(<BalanceSheetProbe />)
    await expect.element(screen.getByText('999')).toBeVisible()
    expect(url).toContain('as_of=')
  })
})

describe('useRecentTransactions', () => {
  it('requests recent transactions with limit param', async () => {
    let url = ''
    worker.use(http.get('/api/transactions', ({ request }) => {
      url = request.url
      return HttpResponse.json({ transactions: [{ id: 1 }, { id: 2 }] })
    }))
    const screen = await renderWithProviders(<RecentTransactionsProbe />)
    await expect.element(screen.getByText('2')).toBeVisible()
    expect(url).toContain('limit=4')
  })
})

describe('useMonthlyPLSummary', () => {
  const monthlyPoints = [{ month_start: '2026-07-01', total_income: 5, total_expenses: 2 }]

  it('requests the monthly P&L endpoint with the fiscal range and maps report.data', async () => {
    let url = ''
    worker.use(http.get('/api/reports/pl/monthly', ({ request }) => {
      url = request.url
      return HttpResponse.json({ report: { data: { points: monthlyPoints } } })
    }))
    const screen = await renderWithProviders(
      <MonthlyPLSummaryProbe from="2026-07-01" to="2027-06-30" />,
    )
    await expect.element(screen.getByText('5')).toBeVisible()
    expect(url).toContain('from=2026-07-01')
    expect(url).toContain('to=2027-06-30')
  })

  it('uses the exact non-colliding query key', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    worker.use(http.get('/api/reports/pl/monthly', () =>
      HttpResponse.json({ report: { data: { points: monthlyPoints } } }),
    ))
    const screen = await renderWithProviders(
      <MonthlyPLSummaryProbe from="2026-07-01" to="2027-06-30" />,
      { queryClient },
    )
    await expect.element(screen.getByText('5')).toBeVisible()
    expect(queryClient.getQueryData(['reports', 'pl', 'monthly', '2026-07-01', '2027-06-30']))
      .toEqual({ points: monthlyPoints })
    // The existing P&L hooks key on ['reports', 'pl', from, to]; the monthly
    // dataset must not share their cache entry.
    expect(queryClient.getQueryData(['reports', 'pl', '2026-07-01', '2027-06-30'])).toBeUndefined()
  })

  it('does not fetch while disabled', async () => {
    let called = false
    worker.use(http.get('/api/reports/pl/monthly', () => {
      called = true
      return HttpResponse.json({ report: { data: { points: [] } } })
    }))
    const screen = await renderWithProviders(<MonthlyPLSummaryProbe from="" to="" enabled={false} />)
    await expect.element(screen.getByText('0')).toBeVisible()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(called).toBe(false)
  })
})
