import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../../../test/renderWithProviders'

import BankFeedMatchTab from '../BankFeedMatchTab'

describe('BankFeedMatchTab', () => {
  it('renders section headings and empty match queue state', async () => {
    const screen = renderWithProviders(
      <BankFeedMatchTab isActive={false} />
    )

    await expect.element(screen.getByText('Pending Review (0)')).toBeVisible()
    await expect.element(screen.getByText('Create Queue (0)')).toBeVisible()
    await expect.element(screen.getByText('Match Queue (0)')).toBeVisible()
    await expect.element(screen.getByText('Held (0)')).toBeVisible()
    await expect.element(screen.getByText('Ignored (0)')).toBeVisible()
    await expect.element(screen.getByText('No open items to match.')).toBeVisible()
  })
})
