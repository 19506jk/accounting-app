import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'
import { useSettings, useUpdateSettings } from '../useSettings'

function SettingsQueryProbe({ enabled = true }: { enabled?: boolean }) {
  const { data } = useSettings(enabled)
  return <div>{data?.church_timezone || 'missing'}</div>
}

function SettingsMutationProbe() {
  const mutation = useUpdateSettings()

  return (
    <button
      type='button'
      onClick={() => mutation.mutate({ church_timezone: 'America/Chicago' })}
    >
      Save settings
    </button>
  )
}

describe('useSettings', () => {
  it('requests settings and returns values shape', async () => {
    worker.use(
      http.get('/api/settings', () => {
        return HttpResponse.json({
          values: { church_timezone: 'America/Vancouver' },
        })
      })
    )

    const screen = await renderWithProviders(<SettingsQueryProbe />)

    await expect.element(screen.getByText('America/Vancouver')).toBeVisible()
  })

  it('does not fire when enabled is false', async () => {
    let requested = false
    worker.use(
      http.get('/api/settings', () => {
        requested = true
        return HttpResponse.json({
          values: { church_timezone: 'America/Vancouver' },
        })
      })
    )

    const screen = await renderWithProviders(<SettingsQueryProbe enabled={false} />)
    await expect.element(screen.getByText('missing')).toBeVisible()
    expect(requested).toBe(false)
  })
})

describe('useUpdateSettings', () => {
  it('sends PUT payload and invalidates settings query', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let body: unknown = null

    worker.use(
      http.put('/api/settings', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({
          values: { church_timezone: 'America/Chicago' },
        })
      })
    )

    const screen = await renderWithProviders(<SettingsMutationProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Save settings' }).click()

    await vi.waitFor(() => {
      expect(body).toEqual({ church_timezone: 'America/Chicago' })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['settings'] })
    })
  })
})
