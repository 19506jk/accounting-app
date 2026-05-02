import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'
import {
  useAgingReport,
  useApplyBillCredits,
  useAvailableBillCredits,
  useBill,
  useBills,
  useBillSummary,
  useCreateBill,
  usePayBill,
  useUnapplyBillCredits,
  useUpdateBill,
  useVoidBill,
} from '../useBills'

function AvailableCreditsProbe({ id }: { id: number | null }) {
  const { data } = useAvailableBillCredits(id)
  return <div>{String(data?.credits?.length ?? 0)}</div>
}

function BillsProbe() {
  const { data } = useBills({ status: 'UNPAID', contact_id: 3 })
  return <div>{data?.[0]?.bill_number || 'none'}</div>
}

function BillProbe({ id }: { id: number | null }) {
  const { data } = useBill(id)
  return <div>{data?.bill_number || 'none'}</div>
}

function BillSummaryProbe() {
  const { data } = useBillSummary()
  return <div>{String((data as { total_outstanding?: number } | undefined)?.total_outstanding ?? 0)}</div>
}

function AgingProbe({ asOf }: { asOf?: string }) {
  const { data } = useAgingReport(asOf)
  return <div>{(data as { marker?: string } | undefined)?.marker || 'none'}</div>
}

function CreateBillProbe() {
  const mutation = useCreateBill()
  return <button type='button' onClick={() => mutation.mutate({ contact_id: 3, date: '2025-01-01', description: 'Office supplies', amount: 25, fund_id: 1, line_items: [] })}>Create bill</button>
}

function UpdateBillProbe() {
  const mutation = useUpdateBill()
  return <button type='button' onClick={() => mutation.mutate({ id: 9, description: 'Updated bill' })}>Update bill</button>
}

function PayBillProbe() {
  const mutation = usePayBill()
  return <button type='button' onClick={() => mutation.mutate({ id: 9, payment_date: '2025-01-15', amount: 25, bank_account_id: 10 })}>Pay bill</button>
}

function VoidBillProbe() {
  const mutation = useVoidBill()
  return <button type='button' onClick={() => mutation.mutate({ id: 9, reason_note: 'Duplicate' })}>Void bill</button>
}

function ApplyCreditsProbe() {
  const mutation = useApplyBillCredits()
  return <button type='button' onClick={() => mutation.mutate({ id: 9, applications: [{ credit_bill_id: 1, amount: 5 }] })}>Apply credits</button>
}

function UnapplyCreditsProbe() {
  const mutation = useUnapplyBillCredits()
  return <button type='button' onClick={() => mutation.mutate({ id: 9, reason_note: 'Fix allocation' })}>Unapply credits</button>
}

describe('useAvailableBillCredits', () => {
  it('fetches available credits by bill id', async () => {
    worker.use(http.get('/api/bills/:id/available-credits', () => HttpResponse.json({ credits: [{ id: 1 }], target_bill_id: 9, target_outstanding: 10 })))
    const screen = await renderWithProviders(<AvailableCreditsProbe id={9} />)
    await expect.element(screen.getByText('1')).toBeVisible()
  })

  it('does not fire when id is null', async () => {
    let requested = false
    worker.use(http.get('/api/bills/:id/available-credits', () => {
      requested = true
      return HttpResponse.json({ credits: [], target_bill_id: 9, target_outstanding: 10 })
    }))
    const screen = await renderWithProviders(<AvailableCreditsProbe id={null} />)
    await expect.element(screen.getByText('0')).toBeVisible()
    expect(requested).toBe(false)
  })
})

describe('useBills', () => {
  it('requests bills with query params', async () => {
    let url = ''
    worker.use(http.get('/api/bills', ({ request }) => {
      url = request.url
      return HttpResponse.json({ bills: [{ id: 9, bill_number: 'B-100' }] })
    }))
    const screen = await renderWithProviders(<BillsProbe />)
    await expect.element(screen.getByText('B-100')).toBeVisible()
    expect(url).toContain('status=UNPAID')
    expect(url).toContain('contact_id=3')
  })
})

describe('useBill', () => {
  it('fetches one bill by id', async () => {
    worker.use(http.get('/api/bills/:id', () => HttpResponse.json({ bill: { id: 9, bill_number: 'B-100' } })))
    const screen = await renderWithProviders(<BillProbe id={9} />)
    await expect.element(screen.getByText('B-100')).toBeVisible()
  })
})

