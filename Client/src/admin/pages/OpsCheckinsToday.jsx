import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { useAuth } from '../context/AuthContext';
import { currency } from '../utils/formatters';

function MoneyLine({ label, value, emphasize = false }) {
  if (value == null || Number(value) === 0) return null;
  return (
    <div className={`flex justify-between gap-3 ${emphasize ? 'border-t pt-1 font-semibold' : ''}`}>
      <span className={emphasize ? 'text-amber-800' : 'text-gray-500'}>{label}</span>
      <span className={`tabular-nums ${emphasize ? 'text-amber-900 font-bold' : 'font-medium'}`}>
        {currency(value)}
      </span>
    </div>
  );
}

function PaymentDetails({ row }) {
  const b = row.payment_breakdown || {};
  const remaining = Number(row.remaining_amount) || 0;
  const party = [
    b.adults > 0 ? `${b.adults} adult${b.adults === 1 ? '' : 's'}` : null,
    b.children > 0 ? `${b.children} child${b.children === 1 ? '' : 'ren'}` : null,
    b.nanny_count > 0 ? `${b.nanny_count} nanny` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-1 text-xs min-w-[13rem]">
      {b.nights > 0 && (
        <div className="text-gray-600">
          {b.nights} night{b.nights === 1 ? '' : 's'}
          {b.price_per_night > 0 ? ` · ${currency(b.price_per_night)}/night` : ''}
        </div>
      )}
      {party ? <div className="text-gray-500">{party}</div> : null}
      <MoneyLine label="Accommodation" value={b.accommodation_amount} />
      <MoneyLine label="Housekeeping" value={b.housekeeping_fees} />
      <MoneyLine label="Beach access" value={b.beach_access_fees} />
      <MoneyLine
        label={b.service_fee_percent ? `Service (${b.service_fee_percent}%)` : 'Service fees'}
        value={b.service_fees}
      />
      <MoneyLine label="Insurance" value={b.insurance} />
      <MoneyLine label="Utilities" value={b.utilities_amount} />
      <MoneyLine label="Security deposit" value={b.security_deposit} />
      {b.owner_collected_amount > 0 && (
        <MoneyLine
          label={`Owner collected${b.owner_collected_type ? ` (${b.owner_collected_type})` : ''}`}
          value={b.owner_collected_amount}
        />
      )}
      <div className="flex justify-between gap-3 border-t pt-1 mt-1">
        <span className="text-gray-500">Total</span>
        <span className="font-medium tabular-nums">{currency(row.total_amount)}</span>
      </div>
      <div className="flex justify-between gap-3">
        <span className="text-gray-500">Paid</span>
        <span className="font-medium tabular-nums text-emerald-700">{currency(row.amount_paid)}</span>
      </div>
      <MoneyLine label="To collect" value={remaining} emphasize />
    </div>
  );
}

