import { useAuth } from '../context/AuthContext';

/**
 * RoleGuard
 *
 * Renders children only if the current user has one of the required roles.
 * Used to hide sidebar links and action buttons — not just pages.
 * Unapproved users see nothing (no "Access Denied" message).
 *
 * Usage:
 *   <RoleGuard roles={['admin']}>
 *     <DeleteButton />
 *   </RoleGuard>
 *
 *   <RoleGuard roles={['admin', 'editor']}>
 *     <NewTransactionButton />
 *   </RoleGuard>
 */
export default function RoleGuard({ roles, children, fallback = null }) {
  const { user } = useAuth();

  if (!user) return fallback;
  if (!roles.includes(user.role)) return fallback;

  return children;
}
