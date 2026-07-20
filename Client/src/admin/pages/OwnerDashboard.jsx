import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, CalendarDays, DollarSign, Wallet } from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { currency } from '../utils/formatters';

function Card({ icon: Icon, title, value, sub }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 flex gap-4 items-center shadow-sm">
      <div className="w-11 h-11 rounded-xl bg-teal-50 flex items-center justify-center">
        <Icon className="w-5 h-5 text-teal-700" />
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-500">{title}</p>
        <p className="text-xl font-semibold text-gray-900">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function OwnerDashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['owner-dashboard'],
    queryFn: () => api.get('/owner/dashboard').then((r) => r.data),
  });

  if (isLoading) return <LoadingSpinner />;
  if (error) {
    return <p className="text-red-600 text-sm">Failed to load owner dashboard</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Owner Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Your units, earnings, and payouts — no guest details shown</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card icon={Building2} title="Units" value={data?.units?.length ?? 0} />
        <Card icon={CalendarDays} title="Occupancy" value={`${data?.occupancy_pct ?? 0}%`} sub={`ADR ${currency(data?.adr)}`} />
        <Card icon={DollarSign} title="Owner net" value={currency(data?.owner_net)} sub={`GBV ${currency(data?.gbv)}`} />
        <Card
          icon={Wallet}
          title="Pending / available"
          value={currency(data?.pending)}
          sub={data?.next_payout_date ? `Next cycle ${String(data.next_payout_date).slice(0, 10)}` : 'No ready settlement yet'}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <Link to="/admin/owner/blocks" className="btn-secondary text-sm">
          Block dates
        </Link>
        <Link to="/admin/owner/reservations" className="btn-secondary text-sm">
          View reservations
        </Link>
        <Link to="/admin/owner/statement" className="btn-secondary text-sm">
          Statement
        </Link>
        <Link to="/admin/owner/payouts" className="btn-primary text-sm">
          Request payout
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 font-semibold text-gray-900">Your units</div>
        {(data?.units || []).length === 0 ? (
          <p className="p-6 text-sm text-gray-400">No units linked yet. Ask admin to map owner_units.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.units.map((u) => (
              <li key={u.id} className="px-5 py-3 flex justify-between text-sm">
                <span className="font-medium text-gray-800">{u.title || u.unit_number}</span>
                <span className="text-gray-500">
                  {u.project || u.compound || '—'} · {u.ops_status || u.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
