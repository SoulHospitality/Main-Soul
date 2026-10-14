import { NavLink } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { visibleNavSections } from './Sidebar';

const SHORT_LABEL = {
  '/admin/dashboard': 'Home',
  '/admin/inbox': 'Inbox',
  '/admin/reservations': 'Bookings',
  '/admin/schedule': 'Schedule',
  '/admin/operations': 'Ops',
  '/admin/attendance': 'Attendance',
  '/admin/tasks': 'Tasks',
  '/admin/requests': 'Requests',
  '/admin/financial-system': 'Finance',
  '/admin/units': 'Units',
  '/admin/payslip': 'Payslip',
};

const DOCK_PRIORITY = [
  '/admin/dashboard',
  '/admin/inbox',
  '/admin/reservations',
  '/admin/schedule',
  '/admin/operations',
  '/admin/attendance',
  '/admin/tasks',
  '/admin/requests',
  '/admin/financial-system',
  '/admin/units',
  '/admin/payslip',
];

export default function MobileDock({ onOpenMenu }) {
  const { user } = useAuth();
  const { canAccess } = usePermissions();
  const items = visibleNavSections(canAccess, user?.role).flatMap((section) => section.items);
  const byPath = new Map(items.map((item) => [item.path, item]));
  const pinned = DOCK_PRIORITY.map((path) => byPath.get(path)).filter(Boolean).slice(0, 4);

  return (
    <nav className="pms-dock flex" aria-label="Primary">
      {pinned.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) => `pms-dock__item ${isActive ? 'pms-dock__item--active' : ''}`}
        >
          <item.icon className="h-5 w-5" strokeWidth={1.75} />
          <span>{SHORT_LABEL[item.path] || item.label}</span>
        </NavLink>
      ))}
      <button type="button" className="pms-dock__item" onClick={onOpenMenu}>
        <Menu className="h-5 w-5" strokeWidth={1.75} />
        <span>Menu</span>
      </button>
    </nav>
  );
}
