import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';

import Card from '../Card';

describe('Card', () => {
  it('renders children', async () => {
    const screen = await render(
      <Card>
        <h3>Quarterly Summary</h3>
      </Card>
    );

    await expect.element(screen.getByRole('heading', { name: 'Quarterly Summary' })).toBeVisible();
  });
});
