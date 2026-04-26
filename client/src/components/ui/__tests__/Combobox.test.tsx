import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';

import Combobox from '../Combobox';

const options = [
  { value: 'apple', label: 'Apple' },
  { value: 'apricot', label: 'Apricot' },
  { value: 'banana', label: 'Banana' },
];

function ComboboxHarness() {
  const [value, setValue] = useState<string | null>(null);

  return (
    <>
      <Combobox
        label='Fruit'
        value={value}
        onChange={(next) => setValue(String(next))}
        options={options}
        placeholder='Pick a fruit'
      />
      <button onClick={() => setValue(null)}>Clear</button>
      <p>Selected: {value ?? 'none'}</p>
    </>
  );
}

describe('Combobox', () => {
  it('filters by typed text and selects with keyboard', async () => {
    const screen = await render(<ComboboxHarness />);

    await userEvent.click(screen.getByText('Pick a fruit'));
    const input = screen.getByPlaceholder('Pick a fruit');
    await userEvent.fill(input, 'ap');

    await expect.element(screen.getByText('Apple')).toBeVisible();
    await expect.element(screen.getByText('Apricot')).toBeVisible();
    await expect.element(screen.getByText('Banana')).not.toBeInTheDocument();

    await userEvent.keyboard('{Enter}');
    await expect.element(screen.getByText('Selected: apple')).toBeVisible();
  });

  it('clears back to placeholder state', async () => {
    const screen = await render(<ComboboxHarness />);

    await userEvent.click(screen.getByText('Pick a fruit'));
    await userEvent.click(screen.getByText('Banana'));
    await expect.element(screen.getByText('Selected: banana')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await expect.element(screen.getByText('Selected: none')).toBeVisible();
    await expect.element(screen.getByText('Pick a fruit')).toBeVisible();
  });
});
