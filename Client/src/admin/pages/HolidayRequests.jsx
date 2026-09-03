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
import { formatDate, formatDateTime } from '../utils/formatters';
import { LEAVE_TYPE_LABELS, requestableLeaveTypes, formatUnpaidLeaveAvailable, isExcuseLeaveType } from '../utils/hrPolicy';
import { useAuth } from '../context/AuthContext';
import { RequestReviewActions, approvalStatusClass, requestApprovalSummary } from '../components/RequestReviewActions';
import { acknowledgeRequest } from '../utils/requestAcknowledgements';

const EMPTY_FORM = {
  leave_type: 'casual',
  start_date: '',
  end_date: '',
  start_time: '',
  end_time: '',
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
  const isExcuse = isExcuseLeaveType(form.leave_type);
  return (
    <div className="card space-y-3">
      <h3 className="font-semibold text-soul-blue">Request a holiday</h3>
      {leaveSnap && !leaveSnap.can_request_holidays ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          Paid holidays (casual, annual) open after 6 months, or when HR grants access.
          Unpaid leave and excuses (no approval) can be requested now.
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
            <div className="text-[10px] uppercase text-soul-muted">Paid excuses</div>
            <div className="font-semibold text-soul-blue">
              {leaveSnap.paid_excuse_remaining ?? leaveSnap.early_leave_remaining}/
              {leaveSnap.paid_excuse_max ?? leaveSnap.early_leave_max}
            </div>
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Type</label>
          <select
            className="input"
            value={form.leave_type}
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
          <label className="label">{isExcuse ? 'Day' : 'From'}</label>
          <input
            type="date"
            className="input"
            value={form.start_date}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                start_date: e.target.value,
                end_date:
                  isExcuseLeaveType(f.leave_type) || !f.end_date || f.end_date < e.target.value
                    ? e.target.value
                    : f.end_date,
              }))
            }
          />
        </div>
        {isExcuse ? (
          <>
            <div>
              <label className="label">From time *</label>
              <input
                type="time"
                className="input"
                value={form.start_time}
                onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">To time *</label>
              <input
                type="time"
                className="input"
                value={form.end_time}
                onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
              />
              <p className="mt-1 text-[11px] text-slate-400">
                {form.leave_type === 'paid_excuse'
                  ? 'Paid excuse: max 2 hours, 2 per month, no deduction.'
                  : 'Unpaid excuse: hours × hourly rate (daily rate ÷ 24).'}
              </p>
            </div>
          </>
        ) : (
          <div>
            <label className="label">To</label>
            <input
              type="date"
              className="input"
              value={form.end_date}
              onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
            />
          </div>
        )}
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
        {createMutation.isPending ? 'Sending…' : isExcuse ? 'Record excuse' : 'Send request'}
      </button>
    </div>
  );
}

function DetailField({ label, children }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-soul-muted">{label}</div>
      <div className="mt-1 text-sm text-soul-blue">{children}</div>
    </div>
  );
}

