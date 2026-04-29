import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'

import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'
import ProtectedRoute from '../ProtectedRoute'

describe('ProtectedRoute', () => {
  it('shows a loading spinner while auth is resolving', async () => {
    localStorage.setItem('church_token', 'loading-token')
    worker.use(
      http.get('/api/auth/me', () => new Promise(() => {}))
    )

    const screen = await renderWithProviders(
      <ProtectedRoute>
        <div>Secret</div>
      </ProtectedRoute>
    )

    await expect.element(screen.getByText('Loading…')).toBeVisible()
  })

  it('does not render protected children when unauthenticated', async () => {
    const screen = await renderWithProviders(
      <ProtectedRoute>
        <div>Secret</div>
      </ProtectedRoute>
    )

    expect(screen.container.textContent || '').not.toContain('Secret')
  })

  it('renders children when authenticated', async () => {
    worker.use(
      http.get('/api/settings', () => HttpResponse.json({ values: { church_timezone: 'America/Toronto' } }))
    )

    const screen = await renderWithProviders(
      <ProtectedRoute>
        <div>Secret</div>
      </ProtectedRoute>,
      {
        auth: { id: 3, name: 'Signed In', email: 'signed-in@example.com', role: 'admin', avatar_url: null },
      }
    )

    await expect.element(screen.getByText('Secret')).toBeVisible()
  })
})
