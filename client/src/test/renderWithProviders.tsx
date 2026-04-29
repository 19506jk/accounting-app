import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { MemoryRouter } from 'react-router-dom'
import { render } from 'vitest-browser-react'

import { worker } from './msw/browser'
import { AuthProvider } from '../context/AuthContext'
import { DateProvider } from '../context/DateContext'
import { ToastProvider } from '../components/ui/Toast'

import type { AuthUser } from '@shared/contracts'

interface RenderOptions {
  auth?: AuthUser
  initialEntries?: string[]
  queryClient?: QueryClient
}

export function renderWithProviders(
  ui: React.ReactNode,
  { auth, initialEntries = ['/'], queryClient }: RenderOptions = {}
) {
  if (auth) {
    localStorage.setItem('church_token', 'test-token')
    localStorage.setItem('church_user', JSON.stringify(auth))
    // Override the default handler so AuthProvider's boot-time GET /api/auth/me
    // returns this specific user, not the hardcoded admin from the default handler.
    worker.use(
      http.get('/api/auth/me', () => HttpResponse.json({ user: auth }))
    )
  }

  const resolvedQueryClient = queryClient || new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={resolvedQueryClient}>
      <GoogleOAuthProvider clientId='test-client-id'>
        <MemoryRouter initialEntries={initialEntries}>
          <AuthProvider>
            <DateProvider>
              <ToastProvider>
                {ui}
              </ToastProvider>
            </DateProvider>
          </AuthProvider>
        </MemoryRouter>
      </GoogleOAuthProvider>
    </QueryClientProvider>
  )
}
