import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../api/axios';
import { countOrChecklistRows } from './OrChecklistSection';

function CountBadge({ count }) {
  if (!count || count < 1) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <span
      className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[11px] font-bold text-white"
      style={{ background: 'var(--pms-accent, #2a9d8f)' }}
    >
      {label}
    </span>
  );
}

const TABS = [
  { to: '/admin/reservations', label: 'All reservations', end: true },
  { to: '/admin/reservations/checklist', label: 'Checklist', end: true, badge: 'checklist' },
];

export default function ReservationsNav() {
  const { data: reservations = [] } = useQuery({
    queryKey: ['reservations'],
    queryFn: () => api.get('/reservations').then((r) => r.data),
    refetchInterval: 60000,
  });

  const checklistCount = countOrChecklistRows(reservations);

  return (
    <div className="flex gap-1 border-b border-gray-200">
      {TABS.map((tab) => {
        const count = tab.badge === 'checklist' ? checklistCount : 0;
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `inline-flex items-center px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                isActive
                  ? 'border-[var(--pms-accent,#2a9d8f)] text-[var(--pms-accent-text,#0f5c54)]'
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
