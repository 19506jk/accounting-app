import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../test/renderWithProviders';
import RoleGuard from '../RoleGuard';

describe('RoleGuard', () => {
  it('renders children for an allowed role', async () => {
    const screen = await renderWithProviders(
      <RoleGuard roles={['admin']}>
        <button>Approve receipt</button>
      </RoleGuard>,
      {
        auth: { id: 1, name: 'Admin', email: 'admin@example.com', role: 'admin', avatar_url: null },
      }
    );

    await expect.element(screen.getByRole('button', { name: 'Approve receipt' })).toBeVisible();
  });

  it('renders fallback for a disallowed role', async () => {
    const screen = await renderWithProviders(
      <RoleGuard roles={['admin']} fallback={<p>Not available</p>}>
        <button>Approve receipt</button>
      </RoleGuard>,
      {
        auth: { id: 2, name: 'Viewer', email: 'viewer@example.com', role: 'viewer', avatar_url: null },
      }
    );

    await expect.element(screen.getByText('Not available')).toBeVisible();
  });
});
