import { customPageAccess } from '../../utils/pageCatalog';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { ROLE_LABELS, PMS_LABELS, canSeeRequestQueue } from '../../utils/permissions';
import { Fragment } from 'react';
import { useRequestCounts, REQUEST_CATEGORIES } from '../../hooks/useRequestCounts';
import { getRoleTheme } from '../../utils/roleTheme';
import api from '../../api/axios';
import {
  LayoutDashboard, Building2, CalendarDays,
  BadgeDollarSign, Users, UserCircle,
  LogOut, Building, CalendarRange,
  Briefcase, Globe, Tag, KeyRound,
  Link2,
  Landmark,
  Wallet,
  MinusCircle,
  Inbox,
  ClipboardList,
  Clock,
  ShieldCheck,
  Receipt,
  FileBarChart2,
  Trophy,
  ListTodo,
  Gauge,
  MessageSquareText,
  ShieldAlert,
  Target,
  BarChart3,
  Sliders,
  Fingerprint,
  Bot,
} from 'lucide-react';

export const NAV_SECTIONS = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      { path: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard, page: 'dashboard' },
      { path: '/admin/clock', label: 'Clock in', adminLabel: 'Clock-ins', icon: Fingerprint, page: 'clock_in' },
      { path: '/admin/kpi', label: 'KPI', icon: Target, page: 'kpi' },
      { path: '/admin/audit', label: 'Audit Log', icon: ClipboardList, page: 'audit_log' },
      { path: '/admin/tasks', label: 'Tasks', icon: ListTodo, page: 'tasks', excludeRoles: ['hr', 'hr_supervisor'] },
      { path: '/admin/website-performance', label: 'Website Performance', icon: Gauge, page: 'site_performance' },
      { path: '/admin/website', label: 'Website', icon: Globe, page: 'website' },
    ],
  },
  {
    id: 'crm',
    label: 'Inbox & CRM',
    items: [
      { path: '/admin/inbox', label: 'Live Inbox', icon: MessageSquareText, page: 'inbox', badge: 'inbox_needs_reply' },
      { path: '/admin/leads', label: 'Leads & Pipeline', icon: Target, page: 'leads' },
      { path: '/admin/inbox-analytics', label: 'Inbox Analytics', icon: BarChart3, page: 'inbox_analytics' },
      { path: '/admin/inbox-settings', label: 'Inbox Settings', icon: Sliders, page: 'inbox_settings' },
      // Test stage: CEO only until it goes live on Instagram and Messenger.
      { path: '/admin/chatbot', label: 'Chatbot (test)', icon: Bot, page: 'chatbot_test', roles: ['admin'] },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    items: [
      { path: '/admin/units', label: 'Units (Short Term)', icon: Building2, page: 'units' },
      { path: '/admin/units-long-term', label: 'Units (Long Term)', icon: Building2, page: 'units_long_term' },
      { path: '/admin/projects', label: 'Destinations', icon: Building, page: 'projects' },
      { path: '/admin/acquisition', label: 'Owner leads', icon: Briefcase, page: 'acquisition' },
      { path: '/admin/owner-statement', label: 'Owner Statement', icon: FileBarChart2, page: 'owner_statement' },
      { path: '/admin/owner/blocks', label: 'Owner blocks', icon: CalendarDays, page: 'owner_blocks', roles: ['owners_relations'] },
      { path: '/admin/users', label: 'Owners', icon: UserCircle, page: 'owners', roles: ['unit_acquisition_manager'] },
      { path: '/admin/owner-comments', label: 'Owner comments', icon: MessageSquareText, page: 'owner_comments', badge: 'owner_comments_unread' },
      { path: '/admin/damage-reports', label: 'Damage reports', icon: ShieldAlert, page: 'damage_reports', roles: ['owners_relations'] },
    ],
  },
  {
    id: 'bookings',
    label: 'Bookings',
    items: [
      { path: '/admin/reservations', label: 'Reservations', icon: CalendarDays, page: 'reservations', agentLabel: 'My Reservations', managerLabel: 'Team Reservations' },
      { path: '/admin/website-bookings', label: 'Website Requests', icon: Globe, page: 'website_bookings', badge: 'website_pending' },
      { path: '/admin/schedule', label: 'Schedule', icon: CalendarRange, page: 'schedule' },
      { path: '/admin/calendar-sync', label: 'Calendar Sync', icon: Link2, page: 'calendar_sync' },
      { path: '/admin/performance', label: 'Performance', icon: Trophy, page: 'performance' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { path: '/admin/operations', label: 'Operations', icon: KeyRound, page: 'operations' },
      { path: '/admin/petty-cash', label: 'Petty Cash', icon: Wallet, page: 'petty_cash', roles: ['operations_supervisor'] },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [
      { path: '/admin/financial-system', label: 'Financial System', icon: Landmark, page: 'financial_system' },
      { path: '/admin/reports', label: 'Reports', icon: FileBarChart2, page: 'reports', roles: ['admin'] },
      { path: '/admin/commissions', label: 'Commissions', icon: BadgeDollarSign, page: 'commissions', agentLabel: 'My Profit', managerLabel: 'Team profit' },
      { path: '/admin/promo-codes', label: 'Promo Codes', icon: Tag, page: 'promo_codes' },
    ],
  },
  {
    id: 'hr',
    label: 'HR',
    items: [
      { path: '/admin/users', label: 'User Management', icon: Users, page: 'users' },
      { path: '/admin/attendance', label: 'Attendance', icon: Clock, page: 'attendance' },
      { path: '/admin/requests', label: 'Requests', icon: Inbox, page: 'requests', badge: 'requests_pending', agentLabel: 'My requests' },
      { path: '/admin/holiday-access', label: 'Holidays access', icon: ShieldCheck, page: 'holiday_access' },
      { path: '/admin/tasks', label: 'Tasks', icon: ListTodo, page: 'tasks', roles: ['hr', 'hr_supervisor'] },
      { path: '/admin/deductions', label: 'Deductions/Bonus', icon: MinusCircle, page: 'deductions' },
      { path: '/admin/hr-rules', label: 'HR rules', icon: Sliders, page: 'hr_rules' },
      { path: '/admin/payslip', label: 'Payslip', icon: Receipt, page: 'payslip', excludeRoles: ['admin'] },
      { path: '/admin/payroll', label: 'Payrolls', icon: Wallet, page: 'payroll' },
      { path: '/admin/job-offers', label: 'Job offers', icon: ClipboardList, page: 'job_offers', badge: 'job_pending' },
    ],
  },
];

export function visibleNavSections(canAccess, role, customAccess = false) {
  // With per-user page access the page list decides, not the role; each link is shown once.
  const seen = new Set();
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (!canAccess(item.page)) return false;
      if (item.excludeRoles && item.excludeRoles.includes(role)) return false;
      if (!customAccess) return !item.roles || item.roles.includes(role);
      if (seen.has(item.path)) return false;
      seen.add(item.path);
      return true;
    }),
  })).filter((section) => section.items.length);
}

