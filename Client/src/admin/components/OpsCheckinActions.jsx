import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Modal from './ui/Modal';
import LoadingSpinner from './ui/LoadingSpinner';
import { currency, formatDateTime } from '../utils/formatters';

const REFUND_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'instapay', label: 'InstaPay' },
  { value: 'bank_transfer', label: 'Bank transfer' },
];

function nightsBetween(a, b) {
  if (!a || !b) return 0;
  const d = Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
  return d > 0 ? d : 0;
}

/** Sales person, source and reservation notes for ops. */
export function ReservationContext({ row }) {
  if (!row?.sales_person_name && !row?.booking_source && !row?.notes) return null;
  return (
    <div className="mt-1.5 space-y-0.5 text-[11px] text-gray-600">
      {row.sales_person_name ? (
        <div>
          <span className="text-gray-400">Sales:</span> {row.sales_person_name}
        </div>
      ) : null}
      {row.booking_source ? (
        <div>
          <span className="text-gray-400">Source:</span> {row.booking_source}
        </div>
      ) : null}
      {row.notes ? (
        <div className="max-w-[16rem] whitespace-pre-line line-clamp-3" title={row.notes}>
          <span className="text-gray-400">Notes:</span> {row.notes}
        </div>
      ) : null}
    </div>
  );
}

/** Asks why an existing assignment is being changed. */
export function ReassignReasonModal({ open, onClose, onConfirm, busy, title = 'Change assignment' }) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !reason.trim()}
            onClick={() => onConfirm(reason.trim())}
          >
            {busy ? 'Saving…' : 'Change'}
          </button>
        </>
      }
    >
      <label className="block text-sm space-y-1">
        <span className="font-medium text-gray-700">
          Why? <span className="text-red-500">*</span>
        </span>
        <textarea
          className="input min-h-[5rem]"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for changing who handles this"
          autoFocus
        />
      </label>
    </Modal>
  );
}

