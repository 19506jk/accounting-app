import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import ExpenseBreakdown from '../ExpenseBreakdown';

describe('ExpenseBreakdown', () => {
  const baseProps = {
    expenseAccountOptions: [{ value: 10, label: '5000 - Office Expense' }],
    taxRateOptions: [{ value: 2, label: 'GST (5.00%)' }],
    onChange: vi.fn(),
    onRemove: vi.fn(),
  };

  it('renders totals and tax hints', async () => {
    const screen = await render(
      <ExpenseBreakdown
        {...baseProps}
        showGrossColumn
        lines={[
          {
            id: '1',
            expense_account_id: 10,
            description: 'Paper',
            tax_rate_id: 2,
            amount: '100',
            rounding_adjustment: '0',
          },
        ]}
        lineTotals={[{ gross: 105, tax: 5, taxName: 'GST' }]}
      />
    );

    await expect.element(screen.getByText('GST: $5.00')).toBeVisible();
    await expect.element(screen.getByText('$105.00')).toBeVisible();
  });

  it('handles empty data without line actions', async () => {
    const screen = await render(
      <ExpenseBreakdown
        {...baseProps}
        lines={[]}
        lineTotals={[]}
      />
    );

    expect(screen.container.textContent || '').toContain('Account');
    expect(screen.container.textContent || '').not.toContain('Remove line');
  });
});
