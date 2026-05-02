import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';

import SummaryBar from '../SummaryBar';

describe('SummaryBar', () => {
  it('renders totals and difference formatting', async () => {
    const screen = await render(
      <SummaryBar
        totalDebit={200}
        totalCredit={150}
      />
    );

    await expect.element(screen.getByText('Debits:')).toBeVisible();
    await expect.element(screen.getByText('$200.00')).toBeVisible();
    await expect.element(screen.getByText('Credits:')).toBeVisible();
    await expect.element(screen.getByText('$150.00')).toBeVisible();
    expect(screen.container.textContent).toContain('Difference: $50.00');
  });

  it('renders fund status chips', async () => {
    const screen = await render(
      <SummaryBar
        totalDebit={100}
        totalCredit={100}
        fundStatuses={[
          { name: 'General', balanced: true, debit: 100, credit: 100 },
          { name: 'Missions', balanced: false, debit: 25, credit: 10 },
        ]}
      />
    );

    await expect.element(screen.getByText('✓ General')).toBeVisible();
    await expect.element(screen.getByText('✗ Missions ($15.00 off)')).toBeVisible();
  });
});
