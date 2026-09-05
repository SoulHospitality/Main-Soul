import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, LogOut } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { currency } from '../utils/formatters';
import { OpsDateRangeFilter, formatOpsDay } from '../components/OpsDateRangeFilter';

export function CheckoutsTodaySection({ embedded = false }) {
  const qc = useQueryClient();
  const [range, setRange] = useState('month');
  const [refundingId, setRefundingId] = useState(null);
  const [methodDrafts, setMethodDrafts] = useState({});

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ops-checkouts-today', range],
    queryFn: async () => {
      const r = await api.get('/ops/checkouts-today', { params: { range } });
      if (Array.isArray(r.data)) return { items: r.data, range };
      return {
        items: Array.isArray(r.data?.items) ? r.data.items : [],
        range: r.data?.range || range,
        from: r.data?.from,
        to: r.data?.to,
      };
    },
    refetchInterval: 20000,
  });
  const rows = data?.items || [];

  const refundMutation = useMutation({
    mutationFn: ({ id, payment_method }) =>
      api.post(`/ops/checkouts-today/${id}/refund-insurance`, { payment_method }),
    onSuccess: () => {
      toast.success('Insurance marked as refunded');
      setRefundingId(null);
      qc.invalidateQueries({ queryKey: ['ops-checkouts-today'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not mark insurance refunded'),
  });

  if (isLoading) return <LoadingSpinner />;

  const emptyLabel =
    range === 'today'
      ? 'today'
      : range === 'tomorrow'
        ? 'tomorrow'
        : range === 'week'
          ? 'this week'
          : 'this month';

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-6'}>
      {!embedded ? (
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Checkouts</h1>
            <p className="mt-1 text-sm text-gray-500">
              Departures for the selected period — confirm insurance held and mark when you refunded it
              to the guest.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <OpsDateRangeFilter value={range} onChange={setRange} />
            <button type="button" className="btn-secondary text-sm" onClick={() => refetch()}>
              Refresh
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <OpsDateRangeFilter value={range} onChange={setRange} />
          <button type="button" className="btn-secondary text-sm" onClick={() => refetch()}>
            Refresh
          </button>
        </div>
      )}

      {isError ? (
        <div className="card p-10 text-center text-sm text-red-600">
          Could not load checkouts: {error?.response?.data?.error || error?.message || 'Request failed'}
        </div>
      ) : !rows.length ? (
        <div className="card p-10 text-center text-sm text-gray-500">
          No checkouts scheduled for {emptyLabel}.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-gray-500 border-b">
              <tr>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Guest</th>
                <th className="py-3 px-4">Unit</th>
                <th className="py-3 px-4">Insurance</th>
                <th className="py-3 px-4">Refund status</th>
                <th className="py-3 px-4">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const insurance = Number(r.insurance) || 0;
                const method = methodDrafts[r.id] || 'cash';
                const status = String(r.insurance_refund_status || '').toLowerCase();
                return (
                  <tr key={r.id} className="border-t align-top">
                    <td className="py-4 px-4 whitespace-nowrap">
                      <div className="font-semibold text-gray-900">{formatOpsDay(r.check_out)}</div>
                      <div className="text-[11px] text-gray-500 tabular-nums">
                        {String(r.check_out || '').slice(0, 10)}
                      </div>
                    </td>
                    <td className="py-4 px-4 min-w-[12rem]">
                      <div className="font-semibold text-gray-900">{r.guest_name || '—'}</div>
                      <div className="text-xs text-gray-600 tabular-nums mt-0.5">
                        {r.guest_phone || 'No phone'}
                      </div>
                    </td>
                    <td className="py-4 px-4 min-w-[9rem]">
                      <div className="font-semibold text-gray-900">{r.unit_number || '—'}</div>
                      <div className="text-xs text-gray-500 truncate max-w-[10rem]">
                        {r.unit_title || r.project || ''}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      {insurance > 0.009 ? (
                        <div className="font-semibold tabular-nums text-amber-900">
                          {currency(insurance)}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-500">No insurance held</span>
                      )}
                    </td>
                    <td className="py-4 px-4 min-w-[11rem]">
                      {status === 'refunded' || status === 'partial' || status === 'forfeited' ? (
                        <div className="space-y-0.5">
                          <div className="inline-flex items-center gap-1.5 text-emerald-700 text-xs font-semibold">
                            <CheckCircle2 className="w-4 h-4" />
                            {status === 'refunded'
                              ? 'Refunded'
                              : status === 'partial'
                                ? 'Partially refunded'
                                : 'Forfeited'}
                          </div>
                          {r.insurance_refunded_amount > 0 ? (
                            <div className="text-[11px] text-gray-600 tabular-nums">
                              {currency(r.insurance_refunded_amount)}
                              {r.insurance_refund_method ? ` · ${r.insurance_refund_method}` : ''}
                            </div>
                          ) : null}
                          {r.insurance_refunded_by_name ? (
                            <div className="text-[11px] text-gray-500">
                              by {r.insurance_refunded_by_name}
                            </div>
                          ) : null}
                        </div>
                      ) : insurance > 0.009 ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-1 text-xs font-semibold">
                          Pending refund
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-4 px-4 min-w-[14rem]">
                      {r.can_refund_insurance ? (
                        <div className="space-y-2">
                          {refundingId === r.id ? (
                            <div className="space-y-2 rounded-lg border bg-gray-50 p-2.5">
                              <div>
                                <label className="text-[10px] uppercase text-gray-500">
                                  Refund method
                                </label>
                                <select
                                  className="input text-sm py-1.5"
                                  value={method}
                                  onChange={(e) =>
                                    setMethodDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))
                                  }
                                >
                                  <option value="cash">Cash</option>
                                  <option value="instapay">InstaPay</option>
                                  <option value="bank_transfer">Bank transfer</option>
                                </select>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  className="btn-primary text-xs flex-1 justify-center"
                                  disabled={refundMutation.isPending}
                                  onClick={() =>
                                    refundMutation.mutate({
                                      id: r.id,
                                      payment_method: method,
                                    })
                                  }
                                >
                                  Confirm refunded
                                </button>
                                <button
                                  type="button"
                                  className="btn-secondary text-xs"
                                  onClick={() => setRefundingId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="btn-primary text-xs inline-flex items-center gap-1.5"
                              onClick={() => setRefundingId(r.id)}
                            >
                              <LogOut className="w-3.5 h-3.5" />
                              Refunded the insurance
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
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

export default function OpsCheckoutsToday() {
  return <CheckoutsTodaySection />;
}
