import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from './ui/LoadingSpinner';
import { currency, formatDate, PAYMENT_METHOD_LABELS } from '../utils/formatters';
import { resolveWebsiteBookingPayTotals } from '../utils/websiteBookingPay';
import { usePermissions } from '../hooks/usePermissions';

function paymentMethodLabel(method) {
  const key = String(method || '').toLowerCase();
  if (PAYMENT_METHOD_LABELS[key]) return PAYMENT_METHOD_LABELS[key];
  if (key.includes('paymob') || key.includes('card')) return 'Card';
  if (key.includes('instapay')) return 'InstaPay';
  if (key.includes('cash')) return 'Cash';
  return method || '—';
}

function nightsBetween(checkin, checkout) {
  if (!checkin || !checkout) return 0;
  const ms = new Date(checkout) - new Date(checkin);
  return Math.max(1, Math.round(ms / 86400000));
}

function isWebsiteAgent(user) {
  return user?.role === 'reservations_web' || user?.role === 'reservations';
}

export default function WebsiteBookingUnassigned() {
  const qc = useQueryClient();
  const { isAdmin } = usePermissions();
  const [adminPicks, setAdminPicks] = useState({});

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['website-bookings-unassigned'],
    queryFn: () =>
      api.get('/website-bookings', { params: { status: 'unassigned' } }).then((r) => r.data),
    refetchInterval: 30000,
  });

  const { data: salesUsers = [] } = useQuery({
    queryKey: ['users-sales'],
    queryFn: () => api.get('/users/sales').then((r) => r.data),
    enabled: isAdmin,
  });

  const webAgents = useMemo(
    () => (Array.isArray(salesUsers) ? salesUsers.filter(isWebsiteAgent) : []),
    [salesUsers]
  );

  const invalidateLists = () => {
    qc.invalidateQueries({ queryKey: ['website-bookings-unassigned'] });
    qc.invalidateQueries({ queryKey: ['website-bookings-pending'] });
    qc.invalidateQueries({ queryKey: ['website-bookings-history'] });
  };

  const assignMutation = useMutation({
    mutationFn: ({ id, assigned_sales_id }) =>
      api.post(`/website-bookings/${id}/assign`, assigned_sales_id ? { assigned_sales_id } : {}),
    onSuccess: () => {
      toast.success(isAdmin ? 'Request assigned' : 'Request assigned to you');
      invalidateLists();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Assign failed'),
  });

  const claim = (id) => assignMutation.mutate({ id });

  const adminAssign = (id) => {
    const agentId = Number(adminPicks[id]);
    if (!agentId) {
      toast.error('Select a website agent');
      return;
    }
    assignMutation.mutate({ id, assigned_sales_id: agentId });
  };

  if (isLoading) return <LoadingSpinner />;

  if (!bookings.length) {
    return (
      <div className="card p-8 text-center text-sm text-gray-500">
        No unassigned website reservation requests.
      </div>
    );
  }

  return (
    <div className="card p-4 space-y-3 border-sky-200 bg-sky-50/30">
      <div>
        <h2 className="font-semibold text-gray-900">Unassigned website requests</h2>
        <p className="text-xs text-gray-500">
          {isAdmin
            ? 'Assign each request to any website reservations agent.'
            : 'Claim a request to work it from your Requests list.'}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="py-2 pr-3">Guest</th>
              <th className="py-2 pr-3">Stay</th>
              <th className="py-2 pr-3">Unit</th>
              <th className="py-2 pr-3">Total</th>
              <th className="py-2 pr-3">Payment</th>
              <th className="py-2">Assign</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => {
              const nights = nightsBetween(b.checkin, b.checkout);
              const total =
                Number(resolveWebsiteBookingPayTotals(b.payment_breakdown, b).total_egp ?? b.total_egp) ||
                0;
              return (
                <tr key={b.id} className="border-t border-sky-100 align-top">
                  <td className="py-3 pr-3 min-w-[12rem]">
                    <div className="font-semibold text-gray-900">{b.guest_name || '—'}</div>
                    <div className="text-xs text-gray-600 tabular-nums">{b.guest_phone || '—'}</div>
                    <div className="text-xs text-gray-500 break-all">{b.guest_email || ''}</div>
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap">
                    <div className="font-medium text-gray-900">
                      {nights} night{nights === 1 ? '' : 's'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatDate(b.checkin)} → {formatDate(b.checkout)}
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-semibold text-gray-900">{b.unit_number || '—'}</div>
                    <div className="text-xs text-gray-500 truncate max-w-[10rem]">
                      {b.unit_title || b.listing_title || ''}
                    </div>
                  </td>
                  <td className="py-3 pr-3 font-semibold tabular-nums text-soul-blue">
                    {currency(total)}
                  </td>
                  <td className="py-3 pr-3">
                    <div className="text-sm font-medium">{paymentMethodLabel(b.payment_method)}</div>
                    <div className="text-xs text-gray-500 capitalize">
                      {b.payment_status || 'pending'}
                    </div>
                  </td>
                  <td className="py-3 min-w-[14rem]">
                    {isAdmin ? (
                      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                        <select
                          className="input text-xs py-1.5"
                          value={adminPicks[b.id] || ''}
                          onChange={(e) =>
                            setAdminPicks((prev) => ({ ...prev, [b.id]: e.target.value }))
                          }
                        >
                          <option value="">Select agent…</option>
                          {webAgents.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.full_name || a.username}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn-primary text-xs whitespace-nowrap"
                          disabled={assignMutation.isPending}
                          onClick={() => adminAssign(b.id)}
                        >
                          <UserPlus className="w-3.5 h-3.5" /> Assign
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn-primary text-xs"
                        disabled={assignMutation.isPending}
                        onClick={() => claim(b.id)}
                      >
                        <UserPlus className="w-3.5 h-3.5" /> Assign to me
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
