import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { ROLE_LABELS, PMS_LABELS } from '../../utils/permissions';
import { getRoleTheme } from '../../utils/roleTheme';
import {
  LayoutDashboard, Building2, CalendarDays, CreditCard,
  BadgeDollarSign, Receipt, FileBarChart2, Users, UserCircle,
  LogOut, Building, FileText, CalendarRange, Zap, CheckSquare, Users2, Wallet,
  TrendingUp, Landmark, Sparkles, Shield, DollarSign, Briefcase,
} from 'lucide-react';

const NAV_ITEMS = [
  { path: '/admin/dashboard',        label: 'Dashboard',          icon: LayoutDashboard,   page: 'dashboard' },
  { path: '/admin/units',            label: 'Units',              icon: Building2,          page: 'units' },
  { path: '/admin/projects',         label: 'Destinations',       icon: Building,           page: 'projects' },
  { path: '/admin/reservations',     label: 'Reservations',       icon: CalendarDays,       page: 'reservations' },
  { path: '/admin/schedule',         label: 'Schedule',           icon: CalendarRange,      page: 'schedule' },
  { path: '/admin/pricing',          label: 'Pricing',            icon: DollarSign,         page: 'schedule' },
  { path: '/admin/utilities',        label: 'Utilities',          icon: Zap,                page: 'utilities' },
  { path: '/admin/payments',         label: 'Payments',           icon: CreditCard,         page: 'payments' },
  { path: '/admin/finance',          label: 'Finance',            icon: BadgeDollarSign,    page: 'finance' },
  { path: '/admin/profit',           label: 'Profit',             icon: TrendingUp,         page: 'profit' },
  { path: '/admin/expenses',         label: 'Expenses',           icon: Receipt,            page: 'expenses' },
  { path: '/admin/petty-cash',       label: 'Petty Cash',         icon: Wallet,             page: 'petty_cash' },
  { path: '/admin/housekeeping',     label: 'Housekeeping Fees',  icon: Sparkles,           page: 'housekeeping' },
  { path: '/admin/treasury',         label: 'Treasury',            icon: Landmark,           page: 'cashflow' },
  { path: '/admin/cashflow',         label: 'Cash Flow',          icon: DollarSign,         page: 'cashflow' },
  { path: '/admin/owner-statement',  label: 'Owner Statement',    icon: FileBarChart2,      page: 'owner_statement' },
  { path: '/admin/reports',          label: 'Reports',            icon: FileText,           page: 'reports' },
  { path: '/admin/hr',               label: 'HR & Payroll',       icon: Users2,             page: 'hr' },
  { path: '/admin/recruitment',      label: 'Recruitment',        icon: Briefcase,          page: 'recruitment' },
  { path: '/admin/users',            label: 'User Management',    icon: Users,              page: 'users' },
  { path: '/admin/tasks',            label: 'Tasks',              icon: CheckSquare,        page: 'tasks' },
  { path: '/admin/audit',            label: 'Audit Log',          icon: Shield,             page: 'audit' },
];

export default function Sidebar({ collapsed, isMobile, mobileOpen, onCloseMobile }) {
  const { user, logout } = useAuth();
  const { canAccess } = usePermissions();
  const navigate = useNavigate();
  const theme = getRoleTheme(user?.role);

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
        {NAV_ITEMS.filter((item) => canAccess(item.page)).map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={handleNavClick}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? 'sidebar-link-active' : 'sidebar-link-inactive'} ${!showLabels ? 'justify-center px-2' : ''}`
            }
            title={!showLabels ? item.label : undefined}
          >
            <item.icon className="w-5 h-5 flex-shrink-0" strokeWidth={1.75} />
            {showLabels && <span>{item.label}</span>}
          </NavLink>
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
