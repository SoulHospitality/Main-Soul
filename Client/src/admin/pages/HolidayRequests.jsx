import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, Palmtree, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Modal from '../components/ui/Modal';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import { ROLE_LABELS, canRequestStaffBenefits, canSeeRequestQueue } from '../utils/permissions';
import { formatDate } from '../utils/formatters';
import { LEAVE_TYPE_LABELS, requestableLeaveTypes, formatUnpaidLeaveAvailable } from '../utils/hrPolicy';
import { useAuth } from '../context/AuthContext';
import { RequestReviewActions, approvalStatusClass } from '../components/RequestReviewActions';

const EMPTY_FORM = {
  leave_type: 'casual',
  start_date: '',
  end_date: '',
  reason: '',
};

const STATUS_TABS = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All' },
];

function StatusFilter({ status, onChange }) {
  return (
    <div className="flex rounded-xl border border-soul-line bg-white p-0.5">
      {STATUS_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
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
  );
}

function RequestForm({ leaveSnap, form, setForm, createMutation, onSubmit }) {
  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-soul-blue">Request a holiday</h3>
      {leaveSnap && !leaveSnap.can_request_holidays ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          Paid holidays (casual, annual, early leave) open after 6 months, or when HR grants access.
          Unpaid leave can be requested now.
          {leaveSnap.tenure_months != null ? ` Current tenure: ${leaveSnap.tenure_months} months.` : ''}
        </p>
      ) : null}
      {leaveSnap ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <div className="rounded-xl border border-soul-line px-2 py-2">
            <div className="text-[10px] uppercase text-soul-muted">Casual</div>
            <div className="font-semibold text-soul-blue">{leaveSnap.casual_available}</div>
          </div>
          <div className="rounded-xl border border-soul-line px-2 py-2">
            <div className="text-[10px] uppercase text-soul-muted">Annual</div>
            <div className="font-semibold text-soul-blue">{leaveSnap.annual_available}</div>
          </div>
          <div className="rounded-xl border border-soul-line px-2 py-2">
            <div className="text-[10px] uppercase text-soul-muted">Unpaid</div>
            <div className="font-semibold text-soul-blue">{formatUnpaidLeaveAvailable(leaveSnap)}</div>
          </div>
          <div className="rounded-xl border border-soul-line px-2 py-2">
            <div className="text-[10px] uppercase text-soul-muted">Early leave</div>
            <div className="font-semibold text-soul-blue">
              {leaveSnap.early_leave_remaining}/{leaveSnap.early_leave_max}
            </div>
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Type</label>
          <select
            className="input"
            value={leaveSnap?.can_request_holidays === false ? 'unpaid' : form.leave_type}
            onChange={(e) => setForm((f) => ({ ...f, leave_type: e.target.value }))}
          >
            {requestableLeaveTypes(leaveSnap?.can_request_holidays !== false).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
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
        onClick={onSubmit}
      >
        {createMutation.isPending ? 'Sending…' : 'Send request'}
      </button>
    </div>
  );
}

function RequestsTable({ rows, incoming, reviewMutation, onReject }) {
  return (
    <div className="card p-0">
      <div className="table-wrapper">
        <table className="table text-sm">
          <thead>
            <tr>
              {incoming ? <th>Staff</th> : null}
              <th>Type</th>
              <th>Dates</th>
              <th>Reason</th>
              <th>Status</th>
              {incoming ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {incoming ? (
                  <td>
                    <div className="font-semibold text-soul-blue">{r.full_name}</div>
                    <div className="text-[11px] text-soul-muted">
                      {r.staff_code ? `${r.staff_code} · ` : ''}
                      {ROLE_LABELS[r.role] || r.role}
                    </div>
                  </td>
                ) : null}
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
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${approvalStatusClass(r.status)}`}
                  >
                    {r.approval_label || r.status}
                  </span>
                </td>
                {incoming ? (
                  <td>
                    <RequestReviewActions
                      row={r}
                      pending={reviewMutation.isPending}
                      onApprove={(row) => reviewMutation.mutate({ id: row.id, status: 'approved' })}
                      onReject={onReject}
                    />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function HolidayRequests() {
  const { user } = useAuth();
  const canQueue = canSeeRequestQueue(user);
  const canRequest = canRequestStaffBenefits(user);
  const showMineTab = canRequest;
  const showIncomingTab = canQueue;
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultView = showMineTab ? 'mine' : 'incoming';
  const rawView = searchParams.get('view') || defaultView;
  const activeView =
    rawView === 'incoming' && showIncomingTab
      ? 'incoming'
      : rawView === 'mine' && showMineTab
        ? 'mine'
        : defaultView;
  const [status, setStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [rejectRow, setRejectRow] = useState(null);
  const [note, setNote] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);

  function setView(id) {
    setSearchParams({ view: id }, { replace: true });
  }

  const { data: mineRows = [], isLoading: mineLoading } = useQuery({
    queryKey: ['hr-leave-requests', 'mine', status],
    queryFn: () =>
      api
        .get('/hr/leave-requests', {
          params: {
            mine: 1,
            ...(status === 'all' ? {} : { status }),
          },
        })
        .then((r) => r.data),
    enabled: showMineTab && activeView === 'mine',
  });

  const { data: incomingRows = [], isLoading: incomingLoading } = useQuery({
    queryKey: ['hr-leave-requests', 'incoming', status],
    queryFn: () =>
      api
        .get('/hr/leave-requests', {
          params: {
            ...(status === 'all' ? {} : { status }),
          },
        })
        .then((r) => r.data),
    enabled: showIncomingTab && activeView === 'incoming',
  });

  const { data: leaveSnap } = useQuery({
    queryKey: ['hr-my-leave'],
    queryFn: () => api.get('/hr/my-leave').then((r) => r.data),
    enabled: canRequest && activeView === 'mine',
  });

  const createMutation = useMutation({
    mutationFn: (payload) => api.post('/hr/leave-requests', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests'] });
      qc.invalidateQueries({ queryKey: ['hr-my-leave'] });
      toast.success('Holiday request sent');
      setForm({
        leave_type: leaveSnap?.can_request_holidays === false ? 'unpaid' : 'casual',
        start_date: '',
        end_date: '',
        reason: '',
      });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not submit request'),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, status: next, review_note }) =>
      api.post(`/hr/leave-requests/${id}/review`, { status: next, review_note }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['hr-attendance'] });
      toast.success(vars.status === 'approved' ? 'Acceptance recorded' : 'Request rejected');
      setRejectRow(null);
      setNote('');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not update request'),
  });

  const q = search.trim().toLowerCase();
  const activeRows = activeView === 'mine' ? mineRows : incomingRows;
  const filtered = useMemo(() => {
    const list = (Array.isArray(activeRows) ? activeRows : []).filter((r) => {
      if (activeView === 'incoming' && String(r.staff_user_id) === String(user?.id)) return false;
      if (!q) return true;
      return [r.full_name, r.staff_code, r.reason, LEAVE_TYPE_LABELS[r.leave_type]]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
    return list;
  }, [activeRows, activeView, q, user?.id]);

  const submitLeave = () => {
    const leaveType = leaveSnap?.can_request_holidays === false ? 'unpaid' : form.leave_type;
    if (!form.start_date) {
      toast.error('Choose a date');
      return;
    }
    if (leaveType === 'early_leave') {
      createMutation.mutate({ ...form, leave_type: leaveType, end_date: form.start_date });
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
    createMutation.mutate({ ...form, leave_type: leaveType });
  };

  const isLoading = activeView === 'mine' ? mineLoading : incomingLoading;
  const pageTabs = [
    showMineTab ? { id: 'mine', label: 'My request', icon: Send } : null,
    showIncomingTab ? { id: 'incoming', label: 'Incoming requests', icon: Inbox } : null,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="page-header">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-soul-muted">HR</p>
        <h1 className="page-title mt-1">Holiday requests</h1>
        <p className="page-subtitle">
          {activeView === 'incoming'
            ? 'Review holiday requests from your team. CEOs can accept or reject any request.'
            : 'Casual: same day before 11:00 AM (no deduction). Annual: before the shift day; 3+ days need 7 days notice. Unpaid: unlimited (1× daily rate). No show: 2× daily rate.'}
        </p>
      </div>

      {pageTabs.length > 1 ? (
        <div className="flex flex-wrap gap-1 p-1 bg-gray-100 rounded-xl w-fit">
          {pageTabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeView === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setView(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-white text-soul-blue shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {activeView === 'mine' && showMineTab ? (
        <RequestForm
          leaveSnap={leaveSnap}
          form={form}
          setForm={setForm}
          createMutation={createMutation}
          onSubmit={submitLeave}
        />
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchFilter
          value={search}
          onChange={setSearch}
          placeholder={activeView === 'incoming' ? 'Search team requests…' : 'Search my requests…'}
        />
        <StatusFilter status={status} onChange={setStatus} />
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={activeView === 'incoming' ? Inbox : Palmtree}
          title={
            activeView === 'incoming'
              ? 'No incoming holiday requests in this view'
              : 'No holiday requests in this view'
          }
        />
      ) : (
        <RequestsTable
          rows={filtered}
          incoming={activeView === 'incoming'}
          reviewMutation={reviewMutation}
          onReject={(row) => {
            setRejectRow(row);
            setNote('');
          }}
        />
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
