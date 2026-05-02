import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'

import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'
import {
  useBalanceSheetReport,
  useDonorDetailReport,
  useDonorSummaryReport,
  useLedgerReport,
  usePLReport,
  useTrialBalanceReport,
} from '../useReports'

function PLProbe({ enabled = true }: { enabled?: boolean }) {
  const { data } = usePLReport({ from: '2025-01-01', to: '2025-01-31' }, enabled)
  return <div>{(data as { marker?: string } | undefined)?.marker || 'none'}</div>
}

function BalanceSheetProbe() {
  const { data } = useBalanceSheetReport({ as_of: '2025-01-31' })
  return <div>{(data as { marker?: string } | undefined)?.marker || 'none'}</div>
}

function LedgerProbe() {
  const { data } = useLedgerReport({ from: '2025-01-01', to: '2025-01-31', account_id: 10 })
  return <div>{(data as { marker?: string } | undefined)?.marker || 'none'}</div>
}

function TrialBalanceProbe() {
  const { data } = useTrialBalanceReport({ as_of: '2025-01-31' })
  return <div>{(data as { marker?: string } | undefined)?.marker || 'none'}</div>
}

function DonorSummaryProbe() {
  const { data } = useDonorSummaryReport({ from: '2025-01-01', to: '2025-01-31', account_ids: '1,2' })
  return <div>{(data as { marker?: string } | undefined)?.marker || 'none'}</div>
}

function DonorDetailProbe() {
  const { data } = useDonorDetailReport({ from: '2025-01-01', to: '2025-01-31', contact_id: 3 })
  return <div>{(data as { marker?: string } | undefined)?.marker || 'none'}</div>
}

describe('usePLReport', () => {
  it('requests p&l report with params', async () => {
    let url = ''
    worker.use(http.get('/api/reports/pl', ({ request }) => {
      url = request.url
      return HttpResponse.json({ report: { marker: 'pl' } })
    }))
    const screen = await renderWithProviders(<PLProbe />)
    await expect.element(screen.getByText('pl')).toBeVisible()
    expect(url).toContain('from=2025-01-01')
    expect(url).toContain('to=2025-01-31')
  })

  it('does not fire when enabled is false', async () => {
    let requested = false
    worker.use(http.get('/api/reports/pl', () => {
      requested = true
      return HttpResponse.json({ report: { marker: 'pl' } })
    }))
    const screen = await renderWithProviders(<PLProbe enabled={false} />)
    await expect.element(screen.getByText('none')).toBeVisible()
    expect(requested).toBe(false)
  })
})

describe('useBalanceSheetReport', () => {
  it('requests balance-sheet report', async () => {
    worker.use(http.get('/api/reports/balance-sheet', () => HttpResponse.json({ report: { marker: 'bs' } })))
    const screen = await renderWithProviders(<BalanceSheetProbe />)
    await expect.element(screen.getByText('bs')).toBeVisible()
  })
})

describe('useLedgerReport', () => {
  it('requests ledger report', async () => {
    let url = ''
    worker.use(http.get('/api/reports/ledger', ({ request }) => {
      url = request.url
      return HttpResponse.json({ report: { marker: 'ledger' } })
    }))
    const screen = await renderWithProviders(<LedgerProbe />)
    await expect.element(screen.getByText('ledger')).toBeVisible()
    expect(url).toContain('account_id=10')
  })
})

describe('useTrialBalanceReport', () => {
  it('requests trial-balance report', async () => {
    worker.use(http.get('/api/reports/trial-balance', () => HttpResponse.json({ report: { marker: 'tb' } })))
    const screen = await renderWithProviders(<TrialBalanceProbe />)
    await expect.element(screen.getByText('tb')).toBeVisible()
  })
})

describe('useDonorSummaryReport', () => {
  it('requests donor summary report', async () => {
    worker.use(http.get('/api/reports/donors/summary', () => HttpResponse.json({ report: { marker: 'ds' } })))
    const screen = await renderWithProviders(<DonorSummaryProbe />)
    await expect.element(screen.getByText('ds')).toBeVisible()
  })
})

describe('useDonorDetailReport', () => {
  it('requests donor detail report', async () => {
    worker.use(http.get('/api/reports/donors/detail', () => HttpResponse.json({ report: { marker: 'dd' } })))
    const screen = await renderWithProviders(<DonorDetailProbe />)
    await expect.element(screen.getByText('dd')).toBeVisible()
  })
})
