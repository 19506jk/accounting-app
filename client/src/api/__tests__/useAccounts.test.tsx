import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'
import { useAccounts, useCreateAccount, useDeleteAccount, useUpdateAccount } from '../useAccounts'

function UseAccountsProbe({ includeInactive = false }: { includeInactive?: boolean }) {
  const { data } = useAccounts({ include_inactive: includeInactive, type: 'ASSET' })
  return <div>{data?.[0]?.name || 'none'}</div>
}

function CreateAccountProbe() {
  const mutation = useCreateAccount()
  return <button type='button' onClick={() => mutation.mutate({ code: '1001', name: 'Petty Cash', type: 'ASSET' })}>Create account</button>
}

function UpdateAccountProbe() {
  const mutation = useUpdateAccount()
  return <button type='button' onClick={() => mutation.mutate({ id: 12, name: 'Updated Cash' })}>Update account</button>
}

function DeleteAccountProbe() {
  const mutation = useDeleteAccount()
  return <button type='button' onClick={() => mutation.mutate(12)}>Delete account</button>
}

describe('useAccounts', () => {
  it('requests accounts with query params', async () => {
    let url = ''
    worker.use(
      http.get('/api/accounts', ({ request }) => {
        url = request.url
        return HttpResponse.json({ accounts: [{ id: 1, code: '1000', name: 'Cash', type: 'ASSET', account_class: 'ASSET', normal_balance: 'DEBIT', parent_id: null, is_active: true }] })
      }),
    )
    const screen = await renderWithProviders(<UseAccountsProbe includeInactive />)
    await expect.element(screen.getByText('Cash')).toBeVisible()
    expect(url).toContain('type=ASSET')
    expect(url).toContain('include_inactive=true')
  })
})

describe('useCreateAccount', () => {
  it('posts payload and invalidates accounts queries', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let body: unknown = null
    worker.use(http.post('/api/accounts', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ account: { id: 12, code: '1001', name: 'Petty Cash', type: 'ASSET', account_class: 'ASSET', normal_balance: 'DEBIT', parent_id: null, is_active: true } })
    }))
    const screen = await renderWithProviders(<CreateAccountProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Create account' }).click()
    await vi.waitFor(() => {
      expect(body).toEqual({ code: '1001', name: 'Petty Cash', type: 'ASSET' })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['accounts'], exact: false })
    })
  })
})

describe('useUpdateAccount', () => {
  it('puts payload to id endpoint and invalidates accounts queries', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let path = ''
    let body: unknown = null
    worker.use(http.put('/api/accounts/:id', async ({ request, params }) => {
      path = `/api/accounts/${params.id}`
      body = await request.json()
      return HttpResponse.json({ account: { id: 12, code: '1001', name: 'Updated Cash', type: 'ASSET', account_class: 'ASSET', normal_balance: 'DEBIT', parent_id: null, is_active: true } })
    }))
    const screen = await renderWithProviders(<UpdateAccountProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Update account' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/accounts/12')
      expect(body).toEqual({ name: 'Updated Cash' })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['accounts'], exact: false })
    })
  })
})

describe('useDeleteAccount', () => {
  it('deletes by id and invalidates accounts queries', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let method = ''
    let path = ''
    worker.use(http.delete('/api/accounts/:id', ({ request, params }) => {
      method = request.method
      path = `/api/accounts/${params.id}`
      return HttpResponse.json({})
    }))
    const screen = await renderWithProviders(<DeleteAccountProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Delete account' }).click()
    await vi.waitFor(() => {
      expect(method).toBe('DELETE')
      expect(path).toBe('/api/accounts/12')
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['accounts'], exact: false })
    })
  })
})
