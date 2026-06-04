import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { http, HttpResponse } from 'msw'

import { worker } from '../../../test/msw/browser'
import { renderWithProviders } from '../../../test/renderWithProviders'

import BankFeedMatchTab from '../BankFeedMatchTab'

describe('BankFeedMatchTab', () => {
  it('renders section headings and empty match queue state', async () => {
    const screen = await renderWithProviders(
      <BankFeedMatchTab isActive={false} />
    )

    await expect.element(screen.getByText('Pending Review (0)')).toBeVisible()
    await expect.element(screen.getByText('Create Queue (0)')).toBeVisible()
    await expect.element(screen.getByText('Match Queue (0)')).toBeVisible()
    await expect.element(screen.getByText('Held (0)')).toBeVisible()
    await expect.element(screen.getByText('Ignored (0)')).toBeVisible()
    await expect.element(screen.getByText('No open items to match.')).toBeVisible()
  })

  it('submits override and approve actions for pending-review system matches', async () => {
    const requestPaths: string[] = []

    worker.use(
      http.get('/api/bank-transactions', () => HttpResponse.json({
        items: [
          {
            id: 12,
            upload_id: 1,
            account_id: 1,
            fund_id: 1,
            row_index: 1,
            bank_transaction_id: 'BT-1',
            bank_posted_date: '2026-04-10',
            bank_effective_date: null,
            raw_description: 'AUTO MATCHED PAYMENT',
            sender_name: null,
            sender_email: null,
            bank_description_2: null,
            payment_method: null,
            normalized_description: 'AUTO MATCHED PAYMENT',
            amount: -75,
            status: 'matched_existing',
            journal_entry_id: null,
            reviewed_by: null,
            reviewed_at: null,
            review_decision: null,
            imported_at: '2026-04-10T00:00:00.000Z',
            last_modified_at: '2026-04-10T00:00:00.000Z',
            lifecycle_status: 'open',
            match_status: 'confirmed',
            creation_status: 'none',
            review_status: 'pending',
            match_source: 'system',
            creation_source: null,
            suggested_match_id: 300,
            matched_journal_entry_id: 300,
            disposition: 'none',
            create_proposal: null,
            create_proposal_rule_id: null,
            create_proposal_rule_name: null,
            create_proposal_created_at: null,
          },
        ],
      })),
      http.post('/api/bank-transactions/:id/override-match', ({ params }) => {
        requestPaths.push(`/api/bank-transactions/${params.id}/override-match`)
        return HttpResponse.json({ item: { id: 12 } })
      }),
      http.post('/api/bank-transactions/:id/approve-match', ({ params }) => {
        requestPaths.push(`/api/bank-transactions/${params.id}/approve-match`)
        return HttpResponse.json({ item: { id: 12 } })
      })
    )

    const screen = await renderWithProviders(
      <BankFeedMatchTab isActive />
    )

    await expect.element(screen.getByText('Pending Review (1)')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Override' }))
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await vi.waitFor(() => {
      expect(requestPaths).toContain('/api/bank-transactions/12/override-match')
      expect(requestPaths).toContain('/api/bank-transactions/12/approve-match')
      expect(screen.container.textContent || '').toContain('System match overridden and reset.')
      expect(screen.container.textContent || '').toContain('System match approved.')
    })
  })

  it('opens hold reason dialog from create queue and submits hold payload', async () => {
    let holdPath = ''
    let holdBody: unknown = null

    worker.use(
      http.get('/api/bank-transactions', () => HttpResponse.json({
        items: [
          {
            id: 22,
            upload_id: 1,
            account_id: 1,
            fund_id: 1,
            row_index: 2,
            bank_transaction_id: 'BT-22',
            bank_posted_date: '2026-04-11',
            bank_effective_date: null,
            raw_description: 'DONATION TO REVIEW',
            sender_name: null,
            sender_email: null,
            bank_description_2: null,
            payment_method: null,
            normalized_description: 'DONATION TO REVIEW',
            amount: 75,
            status: 'imported',
            journal_entry_id: null,
            reviewed_by: null,
            reviewed_at: null,
            review_decision: null,
            imported_at: '2026-04-11T00:00:00.000Z',
            last_modified_at: '2026-04-11T00:00:00.000Z',
            lifecycle_status: 'open',
            match_status: 'rejected',
            creation_status: 'none',
            review_status: 'pending',
            match_source: null,
            creation_source: null,
            suggested_match_id: null,
            matched_journal_entry_id: null,
            disposition: 'none',
            create_proposal: null,
            create_proposal_rule_id: null,
            create_proposal_rule_name: null,
            create_proposal_created_at: null,
          },
        ],
      })),
      http.post('/api/bank-transactions/:id/hold', async ({ request, params }) => {
        holdPath = `/api/bank-transactions/${params.id}/hold`
        holdBody = await request.json()
        return HttpResponse.json({ item: { id: 22 } })
      })
    )

    const screen = await renderWithProviders(
      <BankFeedMatchTab isActive />
    )

    await expect.element(screen.getByText('Create Queue (1)')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Hold' }))
    await expect.element(screen.getByRole('heading', { name: 'Move To Hold' })).toBeVisible()
    await userEvent.fill(screen.getByLabelText('Reason (optional)'), 'Waiting on receipts')
    await userEvent.click(screen.getByRole('button', { name: /^Move To Hold$/ }))

    await vi.waitFor(() => {
      expect(holdPath).toBe('/api/bank-transactions/22/hold')
      expect(holdBody).toEqual({ reason_note: 'Waiting on receipts' })
      expect(screen.container.textContent || '').toContain('Row moved to hold.')
    })
  })

  it('handles match queue actions and held/ignored restore flows', async () => {
    const requestPaths: string[] = []
    let reserveBody: unknown = null
    let confirmBody: unknown = null
    let rejectBody: unknown = null
    let ignoreBody: unknown = null

    worker.use(
      http.get('/api/bank-transactions', () => HttpResponse.json({
        items: [
          {
            id: 31,
            upload_id: 1,
            account_id: 1,
            fund_id: 1,
            row_index: 3,
            bank_transaction_id: 'BT-31',
            bank_posted_date: '2026-04-12',
            bank_effective_date: null,
            raw_description: 'MATCH CANDIDATE ROW',
            sender_name: null,
            sender_email: null,
            bank_description_2: null,
            payment_method: null,
            normalized_description: 'MATCH CANDIDATE ROW',
            amount: 40,
            status: 'imported',
            journal_entry_id: null,
            reviewed_by: null,
            reviewed_at: null,
            review_decision: null,
            imported_at: '2026-04-12T00:00:00.000Z',
            last_modified_at: '2026-04-12T00:00:00.000Z',
            lifecycle_status: 'open',
            match_status: 'none',
            creation_status: 'none',
            review_status: 'pending',
            match_source: null,
            creation_source: null,
            suggested_match_id: null,
            matched_journal_entry_id: null,
            disposition: 'none',
            create_proposal: null,
            create_proposal_rule_id: null,
            create_proposal_rule_name: null,
            create_proposal_created_at: null,
          },
          {
            id: 41,
            upload_id: 1,
            account_id: 1,
            fund_id: 1,
            row_index: 4,
            bank_transaction_id: 'BT-41',
            bank_posted_date: '2026-04-12',
            bank_effective_date: null,
            raw_description: 'HELD ROW',
            sender_name: null,
            sender_email: null,
            bank_description_2: null,
            payment_method: null,
            normalized_description: 'HELD ROW',
            amount: 22,
            status: 'imported',
            journal_entry_id: null,
            reviewed_by: null,
            reviewed_at: null,
            review_decision: null,
            imported_at: '2026-04-12T00:00:00.000Z',
            last_modified_at: '2026-04-12T00:00:00.000Z',
            lifecycle_status: 'open',
            match_status: 'none',
            creation_status: 'none',
            review_status: 'pending',
            match_source: null,
            creation_source: null,
            suggested_match_id: null,
            matched_journal_entry_id: null,
            disposition: 'hold',
            create_proposal: null,
            create_proposal_rule_id: null,
            create_proposal_rule_name: null,
            create_proposal_created_at: null,
          },
          {
            id: 51,
            upload_id: 1,
            account_id: 1,
            fund_id: 1,
            row_index: 5,
            bank_transaction_id: 'BT-51',
            bank_posted_date: '2026-04-12',
            bank_effective_date: null,
            raw_description: 'IGNORED ROW',
            sender_name: null,
            sender_email: null,
            bank_description_2: null,
            payment_method: null,
            normalized_description: 'IGNORED ROW',
            amount: 18,
            status: 'imported',
            journal_entry_id: null,
            reviewed_by: null,
            reviewed_at: null,
            review_decision: null,
            imported_at: '2026-04-12T00:00:00.000Z',
            last_modified_at: '2026-04-12T00:00:00.000Z',
            lifecycle_status: 'open',
            match_status: 'none',
            creation_status: 'none',
            review_status: 'pending',
            match_source: null,
            creation_source: null,
            suggested_match_id: null,
            matched_journal_entry_id: null,
            disposition: 'ignored',
            create_proposal: null,
            create_proposal_rule_id: null,
            create_proposal_rule_name: null,
            create_proposal_created_at: null,
          },
          {
            id: 61,
            upload_id: 1,
            account_id: 1,
            fund_id: 1,
            row_index: 6,
            bank_transaction_id: 'BT-61',
            bank_posted_date: '2026-04-12',
            bank_effective_date: null,
            raw_description: 'CREATE QUEUE ROW',
            sender_name: null,
            sender_email: null,
            bank_description_2: null,
            payment_method: null,
            normalized_description: 'CREATE QUEUE ROW',
            amount: 12,
            status: 'imported',
            journal_entry_id: null,
            reviewed_by: null,
            reviewed_at: null,
            review_decision: null,
            imported_at: '2026-04-12T00:00:00.000Z',
            last_modified_at: '2026-04-12T00:00:00.000Z',
            lifecycle_status: 'open',
            match_status: 'rejected',
            creation_status: 'none',
            review_status: 'pending',
            match_source: null,
            creation_source: null,
            suggested_match_id: null,
            matched_journal_entry_id: null,
            disposition: 'none',
            create_proposal: null,
            create_proposal_rule_id: null,
            create_proposal_rule_name: null,
            create_proposal_created_at: null,
          },
        ],
      })),
      http.post('/api/bank-transactions/31/scan', () => HttpResponse.json({
        auto_confirmed: null,
        candidates: [
          {
            journal_entry_id: 701,
            date: '2026-04-11',
            description: 'Candidate match',
            score_ref: 0.7,
            score_date: 0.9,
            score_desc: 0.8,
            score_total: 0.84,
          },
        ],
      })),
      http.post('/api/bank-transactions/31/reserve', async ({ request }) => {
        reserveBody = await request.json()
        requestPaths.push('/api/bank-transactions/31/reserve')
        return HttpResponse.json({ item: { id: 31 } })
      }),
      http.post('/api/bank-transactions/31/confirm', async ({ request }) => {
        confirmBody = await request.json()
        requestPaths.push('/api/bank-transactions/31/confirm')
        return HttpResponse.json({ item: { id: 31 } })
      }),
      http.post('/api/bank-transactions/31/reject', async ({ request }) => {
        rejectBody = await request.json()
        requestPaths.push('/api/bank-transactions/31/reject')
        return HttpResponse.json({ item: { id: 31 } })
      }),
      http.post('/api/bank-transactions/31/release', () => {
        requestPaths.push('/api/bank-transactions/31/release')
        return HttpResponse.json({ item: { id: 31 } })
      }),
      http.post('/api/bank-transactions/61/ignore', async ({ request }) => {
        ignoreBody = await request.json()
        requestPaths.push('/api/bank-transactions/61/ignore')
        return HttpResponse.json({ item: { id: 61 } })
      }),
      http.post('/api/bank-transactions/41/release-hold', () => {
        requestPaths.push('/api/bank-transactions/41/release-hold')
        return HttpResponse.json({ item: { id: 41 } })
      }),
      http.post('/api/bank-transactions/51/unignore', () => {
        requestPaths.push('/api/bank-transactions/51/unignore')
        return HttpResponse.json({ item: { id: 51 } })
      }),
      http.post('/api/transactions/import/bill-matches', () => HttpResponse.json({ suggestions: [] }))
    )

    const screen = await renderWithProviders(
      <BankFeedMatchTab isActive />
    )

    await expect.element(screen.getByText('Match Queue (1)')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Find Matches' }))
    await expect.element(screen.getByText('JE #701 • Score 0.84')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Reserve & Confirm' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await userEvent.click(screen.getByRole('button', { name: 'Release' }).first())
    await userEvent.click(screen.getByRole('button', { name: 'Ignore' }))
    await expect.element(screen.getByRole('heading', { name: 'Ignore Row' })).toBeVisible()
    await userEvent.fill(screen.getByLabelText('Reason (optional)'), 'Duplicate upload')
    await userEvent.click(screen.getByRole('button', { name: /^Ignore$/ }).nth(1))
    await userEvent.click(screen.getByRole('button', { name: 'Release' }).nth(1))
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }))

    await vi.waitFor(() => {
      expect(requestPaths).toContain('/api/bank-transactions/31/reserve')
      expect(requestPaths).toContain('/api/bank-transactions/31/confirm')
      expect(requestPaths).toContain('/api/bank-transactions/31/reject')
      expect(requestPaths).toContain('/api/bank-transactions/31/release')
      expect(requestPaths).toContain('/api/bank-transactions/61/ignore')
      expect(requestPaths).toContain('/api/bank-transactions/41/release-hold')
      expect(requestPaths).toContain('/api/bank-transactions/51/unignore')
      expect(reserveBody).toEqual({ journal_entry_id: 701 })
      expect(confirmBody).toEqual({ journal_entry_id: 701 })
      expect(rejectBody).toEqual({ journal_entry_id: 701 })
      expect(ignoreBody).toEqual({ reason_note: 'Duplicate upload' })
      expect(screen.container.textContent || '').toContain('Found 1 candidate(s).')
      expect(screen.container.textContent || '').toContain('Match confirmed.')
      expect(screen.container.textContent || '').toContain('Candidate rejected.')
      expect(screen.container.textContent || '').toContain('Reservation released.')
      expect(screen.container.textContent || '').toContain('Row ignored.')
      expect(screen.container.textContent || '').toContain('Hold released and row reset.')
      expect(screen.container.textContent || '').toContain('Ignored row restored.')
    })
  })

  it('renders auto-confirmed card from scan result and allows dismiss', async () => {
    worker.use(
      http.get('/api/bank-transactions', () => HttpResponse.json({
        items: [
          {
            id: 71,
            upload_id: 1,
            account_id: 1,
            fund_id: 1,
            row_index: 7,
            bank_transaction_id: 'BT-71',
            bank_posted_date: '2026-04-14',
            bank_effective_date: null,
            raw_description: 'AUTO CONFIRM',
            sender_name: null,
            sender_email: null,
            bank_description_2: null,
            payment_method: null,
            normalized_description: 'AUTO CONFIRM',
            amount: 99,
            status: 'imported',
            journal_entry_id: null,
            reviewed_by: null,
            reviewed_at: null,
            review_decision: null,
            imported_at: '2026-04-14T00:00:00.000Z',
            last_modified_at: '2026-04-14T00:00:00.000Z',
            lifecycle_status: 'open',
            match_status: 'none',
            creation_status: 'none',
            review_status: 'pending',
            match_source: null,
            creation_source: null,
            suggested_match_id: null,
            matched_journal_entry_id: null,
            disposition: 'none',
            create_proposal: null,
            create_proposal_rule_id: null,
            create_proposal_rule_name: null,
            create_proposal_created_at: null,
          },
        ],
      })),
      http.post('/api/bank-transactions/71/scan', () => HttpResponse.json({
        auto_confirmed: {
          journal_entry_id: 880,
          date: '2026-04-14',
          description: 'Matched entry',
          score_ref: 1,
          score_date: 1,
          score_desc: 0.9,
          score_total: 0.97,
        },
        candidates: [],
      })),
    )

    const screen = await renderWithProviders(<BankFeedMatchTab isActive />)
    await userEvent.click(screen.getByRole('button', { name: 'Find Matches' }))
    await expect.element(screen.getByText('Auto-confirmed match')).toBeVisible()
    await expect.element(screen.getByText('JE #880 • 2026-04-14')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await vi.waitFor(() => {
      expect(screen.container.textContent || '').not.toContain('Auto-confirmed match')
    })
  })

  it('shows no-match and scan error toasts for match queue scans', async () => {
    worker.use(
      http.get('/api/bank-transactions', () => HttpResponse.json({
        items: [
          {
            id: 81,
            upload_id: 1,
            account_id: 1,
            fund_id: 1,
            row_index: 8,
            bank_transaction_id: 'BT-81',
            bank_posted_date: '2026-04-14',
            bank_effective_date: null,
            raw_description: 'NO MATCH ROW',
            sender_name: null,
            sender_email: null,
            bank_description_2: null,
            payment_method: null,
            normalized_description: 'NO MATCH ROW',
            amount: 44,
            status: 'imported',
            journal_entry_id: null,
            reviewed_by: null,
            reviewed_at: null,
            review_decision: null,
            imported_at: '2026-04-14T00:00:00.000Z',
            last_modified_at: '2026-04-14T00:00:00.000Z',
            lifecycle_status: 'open',
            match_status: 'none',
            creation_status: 'none',
            review_status: 'pending',
            match_source: null,
            creation_source: null,
            suggested_match_id: null,
            matched_journal_entry_id: null,
            disposition: 'none',
            create_proposal: null,
            create_proposal_rule_id: null,
            create_proposal_rule_name: null,
            create_proposal_created_at: null,
          },
          {
            id: 82,
            upload_id: 1,
            account_id: 1,
            fund_id: 1,
            row_index: 9,
            bank_transaction_id: 'BT-82',
            bank_posted_date: '2026-04-14',
            bank_effective_date: null,
            raw_description: 'ERROR ROW',
            sender_name: null,
            sender_email: null,
            bank_description_2: null,
            payment_method: null,
            normalized_description: 'ERROR ROW',
            amount: 45,
            status: 'imported',
            journal_entry_id: null,
            reviewed_by: null,
            reviewed_at: null,
            review_decision: null,
            imported_at: '2026-04-14T00:00:00.000Z',
            last_modified_at: '2026-04-14T00:00:00.000Z',
            lifecycle_status: 'open',
            match_status: 'none',
            creation_status: 'none',
            review_status: 'pending',
            match_source: null,
            creation_source: null,
            suggested_match_id: null,
            matched_journal_entry_id: null,
            disposition: 'none',
            create_proposal: null,
            create_proposal_rule_id: null,
            create_proposal_rule_name: null,
            create_proposal_created_at: null,
          },
        ],
      })),
      http.post('/api/bank-transactions/81/scan', () => HttpResponse.json({
        auto_confirmed: null,
        candidates: [],
      })),
      http.post('/api/bank-transactions/82/scan', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    )

    const screen = await renderWithProviders(<BankFeedMatchTab isActive />)
    await userEvent.click(screen.getByRole('button', { name: 'Find Matches' }).first())
    await userEvent.click(screen.getByRole('button', { name: 'Find Matches' }).nth(1))

    await vi.waitFor(() => {
      expect(screen.container.textContent || '').toContain('No matches found. Moved to Create Queue.')
      expect(screen.container.textContent || '').toContain('boom')
    })
  })

  it('opens create-from-bank-row modal from create queue', async () => {
    worker.use(
      http.get('/api/bank-transactions', () => HttpResponse.json({
        items: [
          {
            id: 91,
            upload_id: 1,
            account_id: 1,
            fund_id: 1,
            row_index: 10,
            bank_transaction_id: 'BT-91',
            bank_posted_date: '2026-04-14',
            bank_effective_date: null,
            raw_description: 'CREATE MODAL ROW',
            sender_name: null,
            sender_email: null,
            bank_description_2: null,
            payment_method: null,
            normalized_description: 'CREATE MODAL ROW',
            amount: 12,
            status: 'imported',
            journal_entry_id: null,
            reviewed_by: null,
            reviewed_at: null,
            review_decision: null,
            imported_at: '2026-04-14T00:00:00.000Z',
            last_modified_at: '2026-04-14T00:00:00.000Z',
            lifecycle_status: 'open',
            match_status: 'rejected',
            creation_status: 'none',
            review_status: 'pending',
            match_source: null,
            creation_source: null,
            suggested_match_id: null,
            matched_journal_entry_id: null,
            disposition: 'none',
            create_proposal: null,
            create_proposal_rule_id: null,
            create_proposal_rule_name: null,
            create_proposal_created_at: null,
          },
        ],
      })),
      http.post('/api/transactions/import/bill-matches', () => HttpResponse.json({ suggestions: [] })),
    )

    const screen = await renderWithProviders(<BankFeedMatchTab isActive />)
    await userEvent.click(screen.getByRole('button', { name: 'Create New JE' }))
    await expect.element(screen.getByRole('heading', { name: 'Create Journal Entry - Bank Row #91' })).toBeVisible()
  })

  it('loads bill suggestions and submits pay-bill payload from create queue row', async () => {
    let createPath = ''
    let createBody: unknown = null

    worker.use(
      http.get('/api/bank-transactions', () => HttpResponse.json({
        items: [
          {
            id: 101,
            upload_id: 1,
            account_id: 14,
            fund_id: 1,
            row_index: 11,
            bank_transaction_id: 'BT-101',
            bank_posted_date: '2026-04-21',
            bank_effective_date: null,
            raw_description: 'BILL PAYMENT',
            sender_name: null,
            sender_email: null,
            bank_description_2: 'APRIL RUN',
            payment_method: null,
            normalized_description: 'BILL PAYMENT',
            amount: -82.5,
            status: 'imported',
            journal_entry_id: null,
            reviewed_by: null,
            reviewed_at: null,
            review_decision: null,
            imported_at: '2026-04-21T00:00:00.000Z',
            last_modified_at: '2026-04-21T00:00:00.000Z',
            lifecycle_status: 'open',
            match_status: 'rejected',
            creation_status: 'none',
            review_status: 'pending',
            match_source: null,
            creation_source: null,
            suggested_match_id: null,
            matched_journal_entry_id: null,
            disposition: 'none',
            create_proposal: null,
            create_proposal_rule_id: null,
            create_proposal_rule_name: null,
            create_proposal_created_at: null,
          },
        ],
      })),
      http.post('/api/transactions/import/bill-matches', async () => HttpResponse.json({
        suggestions: [
          {
            row_index: 101,
            bill_id: 2001,
            bill_number: 'B-2001',
            vendor_name: 'Northwind Supply',
            balance_due: 82.5,
            confidence: 'exact',
          },
        ],
      })),
      http.post('/api/bank-transactions/:id/create', async ({ params, request }) => {
        createPath = `/api/bank-transactions/${params.id}/create`
        createBody = await request.json()
        return HttpResponse.json({ item: { id: Number(params.id) } })
      }),
    )

    const screen = await renderWithProviders(<BankFeedMatchTab isActive />)
    await expect.element(screen.getByRole('button', { name: /Pay Exact Bill B-2001/i })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: /Pay Exact Bill B-2001/i }))

    await vi.waitFor(() => {
      expect(createPath).toBe('/api/bank-transactions/101/create')
      expect(createBody).toEqual({
        date: '2026-04-21',
        description: 'BILL PAYMENT — APRIL RUN',
        reference_no: 'BT-101',
        amount: 82.5,
        type: 'withdrawal',
        bill_id: 2001,
      })
      expect(screen.container.textContent || '').toContain('Bill payment created from bank row.')
    })
  })

  it('Scan All dispatches scans sequentially and disables per-row Find Matches while running', async () => {
    const scanOrder: number[] = []

    const baseTx = {
      upload_id: 1,
      account_id: 1,
      fund_id: 1,
      bank_effective_date: null,
      sender_name: null,
      sender_email: null,
      bank_description_2: null,
      payment_method: null,
      journal_entry_id: null,
      reviewed_by: null,
      reviewed_at: null,
      review_decision: null,
      lifecycle_status: 'open',
      match_status: 'none',
      creation_status: 'none',
      review_status: 'pending',
      match_source: null,
      creation_source: null,
      suggested_match_id: null,
      matched_journal_entry_id: null,
      disposition: 'none',
      create_proposal: null,
      create_proposal_rule_id: null,
      create_proposal_rule_name: null,
      create_proposal_created_at: null,
    }

    worker.use(
      http.get('/api/bank-transactions', () => HttpResponse.json({
        items: [
          {
            ...baseTx,
            id: 121,
            row_index: 1,
            bank_transaction_id: 'BT-121',
            bank_posted_date: '2026-04-20',
            raw_description: 'SCAN ALL ROW ONE',
            normalized_description: 'SCAN ALL ROW ONE',
            amount: 10,
            status: 'imported',
            imported_at: '2026-04-20T00:00:00.000Z',
            last_modified_at: '2026-04-20T00:00:00.000Z',
          },
          {
            ...baseTx,
            id: 122,
            row_index: 2,
            bank_transaction_id: 'BT-122',
            bank_posted_date: '2026-04-20',
            raw_description: 'SCAN ALL ROW TWO',
            normalized_description: 'SCAN ALL ROW TWO',
            amount: 20,
            status: 'imported',
            imported_at: '2026-04-20T00:00:00.000Z',
            last_modified_at: '2026-04-20T00:00:00.000Z',
          },
        ],
      })),
      http.post('/api/bank-transactions/121/scan', async () => {
        scanOrder.push(121)
        await new Promise((r) => setTimeout(r, 80))
        return HttpResponse.json({ auto_confirmed: null, candidates: [] })
      }),
      http.post('/api/bank-transactions/122/scan', () => {
        scanOrder.push(122)
        return HttpResponse.json({ auto_confirmed: null, candidates: [] })
      }),
    )

    const screen = await renderWithProviders(<BankFeedMatchTab isActive />)
    await expect.element(screen.getByText('Match Queue (2)')).toBeVisible()

    const scanAllButton = screen.getByRole('button', { name: 'Scan All' })
    await userEvent.click(scanAllButton)

    // While first scan is in flight: Scan All is loading and per-row buttons are locked out
    await expect.element(scanAllButton).toBeDisabled()
    const findMatchesButton = screen.getByRole('button', { name: 'Find Matches' })
    await expect.element(findMatchesButton.first()).toBeDisabled()
    await expect.element(findMatchesButton.nth(1)).toBeDisabled()

    // Both scans complete and fired in order (121 then 122)
    await vi.waitFor(() => {
      const text = screen.container.textContent || ''
      expect(scanOrder).toEqual([121, 122])
      expect(text).toContain('Scan complete: 2 rows scanned, 2 moved to Create Queue.')
      expect(text).not.toContain('No matches found. Moved to Create Queue.')
      expect(text).not.toContain('Failed to scan candidates.')
    }, { timeout: 3000 })
  })

  it('shows one summary toast after Scan All completes with mixed results', async () => {
    const baseTx = {
      upload_id: 1,
      account_id: 1,
      fund_id: 1,
      bank_effective_date: null,
      sender_name: null,
      sender_email: null,
      bank_description_2: null,
      payment_method: null,
      journal_entry_id: null,
      reviewed_by: null,
      reviewed_at: null,
      review_decision: null,
      lifecycle_status: 'open',
      match_status: 'none',
      creation_status: 'none',
      review_status: 'pending',
      match_source: null,
      creation_source: null,
      suggested_match_id: null,
      matched_journal_entry_id: null,
      disposition: 'none',
      create_proposal: null,
      create_proposal_rule_id: null,
      create_proposal_rule_name: null,
      create_proposal_created_at: null,
      status: 'imported',
      imported_at: '2026-04-20T00:00:00.000Z',
      last_modified_at: '2026-04-20T00:00:00.000Z',
    }

    worker.use(
      http.get('/api/bank-transactions', () => HttpResponse.json({
        items: [
          {
            ...baseTx,
            id: 131,
            row_index: 1,
            bank_transaction_id: 'BT-131',
            bank_posted_date: '2026-04-20',
            raw_description: 'SCAN NO MATCH',
            normalized_description: 'SCAN NO MATCH',
            amount: 10,
          },
          {
            ...baseTx,
            id: 132,
            row_index: 2,
            bank_transaction_id: 'BT-132',
            bank_posted_date: '2026-04-20',
            raw_description: 'SCAN CANDIDATE',
            normalized_description: 'SCAN CANDIDATE',
            amount: 20,
          },
          {
            ...baseTx,
            id: 133,
            row_index: 3,
            bank_transaction_id: 'BT-133',
            bank_posted_date: '2026-04-20',
            raw_description: 'SCAN AUTO',
            normalized_description: 'SCAN AUTO',
            amount: 30,
          },
          {
            ...baseTx,
            id: 134,
            row_index: 4,
            bank_transaction_id: 'BT-134',
            bank_posted_date: '2026-04-20',
            raw_description: 'SCAN ERROR',
            normalized_description: 'SCAN ERROR',
            amount: 40,
          },
        ],
      })),
      http.post('/api/bank-transactions/131/scan', () => HttpResponse.json({
        auto_confirmed: null,
        candidates: [],
      })),
      http.post('/api/bank-transactions/132/scan', () => HttpResponse.json({
        auto_confirmed: null,
        candidates: [
          {
            journal_entry_id: 932,
            transaction_id: 5002,
            date: '2026-04-19',
            description: 'Candidate from batch',
            reference_no: null,
            amount: 20,
            direction: 'credit',
            score_total: 0.88,
            score_ref: 0.5,
            score_date: 0.9,
            score_desc: 0.8,
            auto_confirm_eligible: false,
          },
        ],
      })),
      http.post('/api/bank-transactions/133/scan', () => HttpResponse.json({
        auto_confirmed: {
          journal_entry_id: 933,
          transaction_id: 5003,
          date: '2026-04-19',
          description: 'Auto confirmed from batch',
          reference_no: null,
          amount: 30,
          direction: 'credit',
          score_total: 0.98,
          score_ref: 1,
          score_date: 1,
          score_desc: 0.94,
          auto_confirm_eligible: true,
        },
        candidates: [],
      })),
      http.post('/api/bank-transactions/134/scan', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    )

    const screen = await renderWithProviders(<BankFeedMatchTab isActive />)
    await expect.element(screen.getByText('Match Queue (4)')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Scan All' }))

    await vi.waitFor(() => {
      const text = screen.container.textContent || ''
      expect(text).toContain('Scan complete: 4 rows scanned, 1 auto-confirmed, 1 with candidates, 1 moved to Create Queue, 1 failed.')
      expect(text).not.toContain('No matches found. Moved to Create Queue.')
      expect(text).not.toContain('Found 1 candidate(s).')
      expect(text).not.toContain('Failed to scan candidates.')
    })

    await expect.element(screen.getByText('Auto-confirmed match')).toBeVisible()
    await expect.element(screen.getByText('JE #932 • Score 0.88')).toBeVisible()
  })

  it('shows a per-row error toast when single-row Find Matches fails', async () => {
    worker.use(
      http.get('/api/bank-transactions', () => HttpResponse.json({
        items: [
          {
            id: 141,
            upload_id: 1,
            account_id: 1,
            fund_id: 1,
            row_index: 5,
            bank_transaction_id: 'BT-141',
            bank_posted_date: '2026-04-21',
            bank_effective_date: null,
            raw_description: 'SINGLE ROW ERROR',
            sender_name: null,
            sender_email: null,
            bank_description_2: null,
            payment_method: null,
            normalized_description: 'SINGLE ROW ERROR',
            amount: 55,
            status: 'imported',
            journal_entry_id: null,
            reviewed_by: null,
            reviewed_at: null,
            review_decision: null,
            imported_at: '2026-04-21T00:00:00.000Z',
            last_modified_at: '2026-04-21T00:00:00.000Z',
            lifecycle_status: 'open',
            match_status: 'none',
            creation_status: 'none',
            review_status: 'pending',
            match_source: null,
            creation_source: null,
            suggested_match_id: null,
            matched_journal_entry_id: null,
            disposition: 'none',
            create_proposal: null,
            create_proposal_rule_id: null,
            create_proposal_rule_name: null,
            create_proposal_created_at: null,
          },
        ],
      })),
      http.post('/api/bank-transactions/141/scan', () => HttpResponse.json({ error: 'single row boom' }, { status: 500 })),
    )

    const screen = await renderWithProviders(<BankFeedMatchTab isActive />)
    await expect.element(screen.getByText('Match Queue (1)')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Find Matches' }))

    await vi.waitFor(() => {
      const text = screen.container.textContent || ''
      expect(text).toContain('single row boom')
      expect(text).not.toContain('Scan complete:')
    })
  })

  it('shows a toast when bill suggestion loading fails for create queue rows', async () => {
    worker.use(
      http.get('/api/bank-transactions', () => HttpResponse.json({
        items: [
          {
            id: 111,
            upload_id: 1,
            account_id: 19,
            fund_id: 1,
            row_index: 12,
            bank_transaction_id: 'BT-111',
            bank_posted_date: '2026-04-22',
            bank_effective_date: null,
            raw_description: 'FAILED MATCH LOOKUP',
            sender_name: null,
            sender_email: null,
            bank_description_2: null,
            payment_method: null,
            normalized_description: 'FAILED MATCH LOOKUP',
            amount: -12,
            status: 'imported',
            journal_entry_id: null,
            reviewed_by: null,
            reviewed_at: null,
            review_decision: null,
            imported_at: '2026-04-22T00:00:00.000Z',
            last_modified_at: '2026-04-22T00:00:00.000Z',
            lifecycle_status: 'open',
            match_status: 'rejected',
            creation_status: 'none',
            review_status: 'pending',
            match_source: null,
            creation_source: null,
            suggested_match_id: null,
            matched_journal_entry_id: null,
            disposition: 'none',
            create_proposal: null,
            create_proposal_rule_id: null,
            create_proposal_rule_name: null,
            create_proposal_created_at: null,
          },
        ],
      })),
      http.post('/api/transactions/import/bill-matches', () => HttpResponse.json(
        { error: 'suggestion lookup failed' },
        { status: 500 },
      )),
    )

    const screen = await renderWithProviders(<BankFeedMatchTab isActive />)
    await vi.waitFor(() => {
      expect(screen.container.textContent || '').toContain('suggestion lookup failed')
    })
  })
})
