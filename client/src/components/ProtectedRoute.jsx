import { Navigate } from 'react-router-dom';
import { useAuth }   from '../context/AuthContext';
import FullScreenSpinner from './FullScreenSpinner';

/**
 * ProtectedRoute
 *
 * Wraps any route that requires authentication.
 * Shows a full-screen spinner during the initial /api/auth/me check
 * to prevent flash of unauthenticated content.
 *
 * Usage:
 *   <Route element={<ProtectedRoute />}>
 *     <Route path="/dashboard" element={<Dashboard />} />
 *   </Route>
 */
export default function ProtectedRoute({ children }) {
  const { isAuthenticated, isInitialLoading } = useAuth();

  if (isInitialLoading)  return <FullScreenSpinner />;
  if (!isAuthenticated)  return <Navigate to="/login" replace />;

  return children;
}
