import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';

import Select from '../Select';

function ControlledSelect() {
  const [value, setValue] = useState('general');
  return (
    <Select
      label='Fund'
      value={value}
      onChange={(e) => setValue(e.target.value)}
      options={[
        { label: 'General', value: 'general' },
        { label: 'Missions', value: 'missions' },
      ]}
    />
  );
}

describe('Select', () => {
  it('renders options and propagates selection changes', async () => {
    const screen = await render(<ControlledSelect />);
    const select = screen.getByLabelText('Fund');

    expect(screen.container.querySelectorAll('option').length).toBe(2);
    await userEvent.selectOptions(select, 'missions');
    await expect.element(select).toHaveValue('missions');
  });
});
