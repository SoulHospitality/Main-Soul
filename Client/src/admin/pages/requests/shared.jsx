import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Briefcase, Check, Clock, Home, Palmtree, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import Modal from '../../components/ui/Modal';
import { ROLE_LABELS } from '../../utils/permissions';
import { currency, formatDateTime } from '../../utils/formatters';
import { LEAVE_TYPE_LABELS, isTimedLeaveType } from '../../utils/hrPolicy';
import { invalidateRequestQueries } from '../../hooks/useLiveNotifications';

export const CATEGORY = {
  holiday: { label: 'Holiday', icon: Palmtree, chip: 'bg-sky-50 text-sky-800 border-sky-200', dot: 'bg-sky-500' },
  excuse: { label: 'Excuse', icon: Clock, chip: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500' },
  mission: { label: 'Mission', icon: Briefcase, chip: 'bg-violet-50 text-violet-800 border-violet-200', dot: 'bg-violet-500' },
  wfh: { label: 'Work from home', icon: Home, chip: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  loan: { label: 'Loan', icon: Banknote, chip: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-500' },
};

export const KIND_ENDPOINT = { leave: '/hr/leave-requests', wfh: '/hr/wfh', loan: '/hr/loans' };
const KIND_QUERY = { leave: 'hr-leave-requests', wfh: 'hr-wfh', loan: 'hr-loans' };

export function categoryOf(kind, leaveType) {
  if (kind === 'wfh') return 'wfh';
  if (kind === 'loan') return 'loan';
  const t = String(leaveType || '');
  if (t === 'paid_excuse' || t === 'unpaid_excuse' || t === 'early_leave' || t === 'excuse') return 'excuse';
  if (t === 'mission') return 'mission';
  return 'holiday';
}

export function shiftIso(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayLabel(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!iso) return '';
  return new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
}

export function cairoToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

const hhmm = (t) => (t ? String(t).slice(0, 5) : '');

export function requestTitle(item) {
  const { kind, row } = item;
  if (kind === 'loan') return 'Loan';
  if (kind === 'wfh') return 'Work from home';
  return LEAVE_TYPE_LABELS[row.leave_type] || 'Leave';
}

export function requestWhen(item) {
  const { kind, row } = item;
  if (kind === 'loan') return currency(row.amount);
  if (kind === 'wfh') return dayLabel(row.work_date);
  const start = String(row.start_date || '').slice(0, 10);
  const end = String(row.end_date || start).slice(0, 10);
  if (isTimedLeaveType(row.leave_type)) {
    return `${dayLabel(start)} · ${hhmm(row.start_time)}–${hhmm(row.end_time)}${row.hours ? ` (${Number(row.hours)}h)` : ''}`;
  }
  if (start === end) return dayLabel(start);
  return `${dayLabel(start)} – ${dayLabel(end)} · ${row.days} day${Number(row.days) === 1 ? '' : 's'}`;
}

/** The date a request is about (for sorting and "upcoming"). */
export function requestDate(item) {
  const { kind, row } = item;
  if (kind === 'loan') return String(row.created_at || '').slice(0, 10);
  if (kind === 'wfh') return String(row.work_date || '').slice(0, 10);
  return String(row.start_date || '').slice(0, 10);
}

export function toItems(kind, rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    key: `${kind}:${row.id}`,
    kind,
    id: row.id,
    category: categoryOf(kind, row.leave_type),
    row,
  }));
}

/** Holiday, WFH and loan lists merged into one list (each list keeps its own cache key). */
export function useRequestLists({ user, mine, enabled = true }) {
  const scope = mine ? 'mine' : 'incoming';
  const params = mine ? { mine: 1 } : {};
  const make = (kind) => ({
    queryKey: [KIND_QUERY[kind], user?.id, scope, 'all'],
    queryFn: () => api.get(KIND_ENDPOINT[kind], { params }).then((r) => r.data),
    enabled: Boolean(enabled && user?.id),
  });
  const leave = useQuery(make('leave'));
  const wfh = useQuery(make('wfh'));
  const loan = useQuery(make('loan'));
  const items = [...toItems('leave', leave.data), ...toItems('wfh', wfh.data), ...toItems('loan', loan.data)];
  return { items, isLoading: leave.isLoading || wfh.isLoading || loan.isLoading };
}

export function StatusPill({ row }) {
  const s = row.status;
  const cls =
    s === 'approved'
      ? 'bg-emerald-50 text-emerald-700'
      : s === 'rejected'
        ? 'bg-rose-50 text-rose-700'
        : 'bg-amber-50 text-amber-800';
  return (
    <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {s === 'pending' ? row.approval_label || 'Pending' : s === 'approved' ? 'Approved' : 'Rejected'}
    </span>
  );
}