describe('useBillSummary', () => {
  it('fetches bill summary', async () => {
    worker.use(http.get('/api/bills/summary', () => HttpResponse.json({ summary: { total_outstanding: 140 } })))
    const screen = await renderWithProviders(<BillSummaryProbe />)
    await expect.element(screen.getByText('140')).toBeVisible()
  })
})

describe('useAgingReport', () => {
  it('requests aging report with as_of query when provided', async () => {
    let url = ''
    worker.use(http.get('/api/bills/reports/aging', ({ request }) => {
      url = request.url
      return HttpResponse.json({ report: { marker: 'aging' } })
    }))
    const screen = await renderWithProviders(<AgingProbe asOf='2025-01-31' />)
    await expect.element(screen.getByText('aging')).toBeVisible()
    expect(url).toContain('as_of=2025-01-31')
  })
})

describe('useCreateBill', () => {
  it('posts payload and invalidates bills, transactions, reports', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let body: unknown = null
    worker.use(http.post('/api/bills', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ bill: { id: 9 } })
    }))
    const screen = await renderWithProviders(<CreateBillProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Create bill' }).click()
    await vi.waitFor(() => {
      expect(body).toEqual({ contact_id: 3, date: '2025-01-01', description: 'Office supplies', amount: 25, fund_id: 1, line_items: [] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bills'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reports'] })
    })
  })
})

describe('useUpdateBill', () => {
  it('puts payload and invalidates bills + transactions', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let path = ''
    let body: unknown = null
    worker.use(http.put('/api/bills/:id', async ({ request, params }) => {
      path = `/api/bills/${params.id}`
      body = await request.json()
      return HttpResponse.json({ bill: { id: 9 } })
    }))
    const screen = await renderWithProviders(<UpdateBillProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Update bill' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/bills/9')
      expect(body).toEqual({ description: 'Updated bill' })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bills'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] })
    })
  })
})

describe('usePayBill', () => {
  it('posts pay payload and invalidates bills, transactions, reports', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let path = ''
    let body: unknown = null
    worker.use(http.post('/api/bills/:id/pay', async ({ request, params }) => {
      path = `/api/bills/${params.id}/pay`
      body = await request.json()
      return HttpResponse.json({ bill: { id: 9 } })
    }))
    const screen = await renderWithProviders(<PayBillProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Pay bill' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/bills/9/pay')
      expect(body).toEqual({ payment_date: '2025-01-15', amount: 25, bank_account_id: 10 })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bills'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reports'] })
    })
  })
})

describe('useVoidBill', () => {
  it('posts void payload and invalidates bills, transactions, reports', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let path = ''
    let body: unknown = null
    worker.use(http.post('/api/bills/:id/void', async ({ request, params }) => {
      path = `/api/bills/${params.id}/void`
      body = await request.json()
      return HttpResponse.json({ bill: { id: 9 } })
    }))
    const screen = await renderWithProviders(<VoidBillProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Void bill' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/bills/9/void')
      expect(body).toEqual({ reason_note: 'Duplicate' })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bills'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reports'] })
    })
  })
})

describe('useApplyBillCredits', () => {
  it('posts apply-credits payload and invalidates all expected queries', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let path = ''
    let body: unknown = null
    worker.use(http.post('/api/bills/:id/apply-credits', async ({ request, params }) => {
      path = `/api/bills/${params.id}/apply-credits`
      body = await request.json()
      return HttpResponse.json({ bill: { id: 9 }, applications: [] })
    }))
    const screen = await renderWithProviders(<ApplyCreditsProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Apply credits' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/bills/9/apply-credits')
      expect(body).toEqual({ applications: [{ credit_bill_id: 1, amount: 5 }] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bills'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bills', 9] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reports'] })
    })
  })
})

describe('useUnapplyBillCredits', () => {
  it('posts unapply payload and invalidates all expected queries', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let path = ''
    let body: unknown = null
    worker.use(http.post('/api/bills/:id/unapply-credits', async ({ request, params }) => {
      path = `/api/bills/${params.id}/unapply-credits`
      body = await request.json()
      return HttpResponse.json({ bill: { id: 9 }, unapplied_count: 1 })
    }))
    const screen = await renderWithProviders(<UnapplyCreditsProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Unapply credits' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/bills/9/unapply-credits')
      expect(body).toEqual({ confirm_unapply_credits: true, reason_note: 'Fix allocation' })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bills'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bills', 9] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transactions'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reports'] })
    })
  })
})
