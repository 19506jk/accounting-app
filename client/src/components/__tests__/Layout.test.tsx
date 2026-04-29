import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'

import Layout from '../Layout'
import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'

describe('Layout', () => {
  it('renders core nav links and admin links for admin users', async () => {
    worker.use(
      http.get('/api/settings', () => HttpResponse.json({ values: { church_timezone: 'America/Toronto' } }))
    )

    const screen = await renderWithProviders(<Layout />, {
      auth: { id: 1, name: 'Admin User', email: 'admin@example.com', role: 'admin', avatar_url: null },
    })

    await expect.element(screen.getByRole('link', { name: /Dashboard/ })).toBeVisible()
    await expect.element(screen.getByRole('link', { name: /Reports/ })).toBeVisible()
    await expect.element(screen.getByRole('link', { name: /Donation Receipts/ })).toBeVisible()
    await expect.element(screen.getByRole('link', { name: /Users/ })).toBeVisible()
  })

  it('hides admin links for non-admin users', async () => {
    worker.use(
      http.get('/api/settings', () => HttpResponse.json({ values: { church_timezone: 'America/Toronto' } }))
    )

    const screen = await renderWithProviders(<Layout />, {
      auth: { id: 2, name: 'Viewer User', email: 'viewer@example.com', role: 'viewer', avatar_url: null },
    })

    expect(screen.container.textContent || '').not.toContain('Administration')
    expect(screen.container.textContent || '').not.toContain('Donation Receipts')
    expect(screen.container.textContent || '').not.toContain('Users')
  })
})
