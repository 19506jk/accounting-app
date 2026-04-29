import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'
import {
  useDonationReceiptAccounts,
  useDonationReceiptTemplate,
  useGenerateDonationReceiptPdf,
  usePreviewDonationReceipt,
  useSaveDonationReceiptTemplate,
} from '../useDonationReceipts'

function AccountsProbe({ enabled = true }: { enabled?: boolean }) {
  const { data } = useDonationReceiptAccounts(2025, enabled)
  return <div>{String((data as { accounts?: unknown[] } | undefined)?.accounts?.length ?? 0)}</div>
}

function TemplateProbe({ enabled = true }: { enabled?: boolean }) {
  const { data } = useDonationReceiptTemplate(enabled)
  return <div>{(data as { template_name?: string } | undefined)?.template_name || 'none'}</div>
}

function SaveTemplateProbe() {
  const mutation = useSaveDonationReceiptTemplate()
  return <button type='button' onClick={() => mutation.mutate({ template_name: 'Default Template' })}>Save template</button>
}

function PreviewProbe() {
  const mutation = usePreviewDonationReceipt()
  return <button type='button' onClick={() => mutation.mutate({ contact_id: 3, fiscal_year: 2025 })}>Preview receipt</button>
}

function GeneratePdfProbe() {
  const mutation = useGenerateDonationReceiptPdf()
  return <button type='button' onClick={() => mutation.mutate({ contact_id: 3, fiscal_year: 2025 })}>Generate receipt pdf</button>
}

describe('useDonationReceiptAccounts', () => {
  it('requests receipt accounts with fiscal_year param', async () => {
    let url = ''
    worker.use(http.get('/api/donation-receipts/accounts', ({ request }) => {
      url = request.url
      return HttpResponse.json({ accounts: [{ id: 1 }] })
    }))
    const screen = await renderWithProviders(<AccountsProbe />)
    await expect.element(screen.getByText('1')).toBeVisible()
    expect(url).toContain('fiscal_year=2025')
  })

  it('does not fire when enabled is false', async () => {
    let requested = false
    worker.use(http.get('/api/donation-receipts/accounts', () => {
      requested = true
      return HttpResponse.json({ accounts: [] })
    }))
    const screen = await renderWithProviders(<AccountsProbe enabled={false} />)
    await expect.element(screen.getByText('0')).toBeVisible()
    expect(requested).toBe(false)
  })
})

describe('useDonationReceiptTemplate', () => {
  it('fetches receipt template', async () => {
    worker.use(http.get('/api/donation-receipts/template', () => HttpResponse.json({ template_name: 'Tpl A' })))
    const screen = await renderWithProviders(<TemplateProbe />)
    await expect.element(screen.getByText('Tpl A')).toBeVisible()
  })

  it('does not fire when enabled is false', async () => {
    let requested = false
    worker.use(http.get('/api/donation-receipts/template', () => {
      requested = true
      return HttpResponse.json({ template_name: 'Tpl A' })
    }))
    const screen = await renderWithProviders(<TemplateProbe enabled={false} />)
    await expect.element(screen.getByText('none')).toBeVisible()
    expect(requested).toBe(false)
  })
})

describe('useSaveDonationReceiptTemplate', () => {
  it('puts payload and invalidates donation template query', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let body: unknown = null
    worker.use(http.put('/api/donation-receipts/template', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ template_name: 'Default Template' })
    }))
    const screen = await renderWithProviders(<SaveTemplateProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Save template' }).click()
    await vi.waitFor(() => {
      expect(body).toEqual({ template_name: 'Default Template' })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['donation-receipts', 'template'] })
    })
  })
})

describe('usePreviewDonationReceipt', () => {
  it('posts preview payload', async () => {
    let body: unknown = null
    worker.use(http.post('/api/donation-receipts/preview', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ html: '<p>ok</p>' })
    }))
    const screen = await renderWithProviders(<PreviewProbe />)
    await screen.getByRole('button', { name: 'Preview receipt' }).click()
    await vi.waitFor(() => {
      expect(body).toEqual({ contact_id: 3, fiscal_year: 2025 })
    })
  })
})

describe('useGenerateDonationReceiptPdf', () => {
  it('posts generate-pdf payload', async () => {
    let body: unknown = null
    worker.use(http.post('/api/donation-receipts/generate-pdf', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ pdf_base64: 'abc' })
    }))
    const screen = await renderWithProviders(<GeneratePdfProbe />)
    await screen.getByRole('button', { name: 'Generate receipt pdf' }).click()
    await vi.waitFor(() => {
      expect(body).toEqual({ contact_id: 3, fiscal_year: 2025 })
    })
  })
})
