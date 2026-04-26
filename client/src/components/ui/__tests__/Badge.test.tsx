import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';

import Badge from '../Badge';

describe('Badge', () => {
  it('renders label text', async () => {
    const screen = await render(<Badge label='active' />);

    await expect.element(screen.getByText('active')).toBeVisible();
  });

  it('supports explicit variant styles', async () => {
    const screen = await render(
      <>
        <Badge label='ok' variant='success' />
        <Badge label='warn' variant='warning' />
      </>
    );

    await expect.element(screen.getByText('ok')).toHaveStyle({ background: 'rgb(220, 252, 231)' });
    await expect.element(screen.getByText('warn')).toHaveStyle({ background: 'rgb(254, 249, 195)' });
  });
});
