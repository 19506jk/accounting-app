import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';

import TemplateDropdown from '../TemplateDropdown';

describe('TemplateDropdown', () => {
  it('renders templates and fires selection callback', async () => {
    const onToggle = vi.fn();
    const onLoad = vi.fn();
    const onDelete = vi.fn();
    const templates = [{ id: 't1', name: 'Rent', rows: [{}] }];
    const screen = await render(
      <TemplateDropdown
        templates={templates}
        isOpen
        onToggle={onToggle}
        onLoad={onLoad}
        onDelete={onDelete}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Rent 1 row' }));
    expect(onLoad).toHaveBeenCalledWith(templates[0]);
  });

  it('fires delete callback', async () => {
    const onToggle = vi.fn();
    const onLoad = vi.fn();
    const onDelete = vi.fn();
    const screen = await render(
      <TemplateDropdown
        templates={[{ id: 't1', name: 'Rent', rows: [{}] }]}
        isOpen
        onToggle={onToggle}
        onLoad={onLoad}
        onDelete={onDelete}
      />
    );

    await userEvent.click(screen.getByTitle('Delete template'));
    expect(onDelete).toHaveBeenCalledWith('t1');
  });
});
