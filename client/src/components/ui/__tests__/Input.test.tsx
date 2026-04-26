import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';

import Input from '../Input';

function ControlledInput() {
  const [value, setValue] = useState('');
  return (
    <Input
      label='Name'
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}

describe('Input', () => {
  it('supports controlled value updates', async () => {
    const screen = await render(<ControlledInput />);
    const input = screen.getByLabelText('Name');

    await input.fill('Finance Team');
    await expect.element(input).toHaveValue('Finance Team');
  });

  it('associates label and shows error message', async () => {
    const screen = await render(
      <Input
        id='invoice_no'
        label='Invoice'
        value=''
        onChange={() => {}}
        error='Invoice is required'
      />
    );

    await expect.element(screen.getByLabelText('Invoice')).toBeVisible();
    await expect.element(screen.getByText('Invoice is required')).toBeVisible();
  });
});
