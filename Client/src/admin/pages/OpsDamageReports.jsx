import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { useAuth } from '../context/AuthContext';
import { currency, formatDateTime } from '../utils/formatters';
import { formatOpsDay } from '../components/OpsDateRangeFilter';

const STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-slate-100 text-slate-700',
};

export function DamageReportsSection() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canReview = user?.role === 'admin' || user?.role === 'operations_supervisor';
  const [status, setStatus] = useState(canReview ? 'pending' : 'approved');

  const { data: rows = [], isLoading, isError, error } = useQuery({
    queryKey: ['ops-insurance-damages', status],
    queryFn: async () => {
      const r = await api.get('/ops/insurance-damages', { params: { status } });
      return Array.isArray(r.data) ? r.data : [];
    },
  });

  const review = useMutation({
    mutationFn: ({ id, decision }) => api.post(`/ops/insurance-damages/${id}/share`, { decision }),
    onSuccess: (_r, vars) => {
      toast.success(vars.decision === 'approved' ? 'Shared with Owner Experience' : 'Not shared');
      qc.invalidateQueries({ queryKey: ['ops-insurance-damages'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not update'),
  });

  return (
    <div className="space-y-4">
      {canReview ? (
        <div className="flex flex-wrap gap-1 p-1 bg-gray-100 rounded-xl w-fit">
          {['pending', 'approved', 'rejected', 'all'].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize ${
                status === s ? 'bg-white text-soul-blue shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {s === 'pending' ? 'Waiting approval' : s}
            </button>
          ))}
        </div>
      ) : null}

      {isLoading ? (
        <LoadingSpinner />
      ) : isError ? (
        <div className="card p-8 text-center text-sm text-red-600">
          {error?.response?.data?.error || 'Could not load damage reports'}
        </div>
      ) : !rows.length ? (
        <div className="card p-8 text-center text-sm text-gray-500">No damage reports.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <div key={r.id} className="card p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-gray-900">
                    {r.unit_number || r.unit_title} · {r.guest_name}
                  </div>
                  <div className="text-xs text-gray-500">
                    Checkout {formatOpsDay(r.check_out)}
                    {r.insurance_refunded_at ? ` · reported ${formatDateTime(r.insurance_refunded_at)}` : ''}
                    {r.insurance_refunded_by_name ? ` by ${r.insurance_refunded_by_name}` : ''}
                  </div>
                </div>
                {r.insurance_damage_share_status ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${
                      STATUS_STYLES[r.insurance_damage_share_status] || 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {r.insurance_damage_share_status}
                  </span>
                ) : (
                  <span className="rounded-full px-2 py-0.5 text-[11px] bg-gray-100 text-gray-600">Internal</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-gray-500">Insurance</div>
                  <div className="font-semibold tabular-nums">{currency(r.insurance)}</div>
                </div>
                <div>
                  <div className="text-gray-500">Refunded</div>
                  <div className="font-semibold tabular-nums">{currency(r.insurance_refunded_amount)}</div>
                </div>
                <div>
                  <div className="text-gray-500">Damage</div>
                  <div className="font-semibold tabular-nums text-rose-700">{currency(r.insurance_damage_amount)}</div>
                </div>
              </div>
              {r.insurance_refund_notes ? (
                <p className="text-sm text-gray-700 whitespace-pre-line">{r.insurance_refund_notes}</p>
              ) : null}
              {(r.insurance_damage_photo_urls || []).length ? (
                <div className="flex flex-wrap gap-2">
                  {r.insurance_damage_photo_urls.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer">
                      <img src={url} alt="Damage" className="h-20 w-20 rounded-lg object-cover border" />
                    </a>
                  ))}
                </div>
              ) : null}
              {canReview && r.insurance_damage_share_status !== 'approved' ? (
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    disabled={review.isPending}
                    onClick={() => review.mutate({ id: r.id, decision: 'approved' })}
                  >
                    Share with Owner Experience
                  </button>
                  {r.insurance_damage_share_status === 'pending' ? (
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      disabled={review.isPending}
                      onClick={() => review.mutate({ id: r.id, decision: 'rejected' })}
                    >
                      Don&apos;t share
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OpsDamageReports() {
  return (
    <div className="space-y-6">
      <div className="page-header mb-0">
        <h1 className="page-title">Damage reports</h1>
        <p className="page-subtitle">Insurance damage photos approved by the Operations Manager</p>
      </div>
      <DamageReportsSection />
    </div>
  );
}
