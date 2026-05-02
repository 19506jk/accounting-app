import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../../test/renderWithProviders'

import BankFeedImportTab from '../BankFeedImportTab'

describe('BankFeedImportTab', () => {
  it('renders import action disabled before parsing rows', async () => {
    const screen = renderWithProviders(
      <BankFeedImportTab
        isActive={false}
        bankAccountOptions={[{ value: 1, label: '1000 - Chequing' }]}
        fundOptions={[{ value: 1, label: 'General' }]}
        postImportNeedsReview={0}
        setPostImportNeedsReview={vi.fn()}
      />
    )

    await expect.element(screen.getByText('No rows parsed yet')).toBeVisible()
    await expect.element(screen.getByRole('button', { name: 'Confirm Import' })).toBeDisabled()
  })
})
