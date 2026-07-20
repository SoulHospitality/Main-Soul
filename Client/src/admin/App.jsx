import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/layout/Layout';
import OwnerLayout from './components/layout/OwnerLayout';
import Dashboard from './pages/Dashboard';
import Units from './pages/Units';
import Reservations from './pages/Reservations';
import Payments from './pages/Payments';
import Finance from './pages/Finance';
import Profit from './pages/Profit';
import Expenses from './pages/Expenses';
import OwnerStatement from './pages/OwnerStatement';
import Reports from './pages/Reports';
import Users from './pages/Users';
import Profile from './pages/Profile';
import Schedule from './pages/Schedule';
import Pricing from './pages/Pricing';
import Utilities from './pages/Utilities';
import HR from './pages/HR';
import Recruitment from './pages/Recruitment';
import Tasks from './pages/Tasks';
import PettyCash from './pages/PettyCash';
import CashFlow from './pages/CashFlow';
import Treasury from './pages/Treasury';
import Housekeeping from './pages/Housekeeping';
import AuditLog from './pages/AuditLog';
import Projects from './pages/Projects';
import ChangePassword from './pages/ChangePassword';
import OwnerDashboard from './pages/OwnerDashboard';
import OwnerReservations from './pages/OwnerReservations';
import OwnerStatementPage, { OwnerPayoutsPage } from './pages/OwnerPortalPages';
import AcquisitionPipeline from './pages/AcquisitionPipeline';
import MaintenanceTickets from './pages/MaintenanceTickets';
import OwnerDateBlocks from './pages/OwnerDateBlocks';
import OwnerSettlementsAdmin from './pages/OwnerSettlementsAdmin';
import LoadingSpinner from './components/ui/LoadingSpinner';
import { canAccess, isOwnerRole } from './utils/permissions';
import { defaultAdminPage, ADMIN_LOGIN, ADMIN_CHANGE_PASSWORD } from './utils/adminRoutes';

function ProtectedRoute({ children, page, allowFirstLogin }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner /></div>;
  if (!user) return <Navigate to={ADMIN_LOGIN} replace />;

  if (user.is_first_login && !allowFirstLogin && page !== 'change-password') {
    return <Navigate to={ADMIN_CHANGE_PASSWORD} replace />;
  }

  if (page && !canAccess(user, page)) return <Navigate to={defaultAdminPage(user.role)} replace />;

  if (allowFirstLogin) return children;
  if (isOwnerRole(user)) return <OwnerLayout>{children}</OwnerLayout>;
  return <Layout>{children}</Layout>;
}

function RoleRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner /></div>;
  if (!user) return <Navigate to={ADMIN_LOGIN} replace />;
  if (user.is_first_login) return <Navigate to={ADMIN_CHANGE_PASSWORD} replace />;
  return <Navigate to={defaultAdminPage(user.role)} replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="login" element={<Navigate to={ADMIN_LOGIN} replace />} />
      <Route
        path="change-password"
        element={
          <ProtectedRoute page="change-password" allowFirstLogin>
            <ChangePassword />
          </ProtectedRoute>
        }
      />
      <Route path="dashboard" element={<ProtectedRoute page="dashboard"><Dashboard /></ProtectedRoute>} />
      <Route path="units" element={<ProtectedRoute page="units"><Units /></ProtectedRoute>} />
      <Route path="projects" element={<ProtectedRoute page="projects"><Projects /></ProtectedRoute>} />
      <Route path="reservations" element={<ProtectedRoute page="reservations"><Reservations /></ProtectedRoute>} />
      <Route path="schedule" element={<ProtectedRoute page="schedule"><Schedule /></ProtectedRoute>} />
      <Route path="pricing" element={<ProtectedRoute page="pricing"><Pricing /></ProtectedRoute>} />
      <Route path="utilities" element={<ProtectedRoute page="utilities"><Utilities /></ProtectedRoute>} />
      <Route path="payments" element={<ProtectedRoute page="payments"><Payments /></ProtectedRoute>} />
      <Route path="finance" element={<ProtectedRoute page="finance"><Finance /></ProtectedRoute>} />
      <Route path="profit" element={<ProtectedRoute page="profit"><Profit /></ProtectedRoute>} />
      <Route path="commissions" element={<Navigate to="/admin/finance" replace />} />
      <Route path="expenses" element={<ProtectedRoute page="expenses"><Expenses /></ProtectedRoute>} />
      <Route path="owner-statement" element={<ProtectedRoute page="owner_statement"><OwnerStatement /></ProtectedRoute>} />
      <Route path="owner-settlements" element={<ProtectedRoute page="owner_settlements"><OwnerSettlementsAdmin /></ProtectedRoute>} />
      <Route path="reports" element={<ProtectedRoute page="reports"><Reports /></ProtectedRoute>} />
      <Route path="hr" element={<ProtectedRoute page="hr"><HR /></ProtectedRoute>} />
      <Route path="recruitment" element={<ProtectedRoute page="recruitment"><Recruitment /></ProtectedRoute>} />
      <Route path="tasks" element={<ProtectedRoute page="tasks"><Tasks /></ProtectedRoute>} />
      <Route path="petty-cash" element={<ProtectedRoute page="petty_cash"><PettyCash /></ProtectedRoute>} />
      <Route path="cashflow" element={<ProtectedRoute page="cashflow"><CashFlow /></ProtectedRoute>} />
      <Route path="treasury" element={<ProtectedRoute page="cashflow"><Treasury /></ProtectedRoute>} />
      <Route path="housekeeping" element={<ProtectedRoute page="housekeeping"><Housekeeping /></ProtectedRoute>} />
      <Route path="audit" element={<ProtectedRoute page="audit"><AuditLog /></ProtectedRoute>} />
      <Route path="users" element={<ProtectedRoute page="users"><Users /></ProtectedRoute>} />
      <Route path="acquisition" element={<ProtectedRoute page="acquisition"><AcquisitionPipeline /></ProtectedRoute>} />
      <Route path="maintenance" element={<ProtectedRoute page="maintenance"><MaintenanceTickets /></ProtectedRoute>} />
      <Route path="owner" element={<ProtectedRoute page="owner"><OwnerDashboard /></ProtectedRoute>} />
      <Route path="owner/reservations" element={<ProtectedRoute page="owner_reservations"><OwnerReservations /></ProtectedRoute>} />
      <Route path="owner/statement" element={<ProtectedRoute page="owner_statement"><OwnerStatementPage /></ProtectedRoute>} />
      <Route path="owner/payouts" element={<ProtectedRoute page="owner_payouts"><OwnerPayoutsPage /></ProtectedRoute>} />
      <Route path="owner/blocks" element={<ProtectedRoute page="owner_blocks"><OwnerDateBlocks /></ProtectedRoute>} />
      <Route path="profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      <Route index element={<RoleRedirect />} />
      <Route path="*" element={<RoleRedirect />} />
    </Routes>
  );
}

export default function AdminApp() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
