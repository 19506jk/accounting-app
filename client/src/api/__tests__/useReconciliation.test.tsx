import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'
import {
  getReconciliationReport,
  useClearItem,
  useCloseReconciliation,
  useCreateReconciliation,
  useDeleteReconciliation,
  useReconciliation,
  useReconciliationReport,
  useReconciliations,
  useReopenReconciliation,
  useUpdateReconciliation,
} from '../useReconciliation'

function ReconciliationsProbe() {
  const { data } = useReconciliations()
  return <div>{String(data?.length ?? 0)}</div>
}

function ReconciliationProbe({ id }: { id: number | null }) {
  const { data } = useReconciliation(id)
  return <div>{(data as { id?: number } | undefined)?.id || 'none'}</div>
}

function CreateProbe() {
  const mutation = useCreateReconciliation()
  return <button type='button' onClick={() => mutation.mutate({ account_id: 10, statement_ending_balance: '100.00' } as never)}>Create reconciliation</button>
}

function UpdateProbe() {
  const mutation = useUpdateReconciliation()
  return <button type='button' onClick={() => mutation.mutate({ id: 8, statement_ending_balance: '90.00' } as never)}>Update reconciliation</button>
}

function ClearItemProbe() {
  const mutation = useClearItem(8)
  return <button type='button' onClick={() => mutation.mutate({ itemId: 2 })}>Clear item</button>
}

function CloseProbe() {
  const mutation = useCloseReconciliation()
  return <button type='button' onClick={() => mutation.mutate(8)}>Close reconciliation</button>
}

function ReopenProbe() {
  const mutation = useReopenReconciliation()
  return <button type='button' onClick={() => mutation.mutate({ id: 8, reason_note: 'Fix mismatch' })}>Reopen reconciliation</button>
}

function DeleteProbe() {
  const mutation = useDeleteReconciliation()
  return <button type='button' onClick={() => mutation.mutate(8)}>Delete reconciliation</button>
}

function ReconciliationReportProbe({ id }: { id: number | null }) {
  const { data } = useReconciliationReport(id)
  return <div>{(data as { marker?: string } | undefined)?.marker || 'none'}</div>
}

describe('query hooks', () => {
  it('useReconciliations fetches list', async () => {
    worker.use(http.get('/api/reconciliations', () => HttpResponse.json({ reconciliations: [{ id: 8 }] })))
    const screen = await renderWithProviders(<ReconciliationsProbe />)
    await expect.element(screen.getByText('1')).toBeVisible()
  })

  it('useReconciliation fetches detail when id exists', async () => {
    worker.use(http.get('/api/reconciliations/:id', () => HttpResponse.json({ reconciliation: { id: 8, items: [] } })))
    const screen = await renderWithProviders(<ReconciliationProbe id={8} />)
    await expect.element(screen.getByText('8')).toBeVisible()
  })

  it('useReconciliation does not fire when id is null', async () => {
    let requested = false
    worker.use(http.get('/api/reconciliations/:id', () => {
      requested = true
      return HttpResponse.json({ reconciliation: { id: 8, items: [] } })
    }))
    const screen = await renderWithProviders(<ReconciliationProbe id={null} />)
    await expect.element(screen.getByText('none')).toBeVisible()
    expect(requested).toBe(false)
  })

  it('useReconciliationReport fetches report by id', async () => {
    worker.use(http.get('/api/reconciliations/:id/report', () => HttpResponse.json({ report: { marker: 'ok' } })))
    const screen = await renderWithProviders(<ReconciliationReportProbe id={8} />)
    await expect.element(screen.getByText('ok')).toBeVisible()
  })
})

describe('mutation hooks', () => {
  it('useCreateReconciliation posts and invalidates reconciliations', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    worker.use(http.post('/api/reconciliations', () => HttpResponse.json({ reconciliation: { id: 8 } })))
    const screen = await renderWithProviders(<CreateProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Create reconciliation' }).click()
    await vi.waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reconciliations'] })
    })
  })

  it('useUpdateReconciliation puts and invalidates reconciliation detail', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    worker.use(http.put('/api/reconciliations/:id', () => HttpResponse.json({ reconciliation: { id: 8 } })))
    const screen = await renderWithProviders(<UpdateProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Update reconciliation' }).click()
    await vi.waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reconciliation', 8] })
    })
  })

  it('useClearItem posts clear endpoint and invalidates reconciliation detail', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['reconciliation', 8], { id: 8, items: [{ id: 2, is_cleared: false }] })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    worker.use(http.post('/api/reconciliations/:rid/items/:itemId/clear', () => HttpResponse.json({ item: { id: 2 } })))
    const screen = await renderWithProviders(<ClearItemProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Clear item' }).click()
    await vi.waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reconciliation', 8] })
    })
  })

  it('useCloseReconciliation posts close and invalidates list + detail', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    worker.use(http.post('/api/reconciliations/:id/close', () => HttpResponse.json({ reconciliation: { id: 8 } })))
    const screen = await renderWithProviders(<CloseProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Close reconciliation' }).click()
    await vi.waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reconciliations'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reconciliation', 8] })
    })
  })

  it('useReopenReconciliation posts reopen body and invalidates list', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let body: unknown = null
    worker.use(http.post('/api/reconciliations/:id/reopen', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({})
    }))
    const screen = await renderWithProviders(<ReopenProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Reopen reconciliation' }).click()
    await vi.waitFor(() => {
      expect(body).toEqual({ reason_note: 'Fix mismatch' })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reconciliations'] })
    })
  })

  it('useDeleteReconciliation deletes and invalidates list', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    worker.use(http.delete('/api/reconciliations/:id', () => HttpResponse.json({})))
    const screen = await renderWithProviders(<DeleteProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Delete reconciliation' }).click()
    await vi.waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reconciliations'] })
    })
  })
})

describe('getReconciliationReport', () => {
  it('fetches reconciliation report via query client', async () => {
    const queryClient = new QueryClient()
    worker.use(http.get('/api/reconciliations/:id/report', () => HttpResponse.json({ report: { marker: 'fetched' } })))
    const result = await getReconciliationReport(queryClient, 8)
    expect((result as { marker?: string }).marker).toBe('fetched')
  })
})
