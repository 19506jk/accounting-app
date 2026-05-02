import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'
import { useFiscalPeriods, useReopenFiscalPeriod } from '../useFiscalPeriods'

function FiscalPeriodsProbe() {
  const { data } = useFiscalPeriods()
  return <div>{data?.[0] ? `FY ${data[0].fiscal_year}` : 'no-periods'}</div>
}

function ReopenFiscalPeriodProbe() {
  const mutation = useReopenFiscalPeriod()
  return (
    <button
      type='button'
      onClick={() => mutation.mutate({ id: 42, reason_note: 'Fix closing entry' })}
    >
      Reopen
    </button>
  )
}

describe('useFiscalPeriods', () => {
  it('fetches fiscal periods', async () => {
    worker.use(
      http.get('/api/fiscal-periods', () => {
        return HttpResponse.json({
          fiscal_periods: [
            { id: 7, fiscal_year: 2025, period_start: '2025-01-01', period_end: '2025-12-31', status: 'HARD_CLOSED', closing_transaction_id: null, closed_by: null, closed_at: '2025-12-31T00:00:00.000Z' },
          ],
        })
      })
    )

    const screen = await renderWithProviders(<FiscalPeriodsProbe />)
    await expect.element(screen.getByText('FY 2025')).toBeVisible()
  })
})

describe('useReopenFiscalPeriod', () => {
  it('sends delete body and invalidates fiscal periods', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let requestBody: unknown = null
    let requestMethod = ''
    let requestPath = ''

    worker.use(
      http.delete('/api/fiscal-periods/:id/reopen', async ({ request, params }) => {
        requestMethod = request.method
        requestBody = await request.json()
        requestPath = `/api/fiscal-periods/${params.id}/reopen`
        return HttpResponse.json({})
      })
    )

    const screen = await renderWithProviders(<ReopenFiscalPeriodProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Reopen' }).click()

    await vi.waitFor(() => {
      expect(requestMethod).toBe('DELETE')
      expect(requestPath).toBe('/api/fiscal-periods/42/reopen')
      expect(requestBody).toEqual({ reason_note: 'Fix closing entry' })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['fiscal-periods'] })
    })
  })
})
