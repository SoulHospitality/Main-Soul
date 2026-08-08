import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/admin/website-bookings', label: 'Requests', end: true },
  { to: '/admin/website-bookings/history', label: 'History', end: false },
];

export default function WebsiteBookingsNav() {
  return (
    <div className="flex gap-1 border-b border-gray-200">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            `px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              isActive
                ? 'border-[var(--pms-accent,#283f5e)] text-[var(--pms-accent-text,#283f5e)]'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}
