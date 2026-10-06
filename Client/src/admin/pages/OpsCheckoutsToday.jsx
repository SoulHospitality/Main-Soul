import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, History, LogOut, MessageSquarePlus } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { currency } from '../utils/formatters';
import { useAuth } from '../context/AuthContext';
import { OpsDateRangeFilter, formatOpsDay } from '../components/OpsDateRangeFilter';
import { ProofPicker } from '../components/CameraCapture';
import {
  CheckinHistoryModal,
  OpsCommentModal,
  ReassignReasonModal,
  ReservationContext,
} from '../components/OpsCheckinActions';

const SHARE_LABELS = {
  pending: 'Owner share pending approval',
  approved: 'Shared with owner',
  rejected: 'Not shared with owner',
};

export function CheckoutsTodaySection({ embedded = false }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canAssign = user?.role === 'admin' || user?.role === 'operations_supervisor';
  const [range, setRange] = useState('today');
  const [refundingId, setRefundingId] = useState(null);
  const [methodDrafts, setMethodDrafts] = useState({});
  const [refundDrafts, setRefundDrafts] = useState({});
  const [damageDrafts, setDamageDrafts] = useState({});
  const [notesDrafts, setNotesDrafts] = useState({});
  const [photoDrafts, setPhotoDrafts] = useState({});
  const [shareDrafts, setShareDrafts] = useState({});
  const [pendingAssign, setPendingAssign] = useState(null);
  const [historyRow, setHistoryRow] = useState(null);
  const [commentTarget, setCommentTarget] = useState(null);

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

  const { data: agents = [] } = useQuery({
    queryKey: ['ops-agents'],
    queryFn: async () => {
      const r = await api.get('/ops/agents');
      return Array.isArray(r.data) ? r.data : [];
    },
    enabled: canAssign,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['ops-checkouts-today'] });

  const refundMutation = useMutation({
    mutationFn: ({ id, payment_method, refunded_amount, notes, photos, share_with_owner }) => {
      const fd = new FormData();
      fd.append('payment_method', payment_method);
      fd.append('refunded_amount', String(refunded_amount));
      if (notes) fd.append('notes', notes);
      if (share_with_owner) fd.append('share_with_owner', 'true');
      (photos || []).forEach((f) => fd.append('damage_photos', f));
      return api.post(`/ops/checkouts-today/${id}/refund-insurance`, fd);
    },
    onSuccess: (_res, vars) => {
      toast.success('Insurance payout recorded');
      setRefundingId(null);
      setPhotoDrafts((prev) => ({ ...prev, [vars.id]: [] }));
      invalidate();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not record insurance payout'),
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, staff_id, reason }) =>
      api.post(`/ops/checkouts-today/${id}/assign`, { staff_id: staff_id || null, reason }),
    onSuccess: () => {
      toast.success('Checkout assignment updated');
      setPendingAssign(null);
      invalidate();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not assign'),
  });

  function openRefund(row) {
    const held = Math.round((Number(row.insurance) || 0) * 100) / 100;
    setRefundingId(row.id);
    setRefundDrafts((prev) => ({ ...prev, [row.id]: String(held) }));
    setDamageDrafts((prev) => ({ ...prev, [row.id]: '0' }));
    setMethodDrafts((prev) => ({ ...prev, [row.id]: prev[row.id] || 'cash' }));
    setNotesDrafts((prev) => ({ ...prev, [row.id]: prev[row.id] || '' }));
  }

  function onRefundAmountChange(id, held, value) {
    setRefundDrafts((prev) => ({ ...prev, [id]: value }));
    const ref = Math.max(0, parseFloat(value) || 0);
    setDamageDrafts((prev) => ({
      ...prev,
      [id]: String(Math.max(0, Math.round((held - ref) * 100) / 100)),
    }));
  }

  function onDamageAmountChange(id, held, value) {
    setDamageDrafts((prev) => ({ ...prev, [id]: value }));
    const dmg = Math.max(0, parseFloat(value) || 0);
    setRefundDrafts((prev) => ({
      ...prev,
      [id]: String(Math.max(0, Math.round((held - dmg) * 100) / 100)),
    }));
  }

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
              Departures for the selected period — confirm insurance held and record a custom payout
              (full or partial refund / damage retention).
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
                <th className="py-3 px-4">Checkout agent</th>
                <th className="py-3 px-4">Insurance</th>
                <th className="py-3 px-4">Refund status</th>
                <th className="py-3 px-4">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const insurance = Number(r.insurance) || 0;
                const status = String(r.insurance_refund_status || '').toLowerCase();
                const method = methodDrafts[r.id] || 'cash';
                const refundAmt = refundDrafts[r.id] ?? String(insurance);
                const damageAmt = damageDrafts[r.id] ?? '0';
                const isShort = (parseFloat(refundAmt) || 0) + 0.009 < insurance;
                const photos = photoDrafts[r.id] || [];
                return (
                  <tr key={r.id} className="border-b last:border-0 align-top">
                    <td className="py-4 px-4 whitespace-nowrap text-gray-600">
                      {formatOpsDay(r.check_out)}
                    </td>
                    <td className="py-4 px-4 min-w-[12rem]">
                      <div className="font-semibold text-gray-900">{r.guest_name || '—'}</div>
                      {r.guest_phone ? (
                        <div className="text-xs text-gray-500">{r.guest_phone}</div>
                      ) : null}
                      <ReservationContext row={r} />
                      <div className="mt-2 flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="btn-secondary text-[11px] px-2 py-1"
                          onClick={() => setHistoryRow(r)}
                          title="Stay history"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          className="btn-secondary text-[11px] px-2 py-1"
                          onClick={() => setCommentTarget({ row: r, kind: 'checkout' })}
                          title="Add checkout comment"
                        >
                          <MessageSquarePlus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                    <td className="py-4 px-4 min-w-[9rem]">
                      <div className="font-semibold text-gray-900">{r.unit_number || '—'}</div>
                      <div className="text-xs text-gray-500 truncate max-w-[10rem]">
                        {r.unit_title || r.project || ''}
                      </div>
                    </td>
                    <td className="py-4 px-4 min-w-[11rem]">
                      {canAssign ? (
                        <select
                          className="input text-xs py-1.5"
                          value={r.checkout_handler_id || ''}
                          disabled={assignMutation.isPending}
                          onChange={(e) => {
                            const staffId = e.target.value ? Number(e.target.value) : null;
                            if (r.checkout_handler_id && Number(r.checkout_handler_id) !== Number(staffId || 0)) {
                              setPendingAssign({ id: r.id, staff_id: staffId });
                              return;
                            }
                            assignMutation.mutate({ id: r.id, staff_id: staffId });
                          }}
                        >
                          <option value="">Unassigned</option>
                          {agents.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.full_name || a.username}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-gray-700">{r.checkout_handler_name || '—'}</span>
                      )}
                      {r.ops_assignee_name && r.checkout_handler_name !== r.ops_assignee_name ? (
                        <div className="mt-1 text-[11px] text-gray-500">Check-in: {r.ops_assignee_name}</div>
                      ) : null}
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
                          {r.insurance_damage_amount > 0 ? (
                            <div className="text-[11px] text-rose-700 tabular-nums">
                              Damage {currency(r.insurance_damage_amount)}
                            </div>
                          ) : null}
                          {r.insurance_refund_notes ? (
                            <div className="text-[11px] text-gray-600 max-w-[14rem] whitespace-pre-line">
                              {r.insurance_refund_notes}
                            </div>
                          ) : null}
                          {(r.insurance_damage_photo_urls || []).length ? (
                            <div className="flex flex-wrap gap-1 pt-1">
                              {r.insurance_damage_photo_urls.map((url) => (
                                <a key={url} href={url} target="_blank" rel="noreferrer">
                                  <img src={url} alt="Damage" className="h-10 w-10 rounded object-cover border" />
                                </a>
                              ))}
                            </div>
                          ) : null}
                          {r.insurance_damage_share_status ? (
                            <div className="text-[11px] text-indigo-700">
                              {SHARE_LABELS[r.insurance_damage_share_status] || r.insurance_damage_share_status}
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
                          Pending payout
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-4 px-4 min-w-[17rem]">
                      {r.can_refund_insurance ? (
                        <div className="space-y-2">
                          {refundingId === r.id ? (
                            <div className="space-y-2 rounded-lg border bg-gray-50 p-2.5">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-[10px] uppercase text-gray-500">
                                    Refund amount
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    className="input text-sm py-1.5"
                                    value={refundAmt}
                                    onChange={(e) =>
                                      onRefundAmountChange(r.id, insurance, e.target.value)
                                    }
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] uppercase text-gray-500">
                                    Damage kept
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    className="input text-sm py-1.5"
                                    value={damageAmt}
                                    onChange={(e) =>
                                      onDamageAmountChange(r.id, insurance, e.target.value)
                                    }
                                  />
                                </div>
                              </div>
                              <div>
                                <label className="text-[10px] uppercase text-gray-500">
                                  Payout method
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
                                {method === 'cash' && (parseFloat(refundAmt) || 0) > 0 ? (
                                  <p className="mt-1 text-[11px] text-amber-700">Recorded as cash out from petty cash.</p>
                                ) : null}
                              </div>
                              <div>
                                <label className="text-[10px] uppercase text-gray-500">
                                  {isShort ? 'Comment (required)' : 'Notes'}
                                </label>
                                <textarea
                                  className="input text-sm py-1.5 min-h-[3rem]"
                                  value={notesDrafts[r.id] || ''}
                                  onChange={(e) =>
                                    setNotesDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))
                                  }
                                  placeholder={isShort ? 'Why is part of the insurance kept?' : 'Optional'}
                                />
                              </div>
                              {isShort ? (
                                <>
                                  <ProofPicker
                                    label="Damage photos"
                                    required
                                    multiple
                                    accept="image/*"
                                    files={photos}
                                    onChange={(next) => setPhotoDrafts((prev) => ({ ...prev, [r.id]: next }))}
                                  />
                                  <label className="flex items-start gap-2 text-xs text-gray-700">
                                    <input
                                      type="checkbox"
                                      className="mt-0.5"
                                      checked={!!shareDrafts[r.id]}
                                      onChange={(e) =>
                                        setShareDrafts((prev) => ({ ...prev, [r.id]: e.target.checked }))
                                      }
                                    />
                                    <span>
                                      Share the damage photos with the owner
                                      {canAssign ? '' : ' (needs Operations Manager approval)'}
                                    </span>
                                  </label>
                                </>
                              ) : null}
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  className="btn-primary text-xs flex-1 justify-center"
                                  disabled={refundMutation.isPending}
                                  onClick={() => {
                                    const notes = String(notesDrafts[r.id] || '').trim();
                                    if (isShort && !notes) {
                                      toast.error('Add a comment explaining the kept amount');
                                      return;
                                    }
                                    if (isShort && !photos.length) {
                                      toast.error('Add at least one damage photo');
                                      return;
                                    }
                                    refundMutation.mutate({
                                      id: r.id,
                                      payment_method: method,
                                      refunded_amount: parseFloat(refundAmt) || 0,
                                      notes: notes || undefined,
                                      photos: isShort ? photos : [],
                                      share_with_owner: isShort && !!shareDrafts[r.id],
                                    });
                                  }}
                                >
                                  {refundMutation.isPending ? 'Saving…' : 'Confirm payout'}
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
                              onClick={() => openRefund(r)}
                            >
                              <LogOut className="w-3.5 h-3.5" />
                              Insurance payout
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
      <CheckinHistoryModal row={historyRow} onClose={() => setHistoryRow(null)} />
      <OpsCommentModal target={commentTarget} onClose={() => setCommentTarget(null)} />
      <ReassignReasonModal
        open={!!pendingAssign}
        busy={assignMutation.isPending}
        onClose={() => setPendingAssign(null)}
        onConfirm={(reason) => assignMutation.mutate({ ...pendingAssign, reason })}
        title="Change checkout agent"
      />
    </div>
  );
}

export default function OpsCheckoutsToday() {
  return <CheckoutsTodaySection />;
}
