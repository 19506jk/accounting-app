import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'

import { useChurchDateConfig } from '../DateContext'
import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'

function Consumer() {
  const { churchTimeZone } = useChurchDateConfig()
  return <div>{churchTimeZone}</div>
}

describe('DateContext', () => {
  it('applies a valid configured timezone', async () => {
    worker.use(
      http.get('/api/settings', () => HttpResponse.json({ values: { church_timezone: 'America/Edmonton' } }))
    )

    const screen = await renderWithProviders(<Consumer />, {
      auth: { id: 20, name: 'TZ User', email: 'tz@example.com', role: 'admin', avatar_url: null },
    })

    await expect.element(screen.getByText('America/Edmonton')).toBeVisible()
  })

  it('falls back to the default timezone for invalid settings', async () => {
    worker.use(
      http.get('/api/settings', () => HttpResponse.json({ values: { church_timezone: 'Invalid/Zone' } }))
    )

    const screen = await renderWithProviders(<Consumer />, {
      auth: { id: 21, name: 'TZ User 2', email: 'tz2@example.com', role: 'admin', avatar_url: null },
    })

    await expect.element(screen.getByText('America/Toronto')).toBeVisible()
  })
})
