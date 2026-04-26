import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';

import Button from '../Button';

describe('Button', () => {
  it('renders children', async () => {
    const screen = await render(<Button>Save</Button>);

    await expect.element(screen.getByRole('button', { name: 'Save' })).toBeVisible();
  });

  it('applies different styles for variant and size', async () => {
    const screen = await render(
      <>
        <Button variant='primary' size='md'>Primary</Button>
        <Button variant='danger' size='sm'>Danger</Button>
      </>
    );

    await expect.element(screen.getByRole('button', { name: 'Primary' }))
      .toHaveStyle({ background: 'rgb(37, 99, 235)' });
    await expect.element(screen.getByRole('button', { name: 'Danger' }))
      .toHaveStyle({ background: 'rgb(220, 38, 38)' });
    await expect.element(screen.getByRole('button', { name: 'Danger' }))
      .toHaveAttribute('style', expect.stringContaining('padding: 0.35rem 0.75rem'));
  });

  it('disables when loading and does not fire click', async () => {
    const onClick = vi.fn();
    const screen = await render(
      <Button isLoading onClick={onClick}>
        Submit
      </Button>
    );

    const button = screen.getByRole('button', { name: 'Submit' });
    await expect.element(button).toBeDisabled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('fires click when enabled', async () => {
    const onClick = vi.fn();
    const screen = await render(<Button onClick={onClick}>Create</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
