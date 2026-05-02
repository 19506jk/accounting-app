import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'
import { useAccessLog, useForensicLog } from '../useAuditLog'

function ForensicProbe() {
  const { data } = useForensicLog({ actor_id: 3, action: 'update' })
  return <div>{String(data?.audit_logs?.length ?? 0)}</div>
}

function AccessProbe() {
  const { data } = useAccessLog({ actor_id: 2, limit: 5 })
  return <div>{String(data?.access_logs?.length ?? 0)}</div>
}

describe('useForensicLog', () => {
  it('requests forensic log with query params', async () => {
    let url = ''
    worker.use(http.get('/api/audit-log', ({ request }) => {
      url = request.url
      return HttpResponse.json({ audit_logs: [] })
    }))
    const screen = await renderWithProviders(<ForensicProbe />)
    await expect.element(screen.getByText('0')).toBeVisible()
    await vi.waitFor(() => {
      expect(url).toContain('actor_id=3')
      expect(url).toContain('action=update')
    })
  })
})

describe('useAccessLog', () => {
  it('requests access log with query params', async () => {
    let url = ''
    worker.use(http.get('/api/audit-log/access', ({ request }) => {
      url = request.url
      return HttpResponse.json({ access_logs: [] })
    }))
    const screen = await renderWithProviders(<AccessProbe />)
    await expect.element(screen.getByText('0')).toBeVisible()
    await vi.waitFor(() => {
      expect(url).toContain('actor_id=2')
      expect(url).toContain('limit=5')
    })
  })
})
