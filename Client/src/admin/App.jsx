import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
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
const WebsiteBookings = lazy(() => import('./pages/WebsiteBookings'));
const WebsiteBookingUnassignedPage = lazy(() => import('./pages/WebsiteBookingUnassignedPage'));
const WebsiteBookingHistoryPage = lazy(() => import('./pages/WebsiteBookingHistoryPage'));
const FinancialSystem = lazy(() => import('./pages/FinancialSystem'));
const Commissions = lazy(() => import('./pages/Commissions'));
const Users = lazy(() => import('./pages/Users'));
const Profile = lazy(() => import('./pages/Profile'));
const Schedule = lazy(() => import('./pages/Schedule'));
const Housekeeping = lazy(() => import('./pages/Housekeeping'));
const OpsCheckinsToday = lazy(() => import('./pages/OpsCheckinsToday'));
const OpsCheckinsHistory = lazy(() => import('./pages/OpsCheckinsHistory'));
const OpsCheckinComments = lazy(() => import('./pages/OpsCheckinComments'));
const HkTodayCleans = lazy(() => import('./pages/HkTodayCleans'));
const HkCleansHistory = lazy(() => import('./pages/HkCleansHistory'));
const Projects = lazy(() => import('./pages/Projects'));
const ChangePassword = lazy(() => import('./pages/ChangePassword'));
const OwnerDashboard = lazy(() => import('./pages/OwnerDashboard'));
const OwnerReservations = lazy(() => import('./pages/OwnerReservations'));
const OwnerStatement = lazy(() => import('./pages/OwnerStatement'));
const OwnerPayoutsPage = lazy(() =>
  import('./pages/OwnerPortalPages').then((m) => ({ default: m.OwnerPayoutsPage }))
);
const AcquisitionPipeline = lazy(() => import('./pages/AcquisitionPipeline'));
const ResaleSales = lazy(() => import('./pages/ResaleSales'));
const OwnerDateBlocks = lazy(() => import('./pages/OwnerDateBlocks'));
const PromoCodes = lazy(() => import('./pages/PromoCodes'));

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

/** Preserve query string when redirecting legacy finance URLs */
function LegacyFinanceRedirect({ tab }) {
  const location = useLocation();
  const qs = location.search || (tab ? `?tab=${tab}` : '');
  const suffix = qs.includes('tab=') ? qs : tab ? `?tab=${tab}${location.search ? `&${location.search.slice(1)}` : ''}` : location.search;
  return <Navigate to={`/admin/financial-system${suffix}`} replace />;
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
      <Route path="website-bookings" element={<ProtectedRoute page="website_bookings"><WebsiteBookings /></ProtectedRoute>} />
      <Route path="website-bookings/unassigned" element={<ProtectedRoute page="website_bookings"><WebsiteBookingUnassignedPage /></ProtectedRoute>} />
      <Route path="website-bookings/history" element={<ProtectedRoute page="website_bookings"><WebsiteBookingHistoryPage /></ProtectedRoute>} />
      <Route path="schedule" element={<ProtectedRoute page="schedule"><Schedule /></ProtectedRoute>} />

      {/* Unified financial system */}
      <Route path="financial-system" element={<ProtectedRoute page="financial_system"><FinancialSystem /></ProtectedRoute>} />

      {/* Legacy finance routes → unified workspace */}
      <Route path="finance" element={<LegacyFinanceRedirect tab="overview" />} />
      <Route path="profit" element={<LegacyFinanceRedirect tab="overview" />} />
      <Route path="reports" element={<LegacyFinanceRedirect tab="overview" />} />
      <Route path="expenses" element={<LegacyFinanceRedirect tab="manual" />} />
      <Route path="petty-cash" element={<LegacyFinanceRedirect tab="ledger" />} />
      <Route path="owner-settlements" element={<LegacyFinanceRedirect tab="owners" />} />
      <Route path="owner-statement" element={<LegacyFinanceRedirect tab="owners" />} />
      <Route path="utilities" element={<LegacyFinanceRedirect tab="ledger" />} />
      <Route path="marketing" element={<LegacyFinanceRedirect tab="ledger" />} />
      <Route path="salaries" element={<LegacyFinanceRedirect tab="ledger" />} />
      <Route path="invoices" element={<LegacyFinanceRedirect tab="overview" />} />
      <Route path="payouts" element={<LegacyFinanceRedirect tab="owners" />} />
      <Route path="billing" element={<LegacyFinanceRedirect tab="overview" />} />
      <Route path="transactions" element={<LegacyFinanceRedirect tab="ledger" />} />
      <Route path="treasury" element={<LegacyFinanceRedirect tab="ledger" />} />
      <Route path="cashflow" element={<LegacyFinanceRedirect tab="ledger" />} />

      <Route path="commissions" element={<ProtectedRoute page="commissions"><Commissions /></ProtectedRoute>} />
      <Route path="housekeeping" element={<ProtectedRoute page="housekeeping"><Housekeeping /></ProtectedRoute>} />
      <Route path="housekeeping/today" element={<ProtectedRoute page="hk_today"><HkTodayCleans /></ProtectedRoute>} />
      <Route path="housekeeping/history" element={<ProtectedRoute page="hk_today"><HkCleansHistory /></ProtectedRoute>} />
      <Route path="ops/checkins-today" element={<ProtectedRoute page="ops_checkins"><OpsCheckinsToday /></ProtectedRoute>} />
      <Route path="ops/checkins-history" element={<ProtectedRoute page="ops_checkins"><OpsCheckinsHistory /></ProtectedRoute>} />
      <Route path="ops/checkin-comments" element={<ProtectedRoute page="ops_comments"><OpsCheckinComments /></ProtectedRoute>} />
      <Route path="users" element={<ProtectedRoute page="users"><Users /></ProtectedRoute>} />
      <Route path="promo-codes" element={<ProtectedRoute page="promo_codes"><PromoCodes /></ProtectedRoute>} />
      <Route path="acquisition" element={<ProtectedRoute page="acquisition"><AcquisitionPipeline /></ProtectedRoute>} />
      <Route path="sales" element={<ProtectedRoute page="sales"><ResaleSales /></ProtectedRoute>} />
      <Route path="owner" element={<ProtectedRoute page="owner"><OwnerDashboard /></ProtectedRoute>} />
      <Route path="owner/reservations" element={<ProtectedRoute page="owner_reservations"><OwnerReservations /></ProtectedRoute>} />
      <Route path="owner/statement" element={<ProtectedRoute page="owner_statement"><OwnerStatement /></ProtectedRoute>} />
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
