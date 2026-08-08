import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { ROLE_LABELS, PMS_LABELS } from '../../utils/permissions';
import { getRoleTheme } from '../../utils/roleTheme';
import api from '../../api/axios';
import {
  LayoutDashboard, Building2, CalendarDays,
  BadgeDollarSign, Receipt, FileBarChart2, Users, UserCircle,
  LogOut, Building, CalendarRange, Wallet,
  TrendingUp, Sparkles, Briefcase, Globe, Tag, History, UserPlus,
} from 'lucide-react';

const NAV_ITEMS = [
  { path: '/admin/dashboard',        label: 'Dashboard',          icon: LayoutDashboard,   page: 'dashboard' },
  { path: '/admin/units',            label: 'Units (Rent)',       icon: Building2,          page: 'units' },
  { path: '/admin/units-for-sale',   label: 'Units for Sale',     icon: Building2,          page: 'units_sale', resaleLabel: 'Units' },
  { path: '/admin/projects',         label: 'Destinations',       icon: Building,           page: 'projects' },
  { path: '/admin/reservations',     label: 'Reservations',       icon: CalendarDays,       page: 'reservations', agentLabel: 'My Reservations' },
  { path: '/admin/website-bookings/unassigned', label: 'Website Unassigned', icon: UserPlus, page: 'website_bookings', badge: 'website_unassigned' },
  { path: '/admin/website-bookings', label: 'Website Requests',   icon: Globe,              page: 'website_bookings', badge: 'website_pending', end: true },
  { path: '/admin/website-bookings/history', label: 'Website History', icon: History,      page: 'website_bookings' },
  { path: '/admin/schedule',         label: 'Schedule',           icon: CalendarRange,      page: 'schedule' },
  { path: '/admin/finance',          label: 'Finance',            icon: BadgeDollarSign,    page: 'finance' },
  { path: '/admin/profit',           label: 'Profit',             icon: TrendingUp,         page: 'profit' },
  { path: '/admin/reports',          label: 'Reports',            icon: FileBarChart2,      page: 'reports' },
  { path: '/admin/commissions',      label: 'Commissions',        icon: BadgeDollarSign,    page: 'commissions', agentLabel: 'My Profit' },
  { path: '/admin/housekeeping',     label: 'Housekeeping',       icon: Sparkles,           page: 'housekeeping' },
  { path: '/admin/petty-cash',       label: 'Petty Cash',         icon: Wallet,             page: 'petty_cash' },
  { path: '/admin/expenses',         label: 'Expenses',           icon: Receipt,            page: 'expenses' },
  { path: '/admin/acquisition',      label: 'Owner leads',        icon: Briefcase,          page: 'acquisition', resaleLabel: 'Owners requests' },
  { path: '/admin/sales',            label: 'Sales',              icon: TrendingUp,         page: 'sales' },
  { path: '/admin/owner-settlements', label: 'Owner Settlements', icon: FileBarChart2, page: 'owner_settlements' },
  { path: '/admin/owner-statement',  label: 'Owner Statement',   icon: FileBarChart2, page: 'owner_settlements' },
  { path: '/admin/users',            label: 'User Management',    icon: Users,              page: 'users' },
  { path: '/admin/promo-codes',      label: 'Promo Codes',        icon: Tag,                page: 'promo_codes' },
];

