import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';

import MultiSelectCombobox from '../MultiSelectCombobox';

const options = [
  { value: 101, label: 'Cash' },
  { value: 202, label: 'Donations' },
  { value: 303, label: 'Utilities' },
];

function MultiSelectHarness() {
  const [value, setValue] = useState<(string | number)[]>([]);

  return (
    <>
      <MultiSelectCombobox
        label='Accounts'
        value={value}
        onChange={setValue}
        options={options}
        placeholder='Search accounts'
      />
      <p>Count: {value.length}</p>
    </>
  );
}

describe('MultiSelectCombobox', () => {
  it('adds and removes selections by toggling options', async () => {
    const screen = await render(<MultiSelectHarness />);

    await userEvent.click(screen.getByText('Search accounts'));
    await userEvent.click(screen.getByText('Cash'));
    await expect.element(screen.getByText('Count: 1')).toBeVisible();

    await userEvent.click(screen.getByText('Cash'));
    await expect.element(screen.getByText('Count: 0')).toBeVisible();
  });

  it('supports keyboard selection from filtered results', async () => {
    const screen = await render(<MultiSelectHarness />);

    await userEvent.click(screen.getByText('Search accounts'));
    const input = screen.getByPlaceholder('Search accounts');
    await userEvent.fill(input, 'don');
    await userEvent.keyboard('{Enter}');

    await expect.element(screen.getByText('Count: 1')).toBeVisible();
  });
});
