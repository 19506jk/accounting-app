import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'

import { renderWithProviders } from '../../test/renderWithProviders'
import { worker } from '../../test/msw/browser'
import {
  useApproveMatch,
  useBankTransactions,
  useBankUploads,
  useConfirmMatch,
  useCreateFromBankRow,
  useHoldBankTransaction,
  useIgnoreBankTransaction,
  useImportBankTransactions,
  useOverrideMatch,
  useRejectCandidate,
  useReleaseHold,
  useReleaseReservation,
  useReserve,
  useReviewBankTransaction,
  useScanCandidates,
  useUnignoreBankTransaction,
} from '../useBankTransactions'

function BankTransactionsProbe({ enabled = true }: { enabled?: boolean }) {
  const { data } = useBankTransactions({ status: ['new', 'review'], amount_min: 10 }, { enabled })
  return <div>{String(data?.length ?? 0)}</div>
}

function BankUploadsProbe({ enabled = true }: { enabled?: boolean }) {
  const { data } = useBankUploads({ enabled })
  return <div>{String(data?.length ?? 0)}</div>
}

function ImportProbe() {
  const mutation = useImportBankTransactions()
  return <button type='button' onClick={() => mutation.mutate({ rows: [] } as never)}>Import</button>
}

function ReviewProbe() {
  const mutation = useReviewBankTransaction()
  return <button type='button' onClick={() => mutation.mutate({ id: 4, decision: 'approve' })}>Review</button>
}

function ScanProbe() {
  const mutation = useScanCandidates()
  return <button type='button' onClick={() => mutation.mutate(4)}>Scan</button>
}

function ReserveProbe() {
  const mutation = useReserve()
  return <button type='button' onClick={() => mutation.mutate({ id: 4, payload: { candidate_id: 3 } as never })}>Reserve</button>
}

function ConfirmProbe() {
  const mutation = useConfirmMatch()
  return <button type='button' onClick={() => mutation.mutate({ id: 4, payload: { candidate_id: 3 } as never })}>Confirm</button>
}

function RejectProbe() {
  const mutation = useRejectCandidate()
  return <button type='button' onClick={() => mutation.mutate({ id: 4, payload: { reason: 'nope' } as never })}>Reject</button>
}

function ReleaseReservationProbe() {
  const mutation = useReleaseReservation()
  return <button type='button' onClick={() => mutation.mutate(4)}>Release reservation</button>
}

function HoldProbe() {
  const mutation = useHoldBankTransaction()
  return <button type='button' onClick={() => mutation.mutate({ id: 4, payload: { reason_note: 'review' } as never })}>Hold</button>
}

function ReleaseHoldProbe() {
  const mutation = useReleaseHold()
  return <button type='button' onClick={() => mutation.mutate(4)}>Release hold</button>
}

function IgnoreProbe() {
  const mutation = useIgnoreBankTransaction()
  return <button type='button' onClick={() => mutation.mutate({ id: 4, payload: { reason_note: 'duplicate' } as never })}>Ignore</button>
}

function UnignoreProbe() {
  const mutation = useUnignoreBankTransaction()
  return <button type='button' onClick={() => mutation.mutate(4)}>Unignore</button>
}

function CreateFromRowProbe() {
  const mutation = useCreateFromBankRow()
  return <button type='button' onClick={() => mutation.mutate({ id: 4, payload: { mode: 'deposit' } as never })}>Create from row</button>
}

function ApproveMatchProbe() {
  const mutation = useApproveMatch()
  return <button type='button' onClick={() => mutation.mutate(4)}>Approve match</button>
}

function OverrideMatchProbe() {
  const mutation = useOverrideMatch()
  return <button type='button' onClick={() => mutation.mutate(4)}>Override match</button>
}

function expectInvalidatedBankTransactions(invalidateSpy: ReturnType<typeof vi.spyOn>) {
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bank-transactions'] })
}

describe('useBankTransactions', () => {
  it('requests transactions with array and scalar query params', async () => {
    let url = ''
    worker.use(http.get('/api/bank-transactions', ({ request }) => {
      url = request.url
      return HttpResponse.json({ items: [] })
    }))
    const screen = await renderWithProviders(<BankTransactionsProbe />)
    await expect.element(screen.getByText('0')).toBeVisible()
    await vi.waitFor(() => {
      expect(url).toContain('status=new%2Creview')
      expect(url).toContain('amount_min=10')
    })
  })

  it('does not fire when enabled is false', async () => {
    let requested = false
    worker.use(http.get('/api/bank-transactions', () => {
      requested = true
      return HttpResponse.json({ items: [] })
    }))
    const screen = await renderWithProviders(<BankTransactionsProbe enabled={false} />)
    await expect.element(screen.getByText('0')).toBeVisible()
    expect(requested).toBe(false)
  })
})

describe('useBankUploads', () => {
  it('fetches uploads list', async () => {
    worker.use(http.get('/api/bank-transactions/uploads', () => HttpResponse.json({ uploads: [{ id: 1 }] })))
    const screen = await renderWithProviders(<BankUploadsProbe />)
    await expect.element(screen.getByText('1')).toBeVisible()
  })

  it('does not fire when enabled is false', async () => {
    let requested = false
    worker.use(http.get('/api/bank-transactions/uploads', () => {
      requested = true
      return HttpResponse.json({ uploads: [] })
    }))
    const screen = await renderWithProviders(<BankUploadsProbe enabled={false} />)
    await expect.element(screen.getByText('0')).toBeVisible()
    expect(requested).toBe(false)
  })
})

