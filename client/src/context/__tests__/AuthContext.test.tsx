import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { userEvent } from 'vitest/browser'

import { useAuth } from '../AuthContext'
import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'

function Consumer() {
  const { user, isAuthenticated, isInitialLoading, login, clearAuth } = useAuth()

  return (
    <div>
      <span>
        {isInitialLoading ? 'loading' : isAuthenticated ? `auth:${user?.name}` : 'auth:none'}
      </span>
      <button
        onClick={() => login('token-1', { id: 10, name: 'Test User', email: 'test@example.com', role: 'admin', avatar_url: null })}
      >
        Login
      </button>
      <button onClick={clearAuth}>Clear</button>
    </div>
  )
}

describe('AuthContext', () => {
  it('supports login and clearing auth state', async () => {
    worker.use(
      http.get('/api/settings', () => HttpResponse.json({ values: { church_timezone: 'America/Toronto' } }))
    )

    const screen = await renderWithProviders(<Consumer />)

    await expect.element(screen.getByText('auth:none')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Login' }))
    await expect.element(screen.getByText('auth:Test User')).toBeVisible()
    expect(localStorage.getItem('church_token')).toBe('token-1')

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await expect.element(screen.getByText('auth:none')).toBeVisible()
    expect(localStorage.getItem('church_token')).toBeNull()
  })

  it('loads the stored user from /auth/me on mount', async () => {
    localStorage.setItem('church_token', 'stored-token')
    worker.use(
      http.get('/api/auth/me', () => HttpResponse.json({
        user: { id: 11, name: 'Stored User', email: 'stored@example.com', role: 'admin', avatar_url: null },
      })),
      http.get('/api/settings', () => HttpResponse.json({ values: { church_timezone: 'America/Toronto' } }))
    )

    const screen = await renderWithProviders(<Consumer />)

    await expect.element(screen.getByText('auth:Stored User')).toBeVisible()
  })

  it('clears auth when the auth check fails', async () => {
    localStorage.setItem('church_token', 'bad-token')
    worker.use(
      http.get('/api/auth/me', () => HttpResponse.error())
    )

    const screen = await renderWithProviders(<Consumer />)

    await expect.element(screen.getByText('auth:none')).toBeVisible()
    expect(localStorage.getItem('church_token')).toBeNull()
  })

  it('401 response clears localStorage and redirects to /login', async () => {
    localStorage.setItem('church_token', 'expired-token')
    localStorage.setItem('church_user', JSON.stringify({
      id: 12,
      name: 'Expired User',
      email: 'expired@example.com',
      role: 'admin',
      avatar_url: null,
    }))

    worker.use(
      http.get('/api/auth/me', () => HttpResponse.json({}, { status: 401 }))
    )

    const screen = await renderWithProviders(<Consumer />)

    await expect.element(screen.getByText('auth:none')).toBeVisible()
    expect(localStorage.getItem('church_token')).toBeNull()
    expect(localStorage.getItem('church_user')).toBeNull()
    expect(window.location.pathname).toBe('/login')
  })
})
