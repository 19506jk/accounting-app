import { http, HttpResponse } from 'msw'

import type { AuthUser } from '@shared/contracts'

export const testUser: AuthUser = {
  id: 1,
  name: 'E2E Admin',
  email: 'e2e-admin@test.local',
  avatar_url: null,
  role: 'admin',
}

export const handlers = [
  http.get('/api/auth/me', () => HttpResponse.json({ user: testUser })),
  http.get('/api/funds', () => HttpResponse.json({ funds: [] })),
  http.get('/api/accounts', () => HttpResponse.json({ accounts: [] })),
  http.get('/api/contacts', () => HttpResponse.json({ contacts: [] })),
  http.get('/api/settings', () => HttpResponse.json({ values: { church_timezone: 'UTC' } })),
  http.get('/api/tax-rates', () => HttpResponse.json({ tax_rates: [] })),
  http.get('/api/dashboard', () => HttpResponse.json({})),
]
