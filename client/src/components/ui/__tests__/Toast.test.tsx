import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';

import { ToastProvider, useToast } from '../Toast';

function ToastHarness() {
  const { addToast } = useToast();

  return (
    <button onClick={() => addToast('Saved successfully')}>
      Show toast
    </button>
  );
}

describe('Toast', () => {
  it('renders and auto-dismisses toasts', async () => {
    vi.useFakeTimers();
    try {
      const screen = await render(
        <ToastProvider>
          <ToastHarness />
        </ToastProvider>
      );

      await userEvent.click(screen.getByRole('button', { name: 'Show toast' }));
      await expect.element(screen.getByText('Saved successfully')).toBeVisible();

      await vi.advanceTimersByTimeAsync(3500);
      await expect.element(screen.getByText('Saved successfully')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