export default function OpsCheckinsToday() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [collectingId, setCollectingId] = useState(null);
  const [amountDrafts, setAmountDrafts] = useState({});
  const [methodDrafts, setMethodDrafts] = useState({});
  const canAssign =
    user?.role === 'admin' || user?.role === 'operations_supervisor';
  const isAgent = user?.role === 'operations';

  const { data: rows = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ops-checkins-today'],
    queryFn: async () => {
      const r = await api.get('/ops/checkins-today');
      return Array.isArray(r.data) ? r.data : [];
    },
    refetchInterval: 20000,
  });

  const { data: agents = [] } = useQuery({
    queryKey: ['ops-agents'],
    queryFn: async () => {
      const r = await api.get('/ops/agents');
      return Array.isArray(r.data) ? r.data : [];
    },
    enabled: canAssign,
  });

  const collectMutation = useMutation({
    mutationFn: ({ id, amount, payment_method }) =>
      api.post(`/ops/checkins-today/${id}/collect`, { amount, payment_method }),
    onSuccess: () => {
      toast.success('Money marked as collected');
      setCollectingId(null);
      qc.invalidateQueries({ queryKey: ['ops-checkins-today'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Collect failed'),
  });

  const handoverMutation = useMutation({
    mutationFn: (id) => api.post(`/ops/checkins-today/${id}/handover`),
    onSuccess: () => {
      toast.success('Unit handed to guest');
      qc.invalidateQueries({ queryKey: ['ops-checkins-today'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Handover failed'),
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, staff_id }) =>
      api.post(`/ops/checkins-today/${id}/assign`, { staff_id: staff_id || null }),
    onSuccess: () => {
      toast.success('Assignment updated');
      qc.invalidateQueries({ queryKey: ['ops-checkins-today'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Assign failed'),
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Checkins for today</h1>
          <p className="mt-1 text-sm text-gray-500">
            {canAssign
              ? 'Assign each arrival to an operations agent, then track collect and handover.'
              : isAgent
                ? 'Your assigned arrivals — review the stay breakdown, collect remaining balance, and hand over once cleaned.'
                : 'Collect remaining balance and hand the unit over once housekeeping has cleaned it.'}
          </p>
        </div>
        <button type="button" className="btn-secondary text-sm" onClick={() => refetch()}>
          Refresh
        </button>
      </div>

      {isError ? (
        <div className="card p-10 text-center text-sm text-red-600">
          Could not load check-ins: {error?.response?.data?.error || error?.message || 'Request failed'}
        </div>
      ) : !rows.length ? (
        <div className="card p-10 text-center text-sm text-gray-500">
          {isAgent
            ? 'No check-ins assigned to you yet. Ask your Operations Supervisor to assign arrivals.'
            : 'No check-ins scheduled for today.'}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-gray-500 border-b">
              <tr>
                <th className="py-3 px-4">Guest</th>
                <th className="py-3 px-4">Unit</th>
                <th className="py-3 px-4">Payment details</th>
                <th className="py-3 px-4">Housekeeping</th>
                {canAssign ? <th className="py-3 px-4">Assign agent</th> : null}
                <th className="py-3 px-4">Money collected</th>
                <th className="py-3 px-4">Handover</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const remaining = Number(r.remaining_amount) || 0;
                const draftAmount =
                  amountDrafts[r.id] != null ? amountDrafts[r.id] : String(remaining);
                const method = methodDrafts[r.id] || 'cash';
                return (
                  <tr key={r.id} className="border-t align-top">
                    <td className="py-4 px-4 min-w-[12rem]">
                      <div className="font-semibold text-gray-900">{r.guest_name || '—'}</div>
                      <div className="text-xs text-gray-600 tabular-nums mt-0.5">
                        {r.guest_phone || 'No phone'}
                      </div>
                      {!canAssign && r.ops_assignee_name ? (
                        <div className="text-[11px] text-teal-800 mt-1">
                          Assigned: {r.ops_assignee_name}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-4 px-4 min-w-[9rem]">
                      <div className="font-semibold text-gray-900">{r.unit_number || '—'}</div>
                      <div className="text-xs text-gray-500 truncate max-w-[10rem]">
                        {r.unit_title || r.project || ''}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <PaymentDetails row={r} />
                    </td>
                    <td className="py-4 px-4">
                      {r.hk_cleaned ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-1 text-xs font-semibold">
                          <Sparkles className="w-3.5 h-3.5" /> Cleaned
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-1 text-xs font-semibold">
                          Not cleaned
                        </span>
                      )}
                    </td>
                    {canAssign ? (
                      <td className="py-4 px-4 min-w-[12rem]">
                        <select
                          className="input text-sm py-1.5"
                          value={r.ops_assigned_to || ''}
                          disabled={assignMutation.isPending}
                          onChange={(e) =>
                            assignMutation.mutate({
                              id: r.id,
                              staff_id: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                        >
                          <option value="">Unassigned</option>
                          {agents.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.full_name || a.username}
                              {a.staff_code ? ` (${a.staff_code})` : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                    ) : null}
                    <td className="py-4 px-4 min-w-[14rem]">
                      {r.ops_money_collected ? (
                        <div className="inline-flex items-center gap-1.5 text-emerald-700 text-xs font-semibold">
                          <CheckCircle2 className="w-4 h-4" />
                          Collected
                          {r.ops_money_collected_amount > 0
                            ? ` (${currency(r.ops_money_collected_amount)})`
                            : remaining <= 0.5
                              ? ' (already paid)'
                              : ''}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
                            <input
                              type="checkbox"
                              checked={collectingId === r.id}
                              onChange={(e) => setCollectingId(e.target.checked ? r.id : null)}
                            />
                            Collect remaining
                          </label>
                          {collectingId === r.id ? (
                            <div className="space-y-2 rounded-lg border bg-gray-50 p-2.5">
                              <div>
                                <label className="text-[10px] uppercase text-gray-500">Amount</label>
                                <input
                                  type="number"
                                  min={0}
                                  max={remaining}
                                  step="0.01"
                                  className="input text-sm py-1.5"
                                  value={draftAmount}
                                  onChange={(e) =>
                                    setAmountDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))
                                  }
                                />
                              </div>
                              <div>
                                <label className="text-[10px] uppercase text-gray-500">Method</label>
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
                              <button
                                type="button"
                                className="btn-primary text-xs w-full justify-center"
                                disabled={collectMutation.isPending}
                                onClick={() =>
                                  collectMutation.mutate({
                                    id: r.id,
                                    amount: Number(draftAmount),
                                    payment_method: method,
                                  })
                                }
                              >
                                Confirm collect
                              </button>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="py-4 px-4 min-w-[9rem]">
                      {r.ops_handed_over ? (
                        <span className="inline-flex items-center gap-1.5 text-soul-blue text-xs font-semibold">
                          <KeyRound className="w-4 h-4" /> Handed over
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn-primary text-xs"
                          disabled={!r.can_handover || handoverMutation.isPending}
                          title={
                            !r.ops_money_collected
                              ? 'Collect money first'
                              : !r.hk_cleaned
                                ? 'Waiting for housekeeping'
                                : 'Give unit to guest'
                          }
                          onClick={() => handoverMutation.mutate(r.id)}
                        >
                          Give to guest
                        </button>
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
