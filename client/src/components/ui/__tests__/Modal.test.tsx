import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';

import Modal from '../Modal';

function ModalHarness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)}>Open modal</button>
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title='New Bill'
      >
        <button>First</button>
        <button>Last</button>
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('renders only when open', async () => {
    const onClose = vi.fn();
    const screen = await render(
      <Modal isOpen={false} onClose={onClose} title='Hidden'>
        <p>Content</p>
      </Modal>
    );

    await expect.element(screen.getByText('Content')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    const screen = await render(
      <Modal isOpen onClose={onClose} title='Editor'>
        <button>Action</button>
      </Modal>
    );

    await userEvent.click(screen.getByRole('button', { name: 'Action' }));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps focus and toggles body scroll lock', async () => {
    const screen = await render(<ModalHarness />);

    await userEvent.click(screen.getByRole('button', { name: 'Open modal' }));
    expect(document.body.style.overflow).toBe('hidden');

    const first = screen.getByRole('button', { name: '×' });
    const last = screen.getByRole('button', { name: 'Last' });

    expect(document.activeElement?.textContent).toContain('×');
    await userEvent.click(last);
    await userEvent.tab();
    expect(document.activeElement?.textContent).toContain('×');

    await userEvent.click(first);
    expect(document.body.style.overflow).toBe('');
  });
});
