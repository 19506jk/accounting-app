import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';

import FullScreenSpinner from '../FullScreenSpinner';

describe('FullScreenSpinner', () => {
  it('renders the loading state', async () => {
    const screen = await render(<FullScreenSpinner />);

    await expect.element(screen.getByText('Loading…')).toBeVisible();
  });
});
