import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { http, HttpResponse } from 'msw'

import { worker } from '../../../test/msw/browser'
import { renderWithProviders } from '../../../test/renderWithProviders'

import BankFeedReviewTab from '../BankFeedReviewTab'

describe('BankFeedReviewTab', () => {
  it('shows empty review queue state', async () => {
    const screen = renderWithProviders(
      <BankFeedReviewTab
        isActive={false}
        onReviewed={vi.fn()}
      />
    )

    await expect.element(screen.getByText('Needs Review (0)')).toBeVisible()
    await expect.element(screen.getByText('No items need review.')).toBeVisible()
  })

  it('submits review decision and calls onReviewed', async () => {
    const onReviewed = vi.fn()
    let reviewPath = ''
    let reviewBody: unknown = null

    worker.use(
      http.get('/api/bank-transactions', () => HttpResponse.json({
        items: [
          {
            id: 41,
            bank_posted_date: '2026-04-10',
            raw_description: 'INTERAC PAYMENT',
            amount: -55.5,
            conflict: {
              bank_posted_date: '2026-04-10',
              raw_description: 'PAYMENT DUPLICATE',
              amount: -55.5,
            },
          },
        ],
      })),
      http.put('/api/bank-transactions/:id/review', async ({ request, params }) => {
        reviewPath = `/api/bank-transactions/${params.id}/review`
        reviewBody = await request.json()
        return HttpResponse.json({ item: { id: 41 } })
      })
    )

    const screen = renderWithProviders(
      <BankFeedReviewTab
        isActive
        onReviewed={onReviewed}
      />
    )

    await expect.element(screen.getByText('Needs Review (1)')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm New' }))

    await vi.waitFor(() => {
      expect(reviewPath).toBe('/api/bank-transactions/41/review')
      expect(reviewBody).toEqual({ decision: 'confirmed_new' })
      expect(onReviewed).toHaveBeenCalledTimes(1)
      expect(screen.container.textContent || '').toContain('Review decision saved.')
    })
  })
})
