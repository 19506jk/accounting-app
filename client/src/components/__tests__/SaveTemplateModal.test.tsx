import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';

import SaveTemplateModal from '../SaveTemplateModal';

describe('SaveTemplateModal', () => {
  it('submits entered template name', async () => {
    const onSave = vi.fn(() => null);
    const onClose = vi.fn();
    const screen = await render(
      <SaveTemplateModal isOpen onClose={onClose} onSave={onSave} />
    );

    await userEvent.fill(screen.getByLabelText('Template Name'), ' Monthly Rent ');
    await userEvent.click(screen.getByRole('button', { name: 'Save Template' }));

    expect(onSave).toHaveBeenCalledWith(' Monthly Rent ');
  });

  it('calls onClose on cancel', async () => {
    const onSave = vi.fn(() => null);
    const onClose = vi.fn();
    const screen = await render(
      <SaveTemplateModal isOpen onClose={onClose} onSave={onSave} />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
