import { describe, expect, it, vi } from 'vitest'
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
})