function HolidayRequestDetailModal({
  row,
  incoming,
  onClose,
  reviewMutation,
  onReject,
}) {
  if (!row) return null;

  const dateLabel =
    row.start_date === row.end_date
      ? formatDate(row.start_date)
      : `${formatDate(row.start_date)} → ${formatDate(row.end_date)}`;
  const isExcuse = isExcuseLeaveType(row.leave_type);
  const timeLabel =
    row.start_time && row.end_time
      ? `${String(row.start_time).slice(0, 5)} – ${String(row.end_time).slice(0, 5)}`
      : null;

  return (
    <Modal
      open={!!row}
      onClose={onClose}
      title="Holiday request details"
      size="md"
      footer={
        incoming && row.status === 'pending' && (row.can_review_slots || []).length ? (
          <div className="flex w-full justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Close
            </button>
            <RequestReviewActions
              row={row}
              pending={reviewMutation.isPending}
              onApprove={(item) => reviewMutation.mutate({ id: item.id, status: 'approved' })}
              onReject={onReject}
            />
          </div>
        ) : (
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        )
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-soul-blue">{row.full_name || 'Staff member'}</div>
            <div className="text-sm text-soul-muted">
              {row.staff_code ? `${row.staff_code} · ` : ''}
              {ROLE_LABELS[row.role] || row.role}
            </div>
          </div>
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${approvalStatusClass(row.status)}`}
          >
            {row.approval_label || row.status}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DetailField label="Leave type">
            {LEAVE_TYPE_LABELS[row.leave_type] || row.leave_type}
          </DetailField>
          <DetailField label="Duration">
            {isExcuse
              ? `${Number(row.hours) || '—'} hour${Number(row.hours) === 1 ? '' : 's'}`
              : `${row.days} day${Number(row.days) === 1 ? '' : 's'}`}
          </DetailField>
          <DetailField label="Dates">{dateLabel}</DetailField>
          {timeLabel ? <DetailField label="Time">{timeLabel}</DetailField> : null}
          <DetailField label="Submitted">
            {row.created_at ? formatDateTime(row.created_at) : '—'}
          </DetailField>
          {row.manager_name ? (
            <DetailField label="Line manager">{row.manager_name}</DetailField>
          ) : null}
          <DetailField label="Approval">{requestApprovalSummary(row)}</DetailField>
        </div>

        <DetailField label="Reason">{row.reason?.trim() ? row.reason : '—'}</DetailField>

        {row.review_note ? (
          <DetailField label="Review note">{row.review_note}</DetailField>
        ) : null}

        {!incoming && row.status === 'pending' ? (
          <p className="text-sm text-soul-muted bg-soul-surface rounded-xl px-3 py-2">
            {requestApprovalSummary(row)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function RequestsTable({ rows, incoming, reviewMutation, onReject, onSelect }) {
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
              <tr
                key={r.id}
                className="cursor-pointer hover:bg-soul-surface/70"
                onClick={() => onSelect(r)}
              >
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
                    {isExcuseLeaveType(r.leave_type)
                      ? `${r.start_time ? String(r.start_time).slice(0, 5) : '—'}–${
                          r.end_time ? String(r.end_time).slice(0, 5) : '—'
                        } · ${Number(r.hours) || '—'}h`
                      : `${r.days} day${Number(r.days) === 1 ? '' : 's'}`}
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
                  <td onClick={(e) => e.stopPropagation()}>
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
  const [detailRow, setDetailRow] = useState(null);
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
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests'] });
      qc.invalidateQueries({ queryKey: ['hr-my-leave'] });
      toast.success(
        isExcuseLeaveType(vars?.leave_type)
          ? 'Excuse recorded (no approval needed)'
          : 'Holiday request sent'
      );
      setForm({
        leave_type: leaveSnap?.can_request_holidays === false ? 'paid_excuse' : 'casual',
        start_date: '',
        end_date: '',
        start_time: '',
        end_time: '',
        reason: '',
      });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not submit request'),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, status: next, review_note }) =>
      api.post(`/hr/leave-requests/${id}/review`, { status: next, review_note }),
    onSuccess: (_, vars) => {
      if (user?.id && vars?.id) acknowledgeRequest('leave', vars.id, user.id);
      qc.invalidateQueries({ queryKey: ['hr-leave-requests'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['hr-attendance'] });
      toast.success(vars.status === 'approved' ? 'Acceptance recorded' : 'Request rejected');
      setRejectRow(null);
      setDetailRow(null);
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

  const openLeaveDetail = (row) => {
    if (activeView === 'incoming' && row?.id && user?.id && (row.can_review_slots || []).length) {
      acknowledgeRequest('leave', row.id, user.id);
    }
    setDetailRow(row);
  };

  const submitLeave = () => {
    const leaveType =
      leaveSnap?.can_request_holidays === false && !isExcuseLeaveType(form.leave_type)
        ? 'unpaid'
        : form.leave_type;
    if (!form.start_date) {
      toast.error('Choose a date');
      return;
    }
    if (isExcuseLeaveType(leaveType)) {
      if (!form.start_time || !form.end_time) {
        toast.error('Choose start and end times');
        return;
      }
      createMutation.mutate({
        ...form,
        leave_type: leaveType,
        end_date: form.start_date,
        start_time: form.start_time,
        end_time: form.end_time,
      });
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
          onSelect={openLeaveDetail}
          onReject={(row) => {
            setRejectRow(row);
            setNote('');
          }}
        />
      )}

      <HolidayRequestDetailModal
        row={detailRow}
        incoming={activeView === 'incoming'}
        onClose={() => setDetailRow(null)}
        reviewMutation={reviewMutation}
        onReject={(row) => {
          setDetailRow(null);
          setRejectRow(row);
          setNote('');
        }}
      />

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
