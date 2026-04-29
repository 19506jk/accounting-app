import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'
import { useCreateFund, useDeleteFund, useFunds, useUpdateFund } from '../useFunds'

function UseFundsProbe({ includeInactive = false }: { includeInactive?: boolean }) {
  const { data } = useFunds({ include_inactive: includeInactive })
  return <div>{data?.[0]?.name || 'none'}</div>
}

function CreateFundProbe() {
  const mutation = useCreateFund()
  return <button type='button' onClick={() => mutation.mutate({ code: 'GEN', name: 'General Fund' })}>Create fund</button>
}

function UpdateFundProbe() {
  const mutation = useUpdateFund()
  return <button type='button' onClick={() => mutation.mutate({ id: 8, name: 'Updated Fund' })}>Update fund</button>
}

function DeleteFundProbe() {
  const mutation = useDeleteFund()
  return <button type='button' onClick={() => mutation.mutate(8)}>Delete fund</button>
}

describe('useFunds', () => {
  it('requests funds and includes include_inactive param branch', async () => {
    let url = ''
    worker.use(http.get('/api/funds', ({ request }) => {
      url = request.url
      return HttpResponse.json({ funds: [{ id: 1, code: 'GEN', name: 'General Fund', is_active: true }] })
    }))
    const screen = await renderWithProviders(<UseFundsProbe includeInactive />)
    await expect.element(screen.getByText('General Fund')).toBeVisible()
    expect(url).toContain('include_inactive=true')
  })
})

describe('useCreateFund', () => {
  it('posts payload and invalidates funds and accounts', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let body: unknown = null
    worker.use(http.post('/api/funds', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({
        fund: { id: 8, code: 'GEN', name: 'General Fund', is_active: true },
        equityAccount: { id: 99, code: '3000', name: 'Net Assets - General', type: 'equity', is_active: true },
      })
    }))
    const screen = await renderWithProviders(<CreateFundProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Create fund' }).click()
    await vi.waitFor(() => {
      expect(body).toEqual({ code: 'GEN', name: 'General Fund' })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['funds'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['accounts'] })
    })
  })
})

describe('useUpdateFund', () => {
  it('puts payload and invalidates funds and accounts', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let body: unknown = null
    let path = ''
    worker.use(http.put('/api/funds/:id', async ({ request, params }) => {
      body = await request.json()
      path = `/api/funds/${params.id}`
      return HttpResponse.json({ fund: { id: 8, code: 'GEN', name: 'Updated Fund', is_active: true } })
    }))
    const screen = await renderWithProviders(<UpdateFundProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Update fund' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/funds/8')
      expect(body).toEqual({ name: 'Updated Fund' })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['funds'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['accounts'] })
    })
  })
})

describe('useDeleteFund', () => {
  it('deletes by id and invalidates funds and accounts', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let path = ''
    worker.use(http.delete('/api/funds/:id', ({ params }) => {
      path = `/api/funds/${params.id}`
      return HttpResponse.json({})
    }))
    const screen = await renderWithProviders(<DeleteFundProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Delete fund' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/funds/8')
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['funds'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['accounts'] })
    })
  })
})
