import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'
import { useTaxRates, useToggleTaxRate, useUpdateTaxRate } from '../useTaxRates'

function TaxRatesProbe({ activeOnly = false }: { activeOnly?: boolean }) {
  const { data } = useTaxRates({ activeOnly })
  return <div>{data?.[0]?.name || 'none'}</div>
}

function UpdateTaxRateProbe() {
  const mutation = useUpdateTaxRate()
  return <button type='button' onClick={() => mutation.mutate({ id: 4, rate: 15 })}>Update tax rate</button>
}

function ToggleTaxRateProbe() {
  const mutation = useToggleTaxRate()
  return <button type='button' onClick={() => mutation.mutate(4)}>Toggle tax rate</button>
}

describe('useTaxRates', () => {
  it('requests all tax rates when activeOnly is false', async () => {
    let url = ''
    worker.use(http.get('/api/tax-rates', ({ request }) => {
      url = request.url
      return HttpResponse.json({ tax_rates: [{ id: 4, name: 'HST', rate: 13, is_active: true }] })
    }))
    const screen = await renderWithProviders(<TaxRatesProbe />)
    await expect.element(screen.getByText('HST')).toBeVisible()
    expect(url).toContain('all=true')
  })

  it('does not send all=true when activeOnly is true', async () => {
    let url = ''
    worker.use(http.get('/api/tax-rates', ({ request }) => {
      url = request.url
      return HttpResponse.json({ tax_rates: [{ id: 4, name: 'HST', rate: 13, is_active: true }] })
    }))
    const screen = await renderWithProviders(<TaxRatesProbe activeOnly />)
    await expect.element(screen.getByText('HST')).toBeVisible()
    expect(url).not.toContain('all=true')
  })
})

describe('useUpdateTaxRate', () => {
  it('puts rate payload and invalidates tax rates', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let body: unknown = null
    let path = ''
    worker.use(http.put('/api/tax-rates/:id', async ({ request, params }) => {
      body = await request.json()
      path = `/api/tax-rates/${params.id}`
      return HttpResponse.json({ tax_rate: { id: 4, name: 'HST', rate: 15, is_active: true } })
    }))
    const screen = await renderWithProviders(<UpdateTaxRateProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Update tax rate' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/tax-rates/4')
      expect(body).toEqual({ rate: 15 })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tax-rates'] })
    })
  })
})

describe('useToggleTaxRate', () => {
  it('patches toggle endpoint and invalidates tax rates', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let method = ''
    let path = ''
    worker.use(http.patch('/api/tax-rates/:id/toggle', ({ request, params }) => {
      method = request.method
      path = `/api/tax-rates/${params.id}/toggle`
      return HttpResponse.json({ tax_rate: { id: 4, name: 'HST', rate: 15, is_active: false } })
    }))
    const screen = await renderWithProviders(<ToggleTaxRateProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Toggle tax rate' }).click()
    await vi.waitFor(() => {
      expect(method).toBe('PATCH')
      expect(path).toBe('/api/tax-rates/4/toggle')
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tax-rates'] })
    })
  })
})