export function CategoryIcon({ category, size = 'h-9 w-9' }) {
  const meta = CATEGORY[category] || CATEGORY.holiday;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex ${size} shrink-0 items-center justify-center rounded-xl border ${meta.chip}`}>
      <Icon className="h-4 w-4" />
    </span>
  );
}

/** Manager → HR Manager → Financial Manager, with who accepted each step. */
export function approvalSteps(item) {
  const { kind, row } = item;
  const steps = [];
  if (row.needs_manager_approval !== false) {
    steps.push({ key: 'manager', label: 'Manager', by: row.manager_reviewed_by, name: row.manager_reviewed_by_name });
  }
  if (row.needs_hr_approval !== false) {
    steps.push({ key: 'hr', label: 'HR Manager', by: row.hr_reviewed_by, name: row.hr_reviewed_by_name });
  }
  if (kind === 'loan' && row.needs_finance_approval !== false) {
    steps.push({ key: 'finance', label: 'Financial Manager', by: row.finance_reviewed_by, name: row.finance_reviewed_by_name });
  }
  return steps;
}

export function ApprovalSteps({ item }) {
  const { row } = item;
  const steps = approvalSteps(item);
  if (!steps.length) return null;
  const rejected = row.status === 'rejected';
  let waitingShown = false;
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[11px]">
      {steps.map((step, i) => {
        const done = Boolean(step.by) && !rejected;
        const wasRejecter = rejected && step.by && String(step.by) === String(row.reviewed_by);
        const waiting = !done && !rejected && !waitingShown;
        if (waiting) waitingShown = true;
        const cls = done
          ? 'bg-emerald-50 text-emerald-700'
          : wasRejecter
            ? 'bg-rose-50 text-rose-700'
            : waiting
              ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
              : 'bg-slate-50 text-slate-400';
        return (
          <li key={step.key} className="flex items-center gap-1">
            {i ? <span className="text-slate-300">›</span> : null}
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${cls}`} title={step.name || undefined}>
              {done ? <Check className="h-3 w-3" /> : wasRejecter ? <X className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
              {step.label}
              {done && step.name ? <span className="hidden sm:inline">· {step.name}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function useReviewRequest({ onDone } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ item, status, review_note }) =>
      api.post(`${KIND_ENDPOINT[item.kind]}/${item.id}/review`, { status, review_note }).then((r) => r.data),
    onSuccess: (data, vars) => {
      invalidateRequestQueries(qc);
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['hr-attendance'] });
      qc.invalidateQueries({ queryKey: ['hr-deductions'] });
      qc.invalidateQueries({ queryKey: ['hr-payroll'] });
      if (vars.status === 'rejected') toast.success('Request rejected');
      else toast.success(data?.status === 'approved' ? 'Request approved' : 'Accepted, sent to the next approver');
      onDone?.();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not update the request'),
  });
}

export function ReviewButtons({ item, review, onReject, size = 'sm' }) {
  if (item.row.status !== 'pending' || !(item.row.can_review_slots || []).length) return null;
  const slots = item.row.can_review_slots;
  const hint = slots.includes('admin')
    ? 'Approve now (CEO)'
    : slots.includes('finance')
      ? 'Accept as Financial Manager'
      : slots.includes('hr')
        ? 'Accept as HR Manager'
        : 'Accept as manager';
  const pad = size === 'lg' ? 'px-4 py-2 text-sm' : 'px-2.5 py-1 text-xs';
  return (
    <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        title={hint}
        disabled={review.isPending}
        onClick={() => review.mutate({ item, status: 'approved' })}
        className={`inline-flex items-center gap-1 rounded-lg bg-emerald-600 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 ${pad}`}
      >
        <Check className="h-3.5 w-3.5" /> Accept
      </button>
      <button
        type="button"
        disabled={review.isPending}
        onClick={() => onReject(item)}
        className={`inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 ${pad}`}
      >
        <X className="h-3.5 w-3.5" /> Reject
      </button>
    </div>
  );
}

export function RejectModal({ item, review, onClose }) {
  const [note, setNote] = useState('');
  if (!item) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title="Reject request"
      size="sm"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={review.isPending}
            onClick={() => review.mutate({ item, status: 'rejected', review_note: note.trim() || undefined })}
          >
            Reject
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-soul-muted">
        Reject {item.row.full_name ? `${item.row.full_name}’s ` : ''}
        {requestTitle(item).toLowerCase()} request ({requestWhen(item)})? They’ll get a notification with your note.
      </p>
      <label className="label">Note (optional)</label>
      <textarea className="input min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it can’t be approved" />
    </Modal>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-soul-muted">{label}</div>
      <div className="mt-1 text-sm text-soul-blue">{children}</div>
    </div>
  );
}

export function RequestDetailModal({ item, review, onReject, onClose, showPerson }) {
  if (!item) return null;
  const { row } = item;
  return (
    <Modal
      open
      onClose={onClose}
      title={`${requestTitle(item)} request`}
      size="md"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
          <ReviewButtons item={item} review={review} onReject={onReject} size="lg" />
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <CategoryIcon category={item.category} size="h-11 w-11" />
          <div className="min-w-0 flex-1">
            {showPerson ? (
              <>
                <p className="font-semibold text-soul-blue">{row.full_name}</p>
                <p className="text-xs text-soul-muted">
                  {row.staff_code ? `${row.staff_code} · ` : ''}
                  {ROLE_LABELS[row.role] || row.role}
                </p>
              </>
            ) : null}
            <p className={`${showPerson ? 'mt-1 text-sm' : 'font-semibold'} text-soul-blue`}>{requestWhen(item)}</p>
          </div>
          <StatusPill row={row} />
        </div>
        <ApprovalSteps item={item} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type">{requestTitle(item)}</Field>
          <Field label="Sent">{row.created_at ? formatDateTime(row.created_at) : '—'}</Field>
          {row.manager_name ? <Field label="Line manager">{row.manager_name}</Field> : null}
          {item.kind === 'loan' && row.deduct_month ? (
            <Field label="Deducted from">
              {new Date(Date.UTC(row.deduct_year, row.deduct_month - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })} salary
            </Field>
          ) : null}
        </div>
        <Field label={item.kind === 'loan' ? 'Reason' : 'Note'}>{row.reason?.trim() ? row.reason : '—'}</Field>
        {row.review_note ? <Field label="Reviewer’s note">{row.review_note}</Field> : null}
      </div>
    </Modal>
  );
}
