import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth }       from './context/AuthContext';
import ProtectedRoute    from './components/ProtectedRoute';
import RoleGuard         from './components/RoleGuard';
import Layout            from './components/Layout';
import FullScreenSpinner from './components/FullScreenSpinner';

// Pages
import Login           from './pages/Login';
import Dashboard       from './pages/Dashboard';
import ChartOfAccounts from './pages/ChartOfAccounts';
import Funds           from './pages/Funds';
import Contacts        from './pages/Contacts';
import Bills           from './pages/Bills';
import Transactions    from './pages/Transactions';
import Reconciliation  from './pages/Reconciliation';
import Reports         from './pages/Reports';
import Settings        from './pages/Settings';
import UserManagement  from './pages/UserManagement';
import DepositEntry    from './pages/DepositEntry';
import ExpenseEntry    from './pages/ExpenseEntry';

function AppRoutes() {
  const { isInitialLoading } = useAuth();

  // Show spinner during the initial /api/auth/me check
  // Prevents flash of login page on refresh when already authenticated
  if (isInitialLoading) return <FullScreenSpinner />;

  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />

      {/* Root redirect */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Protected — all authenticated users */}
      <Route element={
        <ProtectedRoute>
          <Layout />
        </ProtectedRoute>
      }>
        <Route path="/dashboard"      element={<Dashboard />} />
        <Route path="/accounts"       element={<ChartOfAccounts />} />
        <Route path="/funds"          element={<Funds />} />
        <Route path="/contacts"       element={<Contacts />} />
        <Route path="/bills"          element={<Bills />} />
	<Route path="/transactions">
          <Route index element={<Transactions />} />
          <Route path="deposit" element={<DepositEntry />} />
          <Route path="expense" element={<ExpenseEntry />} />
        </Route>
        <Route path="/reconciliation" element={<Reconciliation />} />
        <Route path="/reports"        element={<Reports />} />

        {/* Admin only — non-admins hitting these routes see nothing */}
        <Route path="/settings" element={
          <RoleGuard roles={['admin']} fallback={<Navigate to="/dashboard" replace />}>
            <Settings />
          </RoleGuard>
        } />
        <Route path="/users" element={
          <RoleGuard roles={['admin']} fallback={<Navigate to="/dashboard" replace />}>
            <UserManagement />
          </RoleGuard>
        } />
      </Route>

      {/* 404 — catch all */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