function PendingCountBadge({ count, compact = false }) {
  if (!count || count < 1) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-[#25D366] text-white font-bold shadow-sm ${
        compact
          ? 'absolute -top-1.5 -right-1.5 min-w-[1.1rem] h-[1.1rem] px-0.5 text-[9px] leading-none'
          : 'min-w-[1.35rem] h-[1.35rem] px-1.5 text-[11px] leading-none ml-auto'
      }`}
      aria-label={`${count} pending website booking${count === 1 ? '' : 's'}`}
    >
      {label}
    </span>
  );
}

export default function Sidebar({ collapsed, isMobile, mobileOpen, onCloseMobile }) {
  const { user, logout } = useAuth();
  const { canAccess } = usePermissions();
  const navigate = useNavigate();
  const theme = getRoleTheme(user?.role);

  const showWebsitePending = canAccess('website_bookings');
  const { data: pendingBookings = [] } = useQuery({
    queryKey: ['website-bookings-pending'],
    queryFn: () =>
      api.get('/website-bookings', { params: { status: 'pending' } }).then((r) => r.data),
    enabled: showWebsitePending,
    refetchInterval: 30000,
  });
  const { data: unassignedBookings = [] } = useQuery({
    queryKey: ['website-bookings-unassigned'],
    queryFn: () =>
      api.get('/website-bookings', { params: { status: 'unassigned' } }).then((r) => r.data),
    enabled: showWebsitePending,
    refetchInterval: 30000,
  });
  const pendingWebsiteCount = Array.isArray(pendingBookings) ? pendingBookings.length : 0;
  const unassignedWebsiteCount = Array.isArray(unassignedBookings) ? unassignedBookings.length : 0;

  const handleLogout = () => { logout(); navigate('/sign-in'); };

  const showLabels = isMobile || !collapsed;
  const sidebarW = isMobile ? 288 : collapsed ? 64 : 256;

  const handleNavClick = () => {
    if (isMobile) onCloseMobile();
  };

  return (
    <aside
      className="pms-sidebar fixed top-0 left-0 h-full flex flex-col z-40"
      style={{
        width: sidebarW,
        transform: isMobile && !mobileOpen ? 'translateX(-100%)' : 'translateX(0)',
        transition: 'transform 0.3s ease, width 0.3s ease',
      }}
    >
      <div className="pms-sidebar-rail" aria-hidden />

      <div className={`flex items-center gap-3 px-4 py-5 border-b border-white/10 ${!showLabels ? 'justify-center' : ''}`}>
        <div
          className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
          style={{ background: 'var(--pms-accent)', boxShadow: '0 8px 24px var(--pms-nav-glow)' }}
        >
          <Building className="w-5 h-5 text-white" />
        </div>
        {showLabels && (
          <div className="min-w-0">
            <div className="text-white font-display text-lg leading-tight tracking-wide">Soul</div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-white/55 mt-0.5 truncate">
              {PMS_LABELS[user?.role] || 'Property Management'}
            </div>
          </div>
        )}
      </div>

      {showLabels && (
        <div className="px-4 pt-4 pb-1">
          <p className="text-[10px] uppercase tracking-[0.28em] text-white/40">{theme.eyebrow}</p>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {NAV_ITEMS.filter((item) => canAccess(item.page)).map((item) => {
          const label =
            user?.role === 'resale' && item.resaleLabel
              ? item.resaleLabel
              : item.agentLabel &&
                  (user?.role === 'reservations_web' ||
                    user?.role === 'reservations_manual' ||
                    user?.role === 'reservations')
                ? item.agentLabel
                : item.label;
          const pendingCount =
            item.badge === 'website_pending'
              ? pendingWebsiteCount
              : item.badge === 'website_unassigned'
                ? unassignedWebsiteCount
                : 0;
          return (
          <NavLink
            key={item.path}
            to={item.path}
            end={Boolean(item.end)}
            onClick={handleNavClick}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? 'sidebar-link-active' : 'sidebar-link-inactive'} ${!showLabels ? 'justify-center px-2' : ''}`
            }
            title={!showLabels ? (pendingCount ? `${label} (${pendingCount} pending)` : label) : undefined}
          >
            <span className="relative flex-shrink-0">
              <item.icon className="w-5 h-5" strokeWidth={1.75} />
              {!showLabels ? <PendingCountBadge count={pendingCount} compact /> : null}
            </span>
            {showLabels && <span className="truncate">{label}</span>}
            {showLabels ? <PendingCountBadge count={pendingCount} /> : null}
          </NavLink>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-3">
        <NavLink
          to="/admin/profile"
          onClick={handleNavClick}
          className={({ isActive }) =>
            `sidebar-link mb-1 ${isActive ? 'sidebar-link-active' : 'sidebar-link-inactive'} ${!showLabels ? 'justify-center px-2' : ''}`
          }
        >
          <UserCircle className="w-5 h-5 flex-shrink-0" strokeWidth={1.75} />
          {showLabels && <span>Profile</span>}
        </NavLink>

        {showLabels && (
          <div className="flex items-center gap-3 px-3 py-2.5 mb-1 rounded-xl bg-white/5">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
              style={{ background: 'var(--pms-avatar)' }}
            >
              {user?.full_name?.charAt(0)?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-white text-sm font-medium truncate">{user?.full_name}</div>
              <div className="text-white/50 text-xs truncate">
                {ROLE_LABELS[user?.role] || user?.role}
                {user?.staff_code ? ` · ${user.staff_code}` : ''}
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleLogout}
          className={`sidebar-link sidebar-link-inactive w-full text-red-200/90 hover:text-red-50 hover:bg-red-500/20 ${!showLabels ? 'justify-center px-2' : ''}`}
        >
          <LogOut className="w-5 h-5 flex-shrink-0" strokeWidth={1.75} />
          {showLabels && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
}