export function CancelCheckinModal({ row, onClose, onDone }) {
  const [comment, setComment] = useState('');
  const [refund, setRefund] = useState('');
  const [method, setMethod] = useState('cash');
  useEffect(() => {
    setComment('');
    setRefund(row ? String(Number(row.amount_paid) || 0) : '');
    setMethod('cash');
  }, [row]);
  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/ops/checkins-today/${row.id}/cancel`, {
        comment: comment.trim(),
        refund_amount: Number(refund) || 0,
        refund_method: method,
      }),
    onSuccess: () => {
      toast.success('Check-in cancelled');
      onDone?.();
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not cancel'),
  });
  const paid = Number(row?.amount_paid) || 0;
  return (
    <Modal
      open={!!row}
      onClose={onClose}
      title={`Cancel check-in · ${row?.guest_name || ''}`}
      size="md"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Back
          </button>
          <button
            type="button"
            className="btn-primary bg-red-600 hover:bg-red-700 border-red-600"
            disabled={mutation.isPending}
            onClick={() => {
              if (!comment.trim()) return toast.error('A comment is required');
              if (refund === '' || Number(refund) < 0) return toast.error('Enter the refund amount (0 if none)');
              if (Number(refund) > paid + 0.5) return toast.error(`Refund cannot exceed ${currency(paid)}`);
              mutation.mutate();
            }}
          >
            {mutation.isPending ? 'Cancelling…' : 'Cancel check-in'}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">
          Guest paid <span className="font-semibold">{currency(paid)}</span> so far.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs font-medium text-gray-700">
              Amount to refund <span className="text-red-500">*</span>
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              className="input"
              value={refund}
              onChange={(e) => setRefund(e.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-gray-700">Refund method</span>
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              {REFUND_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {method === 'cash' && Number(refund) > 0 ? (
          <p className="text-xs text-amber-700">Cash refunds are recorded as cash out from petty cash.</p>
        ) : null}
        <label className="block space-y-1">
          <span className="text-xs font-medium text-gray-700">
            Comment <span className="text-red-500">*</span>
          </span>
          <textarea
            className="input min-h-[5rem]"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Why is this check-in cancelled?"
          />
        </label>
      </div>
    </Modal>
  );
}

export function ChangeStayModal({ row, onClose, onDone }) {
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [comment, setComment] = useState('');
  const [adjust, setAdjust] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!row) return;
    setCheckIn(String(row.check_in || '').slice(0, 10));
    setCheckOut(String(row.check_out || '').slice(0, 10));
    setComment('');
    setAdjust('');
    setTouched(false);
  }, [row]);

  const oldNights = Number(row?.nights) || nightsBetween(String(row?.check_in || '').slice(0, 10), String(row?.check_out || '').slice(0, 10));
  const newNights = nightsBetween(checkIn, checkOut);
  const perNight = Number(row?.price_per_night) || 0;
  const serviceRate = Number(row?.payment_breakdown?.service_fee_percent) || 0;
  const suggested = Math.round((newNights - oldNights) * perNight * (1 + serviceRate / 100) * 100) / 100;
  const adjustValue = touched && adjust !== '' ? Number(adjust) : suggested;
  const newTotal = Math.round(((Number(row?.total_amount) || 0) + adjustValue) * 100) / 100;
  const paid = Number(row?.amount_paid) || 0;
  const balance = Math.round((newTotal - paid) * 100) / 100;

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/ops/checkins-today/${row.id}/change-dates`, {
        check_in: checkIn,
        check_out: checkOut,
        comment: comment.trim(),
        ...(touched && adjust !== '' ? { adjust_amount: Number(adjust) } : {}),
      }),
    onSuccess: () => {
      toast.success('Stay updated');
      onDone?.();
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not change the stay'),
  });

  return (
    <Modal
      open={!!row}
      onClose={onClose}
      title={`Edit stay · ${row?.guest_name || ''}`}
      size="md"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={mutation.isPending}
            onClick={() => {
              if (newNights < 1) return toast.error('Check-out must be after check-in');
              if (!comment.trim()) return toast.error('A comment is required');
              mutation.mutate();
            }}
          >
            {mutation.isPending ? 'Saving…' : 'Save stay'}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs font-medium text-gray-700">Check-in</span>
            <input type="date" className="input" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-gray-700">Check-out</span>
            <input type="date" className="input" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
          </label>
        </div>
        <div className="rounded-lg bg-gray-50 border px-3 py-2 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-500">Nights</span>
            <span className="tabular-nums">
              {oldNights} → <span className="font-semibold">{newNights}</span>
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">New total</span>
            <span className="tabular-nums font-semibold">{currency(newTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Paid</span>
            <span className="tabular-nums text-emerald-700">{currency(paid)}</span>
          </div>
          <div className={`flex justify-between font-semibold ${balance < 0 ? 'text-red-700' : 'text-amber-800'}`}>
            <span>{balance < 0 ? 'To refund' : 'To collect'}</span>
            <span className="tabular-nums">{currency(Math.abs(balance))}</span>
          </div>
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-gray-700">
            Amount difference (+ collect more / − refund)
          </span>
          {!touched ? (
            <span className="block text-[11px] text-gray-400">Estimated from the nightly rate; edit to override.</span>
          ) : null}
          <input
            type="number"
            step="0.01"
            className="input"
            value={touched ? adjust : String(suggested)}
            onChange={(e) => {
              setTouched(true);
              setAdjust(e.target.value);
            }}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-gray-700">
            Comment <span className="text-red-500">*</span>
          </span>
          <textarea
            className="input min-h-[4.5rem]"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Why did the stay change?"
          />
        </label>
      </div>
    </Modal>
  );
}

export function OpsCommentModal({ target, onClose, onDone }) {
  const [comment, setComment] = useState('');
  useEffect(() => setComment(''), [target]);
  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/ops/reservations/${target.row.id}/comments`, { kind: target.kind, comment: comment.trim() }),
    onSuccess: () => {
      toast.success('Comment added');
      onDone?.();
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not add comment'),
  });
  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={`${target?.kind === 'checkout' ? 'Checkout' : 'Check-in'} comment · ${target?.row?.guest_name || ''}`}
      size="sm"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={mutation.isPending || !comment.trim()}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving…' : 'Add comment'}
          </button>
        </>
      }
    >
      <textarea
        className="input min-h-[6rem]"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Write a comment"
        autoFocus
      />
    </Modal>
  );
}

const EVENT_LABELS = {
  OPS_ASSIGN_CHECKIN: 'Check-in assigned',
  OPS_ASSIGN_CHECKOUT: 'Checkout assigned',
  OPS_COLLECT_CHECKIN: 'Money collected',
  OPS_EDIT_CHECKIN_BILL: 'Bill edited',
  OPS_CHECKIN_COMMENT: 'Agent comment',
  OPS_HANDOVER_CHECKIN: 'Handed over',
  OPS_CANCEL_CHECKIN: 'Check-in cancelled',
  OPS_CHANGE_STAY: 'Stay changed',
  OPS_REFUND_INSURANCE: 'Insurance refunded',
  OPS_DAMAGE_SHARE_REVIEW: 'Damage sharing reviewed',
};

export function CheckinHistoryModal({ row, onClose }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['ops-checkin-history', row?.id],
    queryFn: async () => (await api.get(`/ops/reservations/${row.id}/history`)).data,
    enabled: !!row,
  });
  const r = data?.reservation;
  return (
    <Modal open={!!row} onClose={onClose} title={`Check-in history · ${row?.guest_name || ''}`} size="lg">
      {isLoading ? (
        <LoadingSpinner />
      ) : isError ? (
        <p className="text-sm text-red-600">{error?.response?.data?.error || 'Could not load history'}</p>
      ) : (
        <div className="space-y-5 text-sm">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Info label="Unit" value={r?.unit_number || r?.unit_title} />
            <Info label="Stay" value={`${String(r?.check_in || '').slice(0, 10)} → ${String(r?.check_out || '').slice(0, 10)}`} />
            <Info label="Status" value={r?.status} />
            <Info label="Sales person" value={r?.sales_person_name} />
            <Info label="Source" value={r?.booking_source} />
            <Info label="Created by" value={r?.created_by_name} />
            <Info label="Check-in agent" value={r?.ops_assignee_name} />
            <Info label="Checkout agent" value={r?.ops_checkout_assignee_name || r?.ops_assignee_name} />
            <Info label="Total / paid" value={`${currency(r?.total_amount)} / ${currency(r?.amount_paid)}`} />
          </div>
          {r?.notes ? <Block title="Reservation notes">{r.notes}</Block> : null}
          {data?.handover_comment ? <Block title="Handover comment">{data.handover_comment}</Block> : null}
          {r?.ops_cancel_comment ? (
            <Block title={`Cancelled by ${r.ops_cancelled_by_name || 'ops'} · refund ${currency(r.ops_cancel_refund_amount)}`}>
              {r.ops_cancel_comment}
            </Block>
          ) : null}
          {r?.ops_adjust_comment ? (
            <Block title={`Stay changed · ${r.ops_adjust_amount >= 0 ? 'collect' : 'refund'} ${currency(Math.abs(r.ops_adjust_amount || 0))}`}>
              {r.ops_adjust_comment}
            </Block>
          ) : null}

          <Section title="Payments">
            {(data?.payments || []).length ? (
              <ul className="divide-y border rounded-lg">
                {data.payments.map((p) => (
                  <li key={p.id} className="px-3 py-2 flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">
                        {currency(p.amount)} · {p.payment_method}
                      </div>
                      <div className="text-xs text-gray-500">{p.notes}</div>
                      {p.document_path ? (
                        <a href={p.document_path} target="_blank" rel="noreferrer" className="text-xs text-soul-blue underline">
                          View proof
                        </a>
                      ) : null}
                    </div>
                    <div className="text-xs text-gray-500 text-right whitespace-nowrap">
                      {formatDateTime(p.created_at)}
                      <div>{p.created_by_name}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty />
            )}
          </Section>

          <Section title="Assignments">
            {(data?.assignments || []).length ? (
              <ul className="space-y-1.5">
                {data.assignments.map((a) => (
                  <li key={a.id} className="text-xs">
                    <span className="font-medium capitalize">{a.kind}</span>: {a.from_name || 'Unassigned'} →{' '}
                    {a.to_name || 'Unassigned'} · by {a.changed_by_name || '—'} · {formatDateTime(a.created_at)}
                    {a.reason ? <div className="text-gray-600 pl-3">Reason: {a.reason}</div> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty />
            )}
          </Section>

          <Section title="Comments">
            {(data?.comments || []).length ? (
              <ul className="space-y-2">
                {data.comments.map((c) => (
                  <li key={c.id} className="rounded-lg bg-gray-50 border px-3 py-2">
                    <div className="text-[11px] text-gray-500">
                      {c.kind === 'checkout' ? 'Checkout' : 'Check-in'} · {c.created_by_name} · {formatDateTime(c.created_at)}
                    </div>
                    <div className="whitespace-pre-line">{c.comment}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty />
            )}
          </Section>

          <Section title="Timeline">
            {(data?.events || []).length ? (
              <ul className="space-y-1">
                {data.events.map((ev) => (
                  <li key={ev.id} className="text-xs">
                    <span className="text-gray-500">{formatDateTime(ev.created_at)}</span> ·{' '}
                    <span className="font-medium">{EVENT_LABELS[ev.action] || ev.action}</span> · {ev.user_name || '—'}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty />
            )}
          </Section>
        </div>
      )}
    </Modal>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <div className="text-gray-900 break-words">{value || '—'}</div>
    </div>
  );
}

function Block({ title, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-gray-500 mb-1">{title}</div>
      <p className="whitespace-pre-line text-gray-800">{children}</p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h3 className="font-semibold text-gray-900">{title}</h3>
      {children}
    </section>
  );
}

function Empty() {
  return <p className="text-xs text-gray-400">Nothing yet.</p>;
}
