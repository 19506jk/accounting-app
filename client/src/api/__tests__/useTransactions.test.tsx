import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'
import {
  useCreateTransaction,
  useDeleteTransaction,
  useGetBillMatches,
  useTransaction,
  useTransactions,
  useUpdateTransaction,
} from '../useTransactions'

function TransactionsProbe() {
  const { data } = useTransactions({ account_id: 10, from: '2025-01-01' })
  return <div>{String(data?.transactions?.length ?? 0)}</div>
}

function TransactionProbe({ id }: { id: number | null }) {
  const { data } = useTransaction(id)
  return <div>{data?.description || 'none'}</div>
}

function CreateTransactionProbe() {
  const mutation = useCreateTransaction()
  return <button type='button' onClick={() => mutation.mutate({ date: '2025-01-01', description: 'Offering', entries: [] })}>Create tx</button>
}

function UpdateTransactionProbe() {
  const mutation = useUpdateTransaction()
  return <button type='button' onClick={() => mutation.mutate({ id: 22, description: 'Updated tx' })}>Update tx</button>
}

function DeleteTransactionProbe() {
  const mutation = useDeleteTransaction()
  return <button type='button' onClick={() => mutation.mutate(22)}>Delete tx</button>
}

function BillMatchesProbe() {
  const mutation = useGetBillMatches()
  return <button type='button' onClick={() => mutation.mutate({ bank_account_id: 10, rows: [] })}>Get bill matches</button>
}

describe('useTransactions', () => {
  it('requests transactions with query params', async () => {
    let url = ''
    worker.use(http.get('/api/transactions', ({ request }) => {
      url = request.url
      return HttpResponse.json({ transactions: [], total: 0, limit: 50, offset: 0 })
    }))
    const screen = await renderWithProviders(<TransactionsProbe />)
    await expect.element(screen.getByText('0')).toBeVisible()
    await vi.waitFor(() => {
      expect(url).toContain('account_id=10')
      expect(url).toContain('from=2025-01-01')
    })
  })
})

describe('useTransaction', () => {
  it('fetches one transaction when id is present', async () => {
    worker.use(http.get('/api/transactions/:id', () => HttpResponse.json({ transaction: { id: 22, description: 'Rent expense' } })))
    const screen = await renderWithProviders(<TransactionProbe id={22} />)
    await expect.element(screen.getByText('Rent expense')).toBeVisible()
  })

  it('does not fire when id is null', async () => {
    let requested = false
    worker.use(http.get('/api/transactions/:id', () => {
      requested = true
      return HttpResponse.json({ transaction: { id: 22, description: 'Rent expense' } })
    }))
    const screen = await renderWithProviders(<TransactionProbe id={null} />)
    await expect.element(screen.getByText('none')).toBeVisible()
    expect(requested).toBe(false)
  })
})

describe('useCreateTransaction', () => {
  it('posts payload and invalidates transactions and reports', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let body: unknown = null
    worker.use(http.post('/api/transactions', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ transaction: { id: 22, description: 'Offering' } })
    }))
    const screen = await renderWithProviders(<CreateTransactionProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Create tx' }).click()
    await vi.waitFor(() => {
      expect(body).toEqual({ date: '2025-01-01', description: 'Offering', entries: [] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reports'] })
    })
  })
})

describe('useUpdateTransaction', () => {
  it('puts payload and invalidates transactions', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let path = ''
    let body: unknown = null
    worker.use(http.put('/api/transactions/:id', async ({ request, params }) => {
      path = `/api/transactions/${params.id}`
      body = await request.json()
      return HttpResponse.json({ transaction: { id: 22, description: 'Updated tx' } })
    }))
    const screen = await renderWithProviders(<UpdateTransactionProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Update tx' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/transactions/22')
      expect(body).toEqual({ description: 'Updated tx' })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] })
    })
  })
})

describe('useDeleteTransaction', () => {
  it('deletes by id and invalidates transactions and reports', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let path = ''
    worker.use(http.delete('/api/transactions/:id', ({ params }) => {
      path = `/api/transactions/${params.id}`
      return HttpResponse.json({})
    }))
    const screen = await renderWithProviders(<DeleteTransactionProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Delete tx' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/transactions/22')
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reports'] })
    })
  })
})

describe('useGetBillMatches', () => {
  it('posts payload to bill-matches endpoint', async () => {
    let body: unknown = null
    worker.use(http.post('/api/transactions/import/bill-matches', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ matches: [] })
    }))
    const screen = await renderWithProviders(<BillMatchesProbe />)
    await screen.getByRole('button', { name: 'Get bill matches' }).click()
    await vi.waitFor(() => {
      expect(body).toEqual({ bank_account_id: 10, rows: [] })
    })
  })
})
