import type React from 'react';
import type { Role } from '@shared/contracts';
import { useAuth } from '../context/AuthContext';

interface RoleGuardProps {
  roles: Role[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

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
export default function RoleGuard({ roles, children, fallback = null }: RoleGuardProps) {
  const { user } = useAuth();

  if (!user) return fallback;
  if (!roles.includes(user.role)) return fallback;

  return children;
}
