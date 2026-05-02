import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'
import {
  useContact,
  useContactDonationSummary,
  useContactDonations,
  useContacts,
  useCreateContact,
  useDeactivateContact,
  useDeleteContact,
  useDonationReceipt,
  useUpdateContact,
} from '../useContacts'

function ContactsProbe() {
  const { data } = useContacts({ search: 'ana', include_inactive: true })
  return <div>{data?.[0]?.name || 'none'}</div>
}

function ContactProbe({ id, enabled = true }: { id: number | null; enabled?: boolean }) {
  const { data } = useContact(id, { enabled })
  return <div>{data?.name || 'none'}</div>
}

function CreateContactProbe() {
  const mutation = useCreateContact()
  return <button type='button' onClick={() => mutation.mutate({ name: 'Ana', type: 'DONOR', contact_class: 'INDIVIDUAL' })}>Create contact</button>
}

function UpdateContactProbe() {
  const mutation = useUpdateContact()
  return <button type='button' onClick={() => mutation.mutate({ id: 7, name: 'Ana Updated' })}>Update contact</button>
}

function DeleteContactProbe() {
  const mutation = useDeleteContact()
  return <button type='button' onClick={() => mutation.mutate(7)}>Delete contact</button>
}

function DeactivateContactProbe() {
  const mutation = useDeactivateContact()
  return <button type='button' onClick={() => mutation.mutate(7)}>Deactivate contact</button>
}

function ContactDonationsProbe() {
  const { data } = useContactDonations(7, 2025)
  return <div>{String(data?.length ?? 0)}</div>
}

function DonationReceiptProbe() {
  const { data } = useDonationReceipt(7, 2025)
  return <div>{(data as { receipt_no?: string } | undefined)?.receipt_no || 'none'}</div>
}

function ContactDonationSummaryProbe() {
  const { data } = useContactDonationSummary(7)
  return <div>{String((data as { total?: number } | undefined)?.total ?? 0)}</div>
}

describe('useContacts', () => {
  it('requests contacts with query params', async () => {
    let url = ''
    worker.use(http.get('/api/contacts', ({ request }) => {
      url = request.url
      return HttpResponse.json({ contacts: [{ id: 7, name: 'Ana' }] })
    }))
    const screen = await renderWithProviders(<ContactsProbe />)
    await expect.element(screen.getByText('Ana')).toBeVisible()
    expect(url).toContain('search=ana')
    expect(url).toContain('include_inactive=true')
  })
})

describe('useContact', () => {
  it('fetches one contact by id', async () => {
    worker.use(http.get('/api/contacts/:id', () => HttpResponse.json({ contact: { id: 7, name: 'Ana' } })))
    const screen = await renderWithProviders(<ContactProbe id={7} />)
    await expect.element(screen.getByText('Ana')).toBeVisible()
  })

  it('does not fire when enabled is false', async () => {
    let requested = false
    worker.use(http.get('/api/contacts/:id', () => {
      requested = true
      return HttpResponse.json({ contact: { id: 7, name: 'Ana' } })
    }))
    const screen = await renderWithProviders(<ContactProbe id={7} enabled={false} />)
    await expect.element(screen.getByText('none')).toBeVisible()
    expect(requested).toBe(false)
  })
})

describe('useCreateContact', () => {
  it('posts payload and invalidates contacts', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let body: unknown = null
    worker.use(http.post('/api/contacts', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ contact: { id: 7, name: 'Ana' } })
    }))
    const screen = await renderWithProviders(<CreateContactProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Create contact' }).click()
    await vi.waitFor(() => {
      expect(body).toEqual({ name: 'Ana', type: 'DONOR', contact_class: 'INDIVIDUAL' })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['contacts'] })
    })
  })
})

describe('useUpdateContact', () => {
  it('puts payload and invalidates list + detail queries', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let path = ''
    let body: unknown = null
    worker.use(http.put('/api/contacts/:id', async ({ request, params }) => {
      path = `/api/contacts/${params.id}`
      body = await request.json()
      return HttpResponse.json({ contact: { id: 7, name: 'Ana Updated' } })
    }))
    const screen = await renderWithProviders(<UpdateContactProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Update contact' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/contacts/7')
      expect(body).toEqual({ name: 'Ana Updated' })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['contacts'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['contacts', 7] })
    })
  })
})

describe('useDeleteContact', () => {
  it('deletes id, invalidates contacts, and removes detail query', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const removeSpy = vi.spyOn(queryClient, 'removeQueries')
    let path = ''
    worker.use(http.delete('/api/contacts/:id', ({ params }) => {
      path = `/api/contacts/${params.id}`
      return HttpResponse.json({})
    }))
    const screen = await renderWithProviders(<DeleteContactProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Delete contact' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/contacts/7')
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['contacts'] })
      expect(removeSpy).toHaveBeenCalledWith({ queryKey: ['contacts', 7] })
    })
  })
})

describe('useDeactivateContact', () => {
  it('patches deactivate endpoint and invalidates list + detail', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let path = ''
    worker.use(http.patch('/api/contacts/:id/deactivate', ({ params }) => {
      path = `/api/contacts/${params.id}/deactivate`
      return HttpResponse.json({})
    }))
    const screen = await renderWithProviders(<DeactivateContactProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Deactivate contact' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/contacts/7/deactivate')
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['contacts'] })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['contacts', 7] })
    })
  })
})

describe('useContactDonations', () => {
  it('gets contact donations by year', async () => {
    let url = ''
    worker.use(http.get('/api/contacts/:id/donations', ({ request }) => {
      url = request.url
      return HttpResponse.json({ donations: [{ id: 1 }, { id: 2 }] })
    }))
    const screen = await renderWithProviders(<ContactDonationsProbe />)
    await expect.element(screen.getByText('2')).toBeVisible()
    expect(url).toContain('year=2025')
  })
})

describe('useDonationReceipt', () => {
  it('gets donation receipt with year query', async () => {
    let url = ''
    worker.use(http.get('/api/contacts/:id/receipt', ({ request }) => {
      url = request.url
      return HttpResponse.json({ receipt: { receipt_no: 'R-100' } })
    }))
    const screen = await renderWithProviders(<DonationReceiptProbe />)
    await expect.element(screen.getByText('R-100')).toBeVisible()
    expect(url).toContain('year=2025')
  })
})

describe('useContactDonationSummary', () => {
  it('gets contact donation summary', async () => {
    worker.use(http.get('/api/contacts/:id/donations/summary', () => HttpResponse.json({ summary: { total: 250 } })))
    const screen = await renderWithProviders(<ContactDonationSummaryProbe />)
    await expect.element(screen.getByText('250')).toBeVisible()
  })
})