function PendingCountBadge({ count, compact = false }) {
  if (!count || count < 1) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full text-white font-bold shadow-sm ${
        compact
          ? 'absolute -top-1.5 -right-1.5 min-w-[1.1rem] h-[1.1rem] px-0.5 text-[9px] leading-none'
          : 'min-w-[1.35rem] h-[1.35rem] px-1.5 text-[11px] leading-none ml-auto'
      }`}
      style={{ background: 'var(--pms-accent, #F28C28)' }}
      aria-label={`${count} waiting`}
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
  const showReviewPending = canSeeRequestQueue(user);
  const showJobPending = canAccess('job_offers');
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
  const websiteNeedsReviewCount = pendingWebsiteCount + unassignedWebsiteCount;
  // Live: goes up when a request arrives and down when it's approved or rejected (socket + polling).
  const requestCounts = useRequestCounts(user, canAccess('requests'));
  const reviewCounts = requestCounts.review;
  const pendingRequestsCount = (reviewCounts.total || 0) + (requestCounts.unseen_decisions || 0);
  const { data: jobSummary } = useQuery({
    queryKey: ['recruitment-summary'],
    queryFn: () => api.get('/recruitment/summary').then((r) => r.data),
    enabled: showJobPending,
    refetchInterval: 30000,
  });
  const pendingJobCount = jobSummary?.pendingApplications || 0;
  const { data: ownerCommentsSummary } = useQuery({
    queryKey: ['owner-comments-unread'],
    queryFn: () => api.get('/owner-comments', { params: { status: 'open' } }).then((r) => r.data),
    enabled: canAccess('owner_comments'),
    refetchInterval: 30000,
  });
  const ownerCommentsUnread = ownerCommentsSummary?.counts?.unread || 0;
  const { data: inboxMeData } = useQuery({
    // One small query for the badge (chats waiting on me, plus unassigned ones I can take).
    queryKey: ['inbox-me-badge'],
    queryFn: () => api.get('/inbox/badge').then((r) => r.data),
    enabled: canAccess('inbox'),
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
  const inboxNeedsReplyCount = inboxMeData?.badge || 0;

  const handleLogout = () => {
    logout();
    navigate('/sign-in');
  };

  const showLabels = isMobile || !collapsed;
  const sidebarW = isMobile ? 288 : collapsed ? 64 : 256;

  const visibleSections = visibleNavSections(canAccess, user?.role, Boolean(customPageAccess(user)));

  const handleNavClick = () => {
    if (isMobile) onCloseMobile();
  };

  return (
    <aside
      className="pms-sidebar fixed top-0 left-0 h-full flex flex-col z-50"
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

      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {visibleSections.map((section, sectionIdx) => (
            <div key={section.id} className={sectionIdx === 0 ? '' : 'mt-1'}>
              {showLabels ? (
                <p className={`px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.22em] text-white/35 ${sectionIdx === 0 ? 'pt-1' : 'pt-3'}`}>
                  {section.label}
                </p>
              ) : sectionIdx > 0 ? (
                <div className="mx-2 my-2 h-px bg-white/10" />
              ) : null}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const label =
                    item.adminLabel && user?.role === 'admin'
                      ? item.adminLabel
                      : item.managerLabel && user?.role === 'reservations_manager'
                        ? item.managerLabel
                      : item.page === 'requests' && item.agentLabel && !showReviewPending
                        ? item.agentLabel
                      : item.agentLabel &&
                          (user?.role === 'reservations_web' ||
                            user?.role === 'reservations_manual' ||
                            user?.role === 'reservations')
                        ? item.agentLabel
                        : item.label;
                  const pendingCount =
                    item.badge === 'inbox_needs_reply'
                      ? inboxNeedsReplyCount
                      : item.badge === 'website_pending'
                      ? websiteNeedsReviewCount
                      : item.badge === 'requests_pending'
                        ? pendingRequestsCount
                      : item.badge === 'job_pending'
                              ? pendingJobCount
                              : item.badge === 'owner_comments_unread'
                                ? ownerCommentsUnread
                                : 0;
                  const navTo =
                    item.badge === 'requests_pending' && reviewCounts.total > 0
                      ? `${item.path}?tab=review`
                      : item.badge === 'requests_pending' && requestCounts.unseen_decisions > 0
                        ? `${item.path}?tab=mine`
                        : item.path;
                  const typeChips =
                    item.badge === 'requests_pending' && showLabels && reviewCounts.total > 0
                      ? REQUEST_CATEGORIES.filter((c) => reviewCounts[c.id] > 0)
                      : [];
                  return (
                    <Fragment key={item.path}>
                    <NavLink
                      to={navTo}
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
                    {typeChips.length ? (
                      <div className="flex flex-wrap gap-1 pb-1 pl-11 pr-2">
                        {typeChips.map((c) => (
                          <NavLink
                            key={c.id}
                            to={`${item.path}?tab=review&type=${c.id}`}
                            onClick={handleNavClick}
                            className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/80 hover:bg-white/20 hover:text-white"
                            title={`${reviewCounts[c.id]} ${c.label.toLowerCase()} request${reviewCounts[c.id] === 1 ? '' : 's'} waiting for you`}
                          >
                            {c.short}
                            <span className="rounded-full px-1 text-[9px] font-bold text-white" style={{ background: 'var(--pms-accent, #F28C28)' }}>
                              {reviewCounts[c.id]}
                            </span>
                          </NavLink>
                        ))}
                      </div>
                    ) : null}
                    </Fragment>
                  );
                })}
              </div>
            </div>
        ))}
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
