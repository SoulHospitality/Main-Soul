import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../api/axios';

const TABS = [
  { to: '/admin/website-bookings/unassigned', label: 'Unassigned', end: true, badge: 'unassigned' },
  { to: '/admin/website-bookings', label: 'Requests', end: true, badge: 'pending' },
  { to: '/admin/website-bookings/history', label: 'History', end: false },
];

function CountBadge({ count }) {
  if (!count || count < 1) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <span
      className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[11px] font-bold text-white"
      style={{ background: 'var(--pms-accent, #F28C28)' }}
    >
      {label}
    </span>
  );
}

export default function WebsiteBookingsNav() {
  const { data: unassigned = [] } = useQuery({
    queryKey: ['website-bookings-unassigned'],
    queryFn: () =>
      api.get('/website-bookings', { params: { status: 'unassigned' } }).then((r) => r.data),
    refetchInterval: 30000,
  });
  const { data: pending = [] } = useQuery({
    queryKey: ['website-bookings-pending'],
    queryFn: () =>
      api.get('/website-bookings', { params: { status: 'pending' } }).then((r) => r.data),
    refetchInterval: 30000,
  });

  const unassignedCount = Array.isArray(unassigned) ? unassigned.length : 0;
  const pendingCount = Array.isArray(pending) ? pending.length : 0;

  return (
    <div className="flex gap-1 border-b border-gray-200">
      {TABS.map((tab) => {
        const count =
          tab.badge === 'unassigned'
            ? unassignedCount
            : tab.badge === 'pending'
              ? pendingCount
              : 0;
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `inline-flex items-center px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                isActive
                  ? 'border-[var(--pms-accent,#283f5e)] text-[var(--pms-accent-text,#283f5e)]'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`
            }
          >
            {tab.label}
            <CountBadge count={count} />
          </NavLink>
        );
      })}
    </div>
  );
}
