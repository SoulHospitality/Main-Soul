import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/layout/Layout';
import OwnerLayout from './components/layout/OwnerLayout';
import LoadingSpinner from './components/ui/LoadingSpinner';
import { canAccess, isOwnerRole } from './utils/permissions';
import { defaultAdminPage, ADMIN_LOGIN, ADMIN_CHANGE_PASSWORD } from './utils/adminRoutes';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Units = lazy(() => import('./pages/Units'));
const UnitsForSale = lazy(() => import('./pages/UnitsForSale'));
const Reservations = lazy(() => import('./pages/Reservations'));
const Payments = lazy(() => import('./pages/Payments'));
const Finance = lazy(() => import('./pages/Finance'));
const Profit = lazy(() => import('./pages/Profit'));
const Expenses = lazy(() => import('./pages/Expenses'));
const OwnerStatement = lazy(() => import('./pages/OwnerStatement'));
const Reports = lazy(() => import('./pages/Reports'));
const Users = lazy(() => import('./pages/Users'));
const Profile = lazy(() => import('./pages/Profile'));
const Schedule = lazy(() => import('./pages/Schedule'));
const Pricing = lazy(() => import('./pages/Pricing'));
const Utilities = lazy(() => import('./pages/Utilities'));
const Tasks = lazy(() => import('./pages/Tasks'));
const PettyCash = lazy(() => import('./pages/PettyCash'));
const CashFlow = lazy(() => import('./pages/CashFlow'));
const Treasury = lazy(() => import('./pages/Treasury'));
const Housekeeping = lazy(() => import('./pages/Housekeeping'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const Projects = lazy(() => import('./pages/Projects'));
const ChangePassword = lazy(() => import('./pages/ChangePassword'));
const OwnerDashboard = lazy(() => import('./pages/OwnerDashboard'));
const OwnerReservations = lazy(() => import('./pages/OwnerReservations'));
const OwnerStatementPage = lazy(() =>
  import('./pages/OwnerPortalPages').then((m) => ({ default: m.default }))
);
const OwnerPayoutsPage = lazy(() =>
  import('./pages/OwnerPortalPages').then((m) => ({ default: m.OwnerPayoutsPage }))
);
const AcquisitionPipeline = lazy(() => import('./pages/AcquisitionPipeline'));
const ResaleSales = lazy(() => import('./pages/ResaleSales'));
const MaintenanceTickets = lazy(() => import('./pages/MaintenanceTickets'));
const OwnerDateBlocks = lazy(() => import('./pages/OwnerDateBlocks'));
const OwnerSettlementsAdmin = lazy(() => import('./pages/OwnerSettlementsAdmin'));

function PageFallback() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <LoadingSpinner />
    </div>
  );
}

function ProtectedRoute({ children, page, allowFirstLogin }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner /></div>;
  if (!user) return <Navigate to={ADMIN_LOGIN} replace />;

  if (user.is_first_login && !allowFirstLogin && page !== 'change-password') {
    return <Navigate to={ADMIN_CHANGE_PASSWORD} replace />;
  }

  if (page && !canAccess(user, page)) return <Navigate to={defaultAdminPage(user.role)} replace />;

  const body = <Suspense fallback={<PageFallback />}>{children}</Suspense>;
  if (allowFirstLogin) return body;
  if (isOwnerRole(user)) return <OwnerLayout>{body}</OwnerLayout>;
  return <Layout>{body}</Layout>;
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
      <Route path="units-for-sale" element={<ProtectedRoute page="units_sale"><UnitsForSale /></ProtectedRoute>} />
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
      <Route path="tasks" element={<ProtectedRoute page="tasks"><Tasks /></ProtectedRoute>} />
      <Route path="petty-cash" element={<ProtectedRoute page="petty_cash"><PettyCash /></ProtectedRoute>} />
      <Route path="cashflow" element={<ProtectedRoute page="cashflow"><CashFlow /></ProtectedRoute>} />
      <Route path="treasury" element={<ProtectedRoute page="cashflow"><Treasury /></ProtectedRoute>} />
      <Route path="housekeeping" element={<ProtectedRoute page="housekeeping"><Housekeeping /></ProtectedRoute>} />
      <Route path="audit" element={<ProtectedRoute page="audit"><AuditLog /></ProtectedRoute>} />
      <Route path="users" element={<ProtectedRoute page="users"><Users /></ProtectedRoute>} />
      <Route path="acquisition" element={<ProtectedRoute page="acquisition"><AcquisitionPipeline /></ProtectedRoute>} />
      <Route path="sales" element={<ProtectedRoute page="sales"><ResaleSales /></ProtectedRoute>} />
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
