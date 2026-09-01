import { Check, X } from 'lucide-react';

export function approvalStatusClass(status) {
  if (status === 'approved') return 'bg-emerald-50 text-emerald-700';
  if (status === 'rejected') return 'bg-rose-50 text-rose-700';
  return 'bg-amber-50 text-amber-800';
}

function stepLine(row) {
  const parts = [];
  if (row.needs_manager_approval) {
    parts.push(
      row.manager_reviewed_by
        ? `Manager: ${row.manager_reviewed_by_name || 'accepted'}`
        : 'Manager: waiting'
    );
  }
  if (row.needs_hr_approval) {
    parts.push(
      row.hr_reviewed_by
        ? `HR Manager: ${row.hr_reviewed_by_name || 'accepted'}`
        : 'HR Manager: waiting'
    );
  }
  return parts.join(' · ');
}

export function RequestReviewActions({ row, onApprove, onReject, pending }) {
  const slots = row.can_review_slots || [];
  const acceptHint = slots.includes('admin')
    ? 'Accept and finalize'
    : slots.includes('manager') && slots.includes('hr')
      ? 'Accept as manager & HR Manager'
      : slots.includes('hr')
        ? 'Accept as HR Manager'
        : 'Accept as manager';

  if (row.status !== 'pending') {
    return (
      <div className="text-[11px] text-soul-muted space-y-0.5">
        <div>{stepLine(row) || row.reviewed_by_name || '—'}</div>
        {row.review_note ? <div>Note: {row.review_note}</div> : null}
      </div>
    );
  }

  if (!slots.length) {
    return <span className="text-[11px] text-soul-muted">{row.approval_label || 'Waiting for review'}</span>;
  }

  return (
    <div className="flex gap-1">
      <button
        type="button"
        className="btn-secondary text-xs px-2 py-1 text-emerald-700"
        disabled={pending}
        title={acceptHint}
        onClick={() => onApprove(row)}
      >
        <Check className="h-3.5 w-3.5" />
        Accept
      </button>
      <button
        type="button"
        className="btn-secondary text-xs px-2 py-1 text-rose-700"
        disabled={pending}
        onClick={() => onReject(row)}
      >
        <X className="h-3.5 w-3.5" />
        Reject
      </button>
    </div>
  );
}
