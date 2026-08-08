import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/axios';
import LoadingSpinner from './ui/LoadingSpinner';
import { currency, formatDate, formatDateTime } from '../utils/formatters';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'pending', label: 'Pending' },
  { id: 'rejected', label: 'Rejected' },
];

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-block flex-none rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
        active
          ? 'border-soul-blue bg-soul-blue-50 text-soul-blue'
          : 'border-soul-line bg-white text-soul-blue hover:border-soul-blue'
      }`}
    >
      {children}
    </button>
  );
}

function statusTone(decision) {
  if (decision === 'rejected') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (decision === 'pending') return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
}

export default function WebsiteBookingHistory() {
  const [filter, setFilter] = useState('all');

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['website-bookings-history'],
    queryFn: () =>
      api.get('/website-bookings', { params: { status: 'history' } }).then((r) => r.data),
    refetchInterval: 60000,
  });

  const filtered = useMemo(() => {
    if (filter === 'all') return history;
    return history.filter((b) => b.decision === filter);
  }, [history, filter]);

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="card p-4 space-y-4">
      <div>
        <h2 className="font-semibold text-gray-900">Booking history</h2>
        <p className="text-xs text-gray-500">
          Accepted = fully paid. Pending = accepted with remaining balance. Rejected = declined with
          reason.
        </p>
      </div>

      <div className="flex gap-1.5 overflow-x-auto whitespace-nowrap pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => (
          <FilterChip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </FilterChip>
        ))}
      </div>

      {!filtered.length ? (
        <p className="text-sm text-gray-500 py-8 text-center">
          {filter === 'all'
            ? 'No accepted, pending, or rejected bookings yet.'
            : `No ${filter} bookings.`}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="py-2 pr-3">Guest</th>
                <th className="py-2 pr-3">Unit</th>
                <th className="py-2 pr-3">Stay</th>
                <th className="py-2 pr-3">Total</th>
                <th className="py-2 pr-3">Paid / Due</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Reason</th>
                <th className="py-2 pr-3">Decided by</th>
                <th className="py-2">When</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const decision = b.decision;
                const rejected = decision === 'rejected';
                const pending = decision === 'pending';
                return (
                  <tr key={b.id} className="border-t border-gray-100 align-top">
                    <td className="py-3 pr-3 min-w-[10rem]">
                      <div className="font-medium text-gray-900">{b.guest_name || '—'}</div>
                      <div className="text-xs text-gray-500">
                        {b.guest_phone || b.guest_email || ''}
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="font-medium">{b.unit_number || '—'}</div>
                      <div className="text-xs text-gray-500 truncate max-w-[10rem]">
                        {b.unit_title || b.listing_title || ''}
                      </div>
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap text-xs">
                      {formatDate(b.checkin)} → {formatDate(b.checkout)}
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap tabular-nums font-medium">
                      {currency(b.total_egp)}
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap text-xs">
                      {rejected ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <>
                          <div className="tabular-nums text-gray-800">
                            Paid {currency(b.amount_paid)}
                          </div>
                          {pending || Number(b.amount_due) > 0 ? (
                            <div className="tabular-nums text-amber-700 font-medium">
                              Due {currency(b.amount_due)}
                            </div>
                          ) : (
                            <div className="text-emerald-700">Settled</div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${statusTone(
                          decision
                        )}`}
                      >
                        {b.decision_label ||
                          (rejected ? 'Rejected' : pending ? 'Pending' : 'Accepted')}
                      </span>
                    </td>
                    <td className="py-3 pr-3 max-w-[16rem]">
                      {rejected ? (
                        <p className="text-sm text-rose-800 whitespace-pre-wrap">
                          {b.decision_reason || '—'}
                        </p>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-sm">
                      {b.decided_by_name || b.assigned_agent_name || '—'}
                    </td>
                    <td className="py-3 whitespace-nowrap text-xs text-gray-500">
                      {b.decided_at ? formatDateTime(b.decided_at) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
