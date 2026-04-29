import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'

import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'
import { useBalanceSheet, usePLSummary, useRecentTransactions } from '../useDashboard'

function PLSummaryProbe() {
  const { data } = usePLSummary()
  return <div>{String((data as { total_income?: number } | undefined)?.total_income ?? 0)}</div>
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
  it('requests month-range PL summary', async () => {
    let url = ''
    worker.use(http.get('/api/reports/pl', ({ request }) => {
      url = request.url
      return HttpResponse.json({ report: { data: { total_income: 123 } } })
    }))
    const screen = await renderWithProviders(<PLSummaryProbe />)
    await expect.element(screen.getByText('123')).toBeVisible()
    expect(url).toContain('from=')
    expect(url).toContain('to=')
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
