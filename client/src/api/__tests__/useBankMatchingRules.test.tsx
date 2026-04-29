import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'
import {
  useBankMatchingRules,
  useCreateBankMatchingRule,
  useDeleteBankMatchingRule,
  useSimulateBankMatchingRule,
  useUpdateBankMatchingRule,
} from '../useBankMatchingRules'

function RulesProbe({ enabled = true, includeInactive = true }: { enabled?: boolean; includeInactive?: boolean }) {
  const { data } = useBankMatchingRules({ enabled, includeInactive })
  return <div>{String(data?.length ?? 0)}</div>
}

function CreateRuleProbe() {
  const mutation = useCreateBankMatchingRule()
  return <button type='button' onClick={() => mutation.mutate({ name: 'Rule A', match_type: 'contains', pattern: 'COSTCO' } as never)}>Create rule</button>
}

function UpdateRuleProbe() {
  const mutation = useUpdateBankMatchingRule()
  return <button type='button' onClick={() => mutation.mutate({ id: 6, payload: { name: 'Rule B' } as never })}>Update rule</button>
}

function DeleteRuleProbe() {
  const mutation = useDeleteBankMatchingRule()
  return <button type='button' onClick={() => mutation.mutate(6)}>Delete rule</button>
}

function SimulateRuleProbe() {
  const mutation = useSimulateBankMatchingRule()
  return <button type='button' onClick={() => mutation.mutate({ pattern: 'ABC' } as never)}>Simulate rule</button>
}

describe('useBankMatchingRules', () => {
  it('requests rules with include_inactive query param', async () => {
    let url = ''
    worker.use(http.get('/api/bank-matching-rules', ({ request }) => {
      url = request.url
      return HttpResponse.json({ rules: [{ id: 1 }] })
    }))
    const screen = await renderWithProviders(<RulesProbe includeInactive={false} />)
    await expect.element(screen.getByText('1')).toBeVisible()
    expect(url).toContain('include_inactive=false')
  })

  it('does not fire when enabled is false', async () => {
    let requested = false
    worker.use(http.get('/api/bank-matching-rules', () => {
      requested = true
      return HttpResponse.json({ rules: [] })
    }))
    const screen = await renderWithProviders(<RulesProbe enabled={false} />)
    await expect.element(screen.getByText('0')).toBeVisible()
    expect(requested).toBe(false)
  })
})

describe('useCreateBankMatchingRule', () => {
  it('posts payload and invalidates bank-matching-rules', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let body: unknown = null
    worker.use(http.post('/api/bank-matching-rules', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ rule: { id: 6 } })
    }))
    const screen = await renderWithProviders(<CreateRuleProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Create rule' }).click()
    await vi.waitFor(() => {
      expect(body).toEqual({ name: 'Rule A', match_type: 'contains', pattern: 'COSTCO' })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bank-matching-rules'] })
    })
  })
})

describe('useUpdateBankMatchingRule', () => {
  it('puts payload to id endpoint and invalidates bank-matching-rules', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let path = ''
    let body: unknown = null
    worker.use(http.put('/api/bank-matching-rules/:id', async ({ request, params }) => {
      path = `/api/bank-matching-rules/${params.id}`
      body = await request.json()
      return HttpResponse.json({ rule: { id: 6 } })
    }))
    const screen = await renderWithProviders(<UpdateRuleProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Update rule' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/bank-matching-rules/6')
      expect(body).toEqual({ name: 'Rule B' })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bank-matching-rules'] })
    })
  })
})

describe('useDeleteBankMatchingRule', () => {
  it('deletes by id and invalidates bank-matching-rules', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let path = ''
    worker.use(http.delete('/api/bank-matching-rules/:id', ({ params }) => {
      path = `/api/bank-matching-rules/${params.id}`
      return HttpResponse.json({ message: 'ok' })
    }))
    const screen = await renderWithProviders(<DeleteRuleProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Delete rule' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/bank-matching-rules/6')
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bank-matching-rules'] })
    })
  })
})

describe('useSimulateBankMatchingRule', () => {
  it('posts simulate payload', async () => {
    let body: unknown = null
    worker.use(http.post('/api/bank-matching-rules/simulate', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ matches: [] })
    }))
    const screen = await renderWithProviders(<SimulateRuleProbe />)
    await screen.getByRole('button', { name: 'Simulate rule' }).click()
    await vi.waitFor(() => {
      expect(body).toEqual({ pattern: 'ABC' })
    })
  })
})
