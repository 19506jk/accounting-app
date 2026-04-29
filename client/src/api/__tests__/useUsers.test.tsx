import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'
import { useCreateUser, useDeleteUser, useUpdateUserActive, useUpdateUserRole, useUsers } from '../useUsers'

function UsersProbe() {
  const { data } = useUsers()
  return <div>{data?.[0]?.email || 'none'}</div>
}

function CreateUserProbe() {
  const mutation = useCreateUser()
  return <button type='button' onClick={() => mutation.mutate({ email: 'new@example.com', role: 'viewer' })}>Create user</button>
}

function UpdateRoleProbe() {
  const mutation = useUpdateUserRole()
  return <button type='button' onClick={() => mutation.mutate({ id: 5, role: 'admin' })}>Update role</button>
}

function UpdateActiveProbe() {
  const mutation = useUpdateUserActive()
  return <button type='button' onClick={() => mutation.mutate({ id: 5, is_active: false })}>Update active</button>
}

function DeleteUserProbe() {
  const mutation = useDeleteUser()
  return <button type='button' onClick={() => mutation.mutate(5)}>Delete user</button>
}

describe('useUsers', () => {
  it('fetches users list', async () => {
    worker.use(http.get('/api/users', () => HttpResponse.json({ users: [{ id: 5, email: 'admin@example.com', role: 'admin', is_active: true }] })))
    const screen = await renderWithProviders(<UsersProbe />)
    await expect.element(screen.getByText('admin@example.com')).toBeVisible()
  })
})

describe('useCreateUser', () => {
  it('posts payload and invalidates users', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let body: unknown = null
    worker.use(http.post('/api/users', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ user: { id: 6, email: 'new@example.com', role: 'viewer', is_active: true } })
    }))
    const screen = await renderWithProviders(<CreateUserProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Create user' }).click()
    await vi.waitFor(() => {
      expect(body).toEqual({ email: 'new@example.com', role: 'viewer' })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['users'] })
    })
  })
})

describe('useUpdateUserRole', () => {
  it('puts role payload and invalidates users', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let body: unknown = null
    let path = ''
    worker.use(http.put('/api/users/:id/role', async ({ request, params }) => {
      body = await request.json()
      path = `/api/users/${params.id}/role`
      return HttpResponse.json({ user: { id: 5, email: 'admin@example.com', role: 'admin', is_active: true } })
    }))
    const screen = await renderWithProviders(<UpdateRoleProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Update role' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/users/5/role')
      expect(body).toEqual({ role: 'admin' })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['users'] })
    })
  })
})

describe('useUpdateUserActive', () => {
  it('puts active payload and invalidates users', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let body: unknown = null
    let path = ''
    worker.use(http.put('/api/users/:id/active', async ({ request, params }) => {
      body = await request.json()
      path = `/api/users/${params.id}/active`
      return HttpResponse.json({ user: { id: 5, email: 'admin@example.com', role: 'viewer', is_active: false } })
    }))
    const screen = await renderWithProviders(<UpdateActiveProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Update active' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/users/5/active')
      expect(body).toEqual({ is_active: false })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['users'] })
    })
  })
})

describe('useDeleteUser', () => {
  it('deletes by id and invalidates users', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let path = ''
    worker.use(http.delete('/api/users/:id', ({ params }) => {
      path = `/api/users/${params.id}`
      return HttpResponse.json({})
    }))
    const screen = await renderWithProviders(<DeleteUserProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Delete user' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/users/5')
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['users'] })
    })
  })
})
