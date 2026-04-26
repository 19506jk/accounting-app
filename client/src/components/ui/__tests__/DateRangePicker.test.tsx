import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';

import DateRangePicker from '../DateRangePicker';

function DateRangeHarness() {
  const [range, setRange] = useState({ from: '2026-02-01', to: '2026-02-28' });

  return (
    <>
      <DateRangePicker from={range.from} to={range.to} onChange={setRange} />
      <p>Range: {range.from}{' -> '}{range.to}</p>
    </>
  );
}

describe('DateRangePicker', () => {
  it('applies preset date ranges', async () => {
    const screen = await render(<DateRangeHarness />);

    await userEvent.click(screen.getByRole('button', { name: 'This Month' }));
    await expect.element(screen.getByText(/Range: \d{4}-\d{2}-\d{2} -> \d{4}-\d{2}-\d{2}/)).toBeVisible();
  });

  it('propagates manual from/to edits', async () => {
    const screen = await render(<DateRangeHarness />);

    const dateInputs = screen.container.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBe(2);
    const [fromInput, toInput] = Array.from(dateInputs);
    if (!fromInput || !toInput) throw new Error('expected two date inputs');
    await userEvent.fill(fromInput, '2026-03-01');
    await userEvent.fill(toInput, '2026-03-31');

    await expect.element(screen.getByText('Range: 2026-03-01 -> 2026-03-31')).toBeVisible();
  });
});
