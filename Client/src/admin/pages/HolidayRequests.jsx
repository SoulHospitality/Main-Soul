import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Palmtree, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Modal from '../components/ui/Modal';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import { ROLE_LABELS, canAccess } from '../utils/permissions';
import { formatDate } from '../utils/formatters';
import { LEAVE_TYPE_LABELS } from '../utils/hrPolicy';
import { useAuth } from '../context/AuthContext';

const EMPTY_FORM = {
  leave_type: 'casual',
  start_date: '',
  end_date: '',
  reason: '',
};

export default function HolidayRequests() {
  const { user } = useAuth();
  const isHr = canAccess(user, 'payroll');
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();
  const [status, setStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [rejectRow, setRejectRow] = useState(null);
  const [note, setNote] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['hr-leave-requests', status, isHr],
    queryFn: () =>
      api
        .get('/hr/leave-requests', {
          params: {
            ...(status === 'all' ? {} : { status }),
            ...(!isHr ? { mine: 1 } : {}),
          },
        })
        .then((r) => r.data),
  });

  const { data: leaveSnap } = useQuery({
    queryKey: ['hr-my-leave'],
    queryFn: () => api.get('/hr/my-leave').then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (payload) => api.post('/hr/leave-requests', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests'] });
      qc.invalidateQueries({ queryKey: ['hr-my-leave'] });
      toast.success('Holiday request sent to HR');
      setForm(EMPTY_FORM);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not submit request'),
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

  const submitLeave = () => {
    if (!form.start_date) {
      toast.error('Choose a date');
      return;
    }
    if (form.leave_type === 'early_leave') {
      createMutation.mutate({ ...form, end_date: form.start_date });
      return;
    }
    if (!form.end_date) {
      toast.error('Choose start and end dates');
      return;
    }
    if (form.end_date < form.start_date) {
      toast.error('End date must be on or after the start date');
      return;
    }
    createMutation.mutate(form);
  };

  const canReview = (row) =>
    isHr && (isAdmin || String(user?.id) !== String(row.staff_user_id));

  return (
    <div className="space-y-6">
      <div className="page-header">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-soul-muted">HR</p>
        <h1 className="page-title mt-1">Holiday requests</h1>
        <p className="page-subtitle">
          {isHr
            ? 'Review casual, annual, and early-leave requests. Approve or reject each one.'
            : 'Request casual, annual, or early leave. HR will review each request.'}
        </p>
      </div>

      <div className="card space-y-3">
        <h3 className="font-semibold text-soul-blue">Request a holiday</h3>
        {leaveSnap && !leaveSnap.can_request_holidays ? (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
            Holiday requests open automatically after 6 months, or when HR grants access.
            {leaveSnap.tenure_months != null ? ` Current tenure: ${leaveSnap.tenure_months} months.` : ''}
          </p>
        ) : null}
        {leaveSnap ? (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-soul-line px-2 py-2">
              <div className="text-[10px] uppercase text-soul-muted">Casual</div>
              <div className="font-semibold text-soul-blue">{leaveSnap.casual_available}</div>
            </div>
            <div className="rounded-xl border border-soul-line px-2 py-2">
              <div className="text-[10px] uppercase text-soul-muted">Annual</div>
              <div className="font-semibold text-soul-blue">{leaveSnap.annual_available}</div>
            </div>
            <div className="rounded-xl border border-soul-line px-2 py-2">
              <div className="text-[10px] uppercase text-soul-muted">Early leave</div>
              <div className="font-semibold text-soul-blue">
                {leaveSnap.early_leave_remaining}/{leaveSnap.early_leave_max}
              </div>
            </div>
          </div>
        ) : null}
        {leaveSnap?.can_request_holidays !== false ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Type</label>
                <select
                  className="input"
                  value={form.leave_type}
                  onChange={(e) => setForm((f) => ({ ...f, leave_type: e.target.value }))}
                >
                  <option value="casual">Casual</option>
                  <option value="annual">Annual</option>
                  <option value="early_leave">Early leave</option>
                </select>
              </div>
              <div>
                <label className="label">{form.leave_type === 'early_leave' ? 'Day' : 'From'}</label>
                <input
                  type="date"
                  className="input"
                  value={form.start_date}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      start_date: e.target.value,
                      end_date:
                        f.leave_type === 'early_leave' || !f.end_date || f.end_date < e.target.value
                          ? e.target.value
                          : f.end_date,
                    }))
                  }
                />
              </div>
              {form.leave_type !== 'early_leave' ? (
                <div>
                  <label className="label">To</label>
                  <input
                    type="date"
                    className="input"
                    value={form.end_date}
                    onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
                  />
                </div>
              ) : null}
              <div className="sm:col-span-2">
                <label className="label">Note</label>
                <textarea
                  className="input min-h-[72px]"
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={createMutation.isPending}
              onClick={submitLeave}
            >
              {createMutation.isPending ? 'Sending…' : 'Send request'}
            </button>
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchFilter value={search} onChange={setSearch} placeholder="Search requests…" />
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
                  {isHr ? <th /> : null}
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
                    {isHr ? (
                      <td>
                        {r.status === 'pending' ? (
                          canReview(r) ? (
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
                          ) : (
                            <span className="text-[11px] text-soul-muted">Admin must review your request</span>
                          )
                        ) : r.reviewed_by_name ? (
                          <span className="text-[11px] text-soul-muted">{r.reviewed_by_name}</span>
                        ) : null}
                      </td>
                    ) : null}
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
            <button type="button" className="btn-secondary" onClick={() => setRejectRow(null)}>
              Cancel
            </button>
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
