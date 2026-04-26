import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';

import Drawer from '../Drawer';

describe('Drawer', () => {
  it('closes on Escape', async () => {
    const onClose = vi.fn();
    const screen = await render(
      <Drawer isOpen onClose={onClose} title='Adjustments'>
        <button>Apply</button>
      </Drawer>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on overlay click', async () => {
    const onClose = vi.fn();
    const screen = await render(
      <Drawer isOpen onClose={onClose} title='Ledger detail' width='200px'>
        <p>Drawer body</p>
      </Drawer>
    );

    const overlay = screen.container.querySelector(
      'div[style*="z-index: 900"][style*="pointer-events: auto"]'
    ) as HTMLDivElement | null;
    expect(overlay).not.toBeNull();
    await userEvent.click(overlay!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
