import { describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { DiagnosticsPanel, LineItem, Section } from '../ReportSections'

describe('ReportSections', () => {
  it('renders warning/info groups and investigate action', async () => {
    const onInvestigate = vi.fn()
    const screen = render(
      <DiagnosticsPanel
        diagnostics={[
          { code: 'W1', severity: 'warning', message: 'Mismatch', investigate_filters: { type: 'x' } },
          { code: 'I1', severity: 'info', message: 'FYI' },
        ] as never}
        onInvestigate={onInvestigate}
      />
    )

    await expect.element(screen.getByText('Warnings')).toBeVisible()
    await expect.element(screen.getByText('Notes')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Investigate' }))
    expect(onInvestigate).toHaveBeenCalledTimes(1)
  })

  it('renders Section and LineItem content', async () => {
    const screen = render(
      <Section title='Summary'>
        <LineItem label='Total' value='$100.00' bold />
      </Section>
    )

    await expect.element(screen.getByText('Summary')).toBeVisible()
    await expect.element(screen.getByText('Total')).toBeVisible()
    await expect.element(screen.getByText('$100.00')).toBeVisible()
  })
})
