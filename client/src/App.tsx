import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth }       from './context/AuthContext';
import ProtectedRoute    from './components/ProtectedRoute';
import RoleGuard         from './components/RoleGuard';
import Layout            from './components/Layout';
import FullScreenSpinner from './components/FullScreenSpinner';

// Pages
const Login            = lazy(() => import('./pages/Login'));
const Dashboard        = lazy(() => import('./pages/Dashboard'));
const ChartOfAccounts  = lazy(() => import('./pages/ChartOfAccounts'));
const Contacts         = lazy(() => import('./pages/Contacts'));
const Bills            = lazy(() => import('./pages/Bills'));
const Transactions     = lazy(() => import('./pages/Transactions'));
const Reconciliation   = lazy(() => import('./pages/Reconciliation'));
const Reports          = lazy(() => import('./pages/Reports'));
const DonationReceipts = lazy(() => import('./pages/DonationReceipts'));
const Settings         = lazy(() => import('./pages/Settings'));
const UserManagement   = lazy(() => import('./pages/UserManagement'));
const AuditLog         = lazy(() => import('./pages/AuditLog'));
const DepositEntry     = lazy(() => import('./pages/DepositEntry'));
const ExpenseEntry     = lazy(() => import('./pages/ExpenseEntry'));
const BankFeed         = lazy(() => import('./pages/BankFeed'));

function AppRoutes() {
  const { isInitialLoading } = useAuth();

  // Show spinner during the initial /api/auth/me check
  // Prevents flash of login page on refresh when already authenticated
  if (isInitialLoading) return <FullScreenSpinner />;

  return (
    <Suspense fallback={<FullScreenSpinner />}>
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
          <Route path="/contacts"       element={<Contacts />} />
          <Route path="/bills"          element={<Bills />} />
          <Route path="/transactions">
            <Route index element={<Transactions />} />
            <Route path="deposit" element={<DepositEntry />} />
            <Route path="expense" element={<ExpenseEntry />} />
            <Route path="bank-feed" element={<BankFeed />} />
          </Route>
          <Route path="/reconciliation" element={<Reconciliation />} />
          <Route path="/reports"        element={<Reports />} />

          {/* Admin only — non-admins hitting these routes see nothing */}
          <Route path="/donation-receipts" element={
            <RoleGuard roles={['admin']} fallback={<Navigate to="/dashboard" replace />}>
              <DonationReceipts />
            </RoleGuard>
          } />
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
          <Route path="/audit-log" element={
            <RoleGuard roles={['admin']} fallback={<Navigate to="/dashboard" replace />}>
              <AuditLog />
            </RoleGuard>
          } />
        </Route>

        {/* 404 — catch all */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
