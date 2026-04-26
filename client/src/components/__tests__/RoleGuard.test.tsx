import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import RoleGuard from '../RoleGuard';

const authState = vi.hoisted(() => ({
  user: null as { role: 'admin' | 'treasurer' | 'viewer' } | null,
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: authState.user,
  }),
}));

describe('RoleGuard', () => {
  it('renders children for an allowed role', async () => {
    authState.user = { role: 'admin' };

    const screen = await render(
      <RoleGuard roles={['admin']}>
        <button>Approve receipt</button>
      </RoleGuard>
    );

    await expect.element(screen.getByRole('button', { name: 'Approve receipt' })).toBeVisible();
  });

  it('renders fallback for a disallowed role', async () => {
    authState.user = { role: 'viewer' };

    const screen = await render(
      <RoleGuard roles={['admin']} fallback={<p>Not available</p>}>
        <button>Approve receipt</button>
      </RoleGuard>
    );

    await expect.element(screen.getByText('Not available')).toBeVisible();
  });
});