describe('mutation hooks', () => {
  it('useImportBankTransactions posts and invalidates tx + uploads', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    worker.use(http.post('/api/bank-transactions/import', () => HttpResponse.json({ imported: 1 })))
    const screen = await renderWithProviders(<ImportProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Import' }).click()
    await vi.waitFor(() => {
      expectInvalidatedBankTransactions(invalidateSpy)
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bank-uploads'] })
    })
  })

  it('useReviewBankTransaction puts decision and invalidates tx + uploads', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let path = ''
    let body: unknown = null
    worker.use(http.put('/api/bank-transactions/:id/review', async ({ params, request }) => {
      path = `/api/bank-transactions/${params.id}/review`
      body = await request.json()
      return HttpResponse.json({ item: { id: 4 } })
    }))
    const screen = await renderWithProviders(<ReviewProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Review' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/bank-transactions/4/review')
      expect(body).toEqual({ decision: 'approve' })
      expectInvalidatedBankTransactions(invalidateSpy)
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['bank-uploads'] })
    })
  })

  it('useScanCandidates posts /scan and invalidates tx', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    let path = ''
    worker.use(http.post('/api/bank-transactions/:id/scan', ({ params }) => {
      path = `/api/bank-transactions/${params.id}/scan`
      return HttpResponse.json({ candidates: [] })
    }))
    const screen = await renderWithProviders(<ScanProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Scan' }).click()
    await vi.waitFor(() => {
      expect(path).toBe('/api/bank-transactions/4/scan')
      expectInvalidatedBankTransactions(invalidateSpy)
    })
  })

  it('useReserve posts /reserve and invalidates tx', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    worker.use(http.post('/api/bank-transactions/:id/reserve', () => HttpResponse.json({ item: { id: 4 } })))
    const screen = await renderWithProviders(<ReserveProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Reserve' }).click()
    await vi.waitFor(() => expectInvalidatedBankTransactions(invalidateSpy))
  })

  it('useConfirmMatch posts /confirm and invalidates tx', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    worker.use(http.post('/api/bank-transactions/:id/confirm', () => HttpResponse.json({ item: { id: 4 } })))
    const screen = await renderWithProviders(<ConfirmProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Confirm' }).click()
    await vi.waitFor(() => expectInvalidatedBankTransactions(invalidateSpy))
  })

  it('useRejectCandidate posts /reject and invalidates tx', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    worker.use(http.post('/api/bank-transactions/:id/reject', () => HttpResponse.json({ item: { id: 4 } })))
    const screen = await renderWithProviders(<RejectProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Reject' }).click()
    await vi.waitFor(() => expectInvalidatedBankTransactions(invalidateSpy))
  })

  it('useReleaseReservation posts /release and invalidates tx', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    worker.use(http.post('/api/bank-transactions/:id/release', () => HttpResponse.json({ item: { id: 4 } })))
    const screen = await renderWithProviders(<ReleaseReservationProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Release reservation' }).click()
    await vi.waitFor(() => expectInvalidatedBankTransactions(invalidateSpy))
  })

  it('useHoldBankTransaction posts /hold and invalidates tx', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    worker.use(http.post('/api/bank-transactions/:id/hold', () => HttpResponse.json({ item: { id: 4 } })))
    const screen = await renderWithProviders(<HoldProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Hold' }).click()
    await vi.waitFor(() => expectInvalidatedBankTransactions(invalidateSpy))
  })

  it('useReleaseHold posts /release-hold and invalidates tx', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    worker.use(http.post('/api/bank-transactions/:id/release-hold', () => HttpResponse.json({ item: { id: 4 } })))
    const screen = await renderWithProviders(<ReleaseHoldProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Release hold' }).click()
    await vi.waitFor(() => expectInvalidatedBankTransactions(invalidateSpy))
  })

  it('useIgnoreBankTransaction posts /ignore and invalidates tx', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    worker.use(http.post('/api/bank-transactions/:id/ignore', () => HttpResponse.json({ item: { id: 4 } })))
    const screen = await renderWithProviders(<IgnoreProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Ignore' }).click()
    await vi.waitFor(() => expectInvalidatedBankTransactions(invalidateSpy))
  })

  it('useUnignoreBankTransaction posts /unignore and invalidates tx', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    worker.use(http.post('/api/bank-transactions/:id/unignore', () => HttpResponse.json({ item: { id: 4 } })))
    const screen = await renderWithProviders(<UnignoreProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Unignore' }).click()
    await vi.waitFor(() => expectInvalidatedBankTransactions(invalidateSpy))
  })

  it('useCreateFromBankRow posts /create and invalidates tx', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    worker.use(http.post('/api/bank-transactions/:id/create', () => HttpResponse.json({ item: { id: 4 } })))
    const screen = await renderWithProviders(<CreateFromRowProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Create from row' }).click()
    await vi.waitFor(() => expectInvalidatedBankTransactions(invalidateSpy))
  })

  it('useApproveMatch posts /approve-match and invalidates tx', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    worker.use(http.post('/api/bank-transactions/:id/approve-match', () => HttpResponse.json({ item: { id: 4 } })))
    const screen = await renderWithProviders(<ApproveMatchProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Approve match' }).click()
    await vi.waitFor(() => expectInvalidatedBankTransactions(invalidateSpy))
  })

  it('useOverrideMatch posts /override-match and invalidates tx', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    worker.use(http.post('/api/bank-transactions/:id/override-match', () => HttpResponse.json({ item: { id: 4 } })))
    const screen = await renderWithProviders(<OverrideMatchProbe />, { queryClient })
    await screen.getByRole('button', { name: 'Override match' }).click()
    await vi.waitFor(() => expectInvalidatedBankTransactions(invalidateSpy))
  })
})
