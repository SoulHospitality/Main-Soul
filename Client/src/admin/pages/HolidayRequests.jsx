import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Palmtree, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Modal from '../components/ui/Modal';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import { ROLE_LABELS } from '../utils/permissions';
import { formatDate } from '../utils/formatters';
import { LEAVE_TYPE_LABELS } from '../utils/hrPolicy';

export default function HolidayRequests() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [rejectRow, setRejectRow] = useState(null);
  const [note, setNote] = useState('');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['hr-leave-requests', status],
    queryFn: () =>
      api
        .get('/hr/leave-requests', { params: status === 'all' ? undefined : { status } })
        .then((r) => r.data),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, status: next, review_note }) =>
      api.post(`/hr/leave-requests/${id}/review`, { status: next, review_note }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(vars.status === 'approved' ? 'Request approved' : 'Request rejected');
      setRejectRow(null);
      setNote('');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not update request'),
  });

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      (Array.isArray(rows) ? rows : []).filter((r) => {
        if (!q) return true;
        return [r.full_name, r.staff_code, r.reason, LEAVE_TYPE_LABELS[r.leave_type]]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q);
      }),
    [rows, q]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="page-header mb-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-soul-muted">HR</p>
          <h1 className="page-title mt-1">Holiday requests</h1>
          <p className="page-subtitle">
            Review casual, annual, and early-leave requests. Approve or reject each one.
          </p>
        </div>
        <div className="flex rounded-xl border border-soul-line bg-white p-0.5">
          {[
            { id: 'pending', label: 'Pending' },
            { id: 'approved', label: 'Approved' },
            { id: 'rejected', label: 'Rejected' },
            { id: 'all', label: 'All' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatus(tab.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                status === tab.id
                  ? 'bg-[var(--pms-accent,#283f5e)] text-white'
                  : 'text-soul-muted hover:text-soul-blue'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <SearchFilter value={search} onChange={setSearch} placeholder="Search requests…" />

      {isLoading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Palmtree} title="No holiday requests in this view" />
      ) : (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Type</th>
                  <th>Dates</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="font-semibold text-soul-blue">{r.full_name}</div>
                      <div className="text-[11px] text-soul-muted">
                        {r.staff_code ? `${r.staff_code} · ` : ''}
                        {ROLE_LABELS[r.role] || r.role}
                      </div>
                    </td>
                    <td>{LEAVE_TYPE_LABELS[r.leave_type] || r.leave_type}</td>
                    <td className="whitespace-nowrap">
                      {formatDate(r.start_date)}
                      {r.start_date !== r.end_date ? ` → ${formatDate(r.end_date)}` : ''}
                      <div className="text-[11px] text-soul-muted">
                        {r.days} day{Number(r.days) === 1 ? '' : 's'}
                      </div>
                    </td>
                    <td className="max-w-[16rem]">
                      <span className="line-clamp-2">{r.reason || '—'}</span>
                      {r.review_note ? (
                        <span className="block text-[11px] text-soul-muted mt-1">Note: {r.review_note}</span>
                      ) : null}
                    </td>
                    <td>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                          r.status === 'approved'
                            ? 'bg-emerald-50 text-emerald-700'
                            : r.status === 'rejected'
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-amber-50 text-amber-800'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td>
                      {r.status === 'pending' ? (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            className="btn-secondary text-xs px-2 py-1 text-emerald-700"
                            disabled={reviewMutation.isPending}
                            onClick={() => reviewMutation.mutate({ id: r.id, status: 'approved' })}
                          >
                            <Check className="h-3.5 w-3.5" />
                            Accept
                          </button>
                          <button
                            type="button"
                            className="btn-secondary text-xs px-2 py-1 text-rose-700"
                            onClick={() => {
                              setRejectRow(r);
                              setNote('');
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                            Reject
                          </button>
                        </div>
                      ) : r.reviewed_by_name ? (
                        <span className="text-[11px] text-soul-muted">{r.reviewed_by_name}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={!!rejectRow}
        onClose={() => setRejectRow(null)}
        title="Reject request"
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setRejectRow(null)}>Cancel</button>
            <button
              type="button"
              className="btn-danger"
              disabled={reviewMutation.isPending}
              onClick={() =>
                reviewMutation.mutate({
                  id: rejectRow.id,
                  status: 'rejected',
                  review_note: note.trim() || undefined,
                })
              }
            >
              Reject
            </button>
          </>
        }
      >
        <p className="text-sm text-soul-muted mb-3">
          Reject {rejectRow?.full_name}’s {LEAVE_TYPE_LABELS[rejectRow?.leave_type] || 'leave'} request
          {rejectRow ? ` (${formatDate(rejectRow.start_date)})` : ''}?
        </p>
        <label className="label">Note (optional)</label>
        <textarea
          className="input min-h-[80px]"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason for rejection"
        />
      </Modal>
    </div>
  );
}
