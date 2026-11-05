import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import Modal from '../../components/ui/Modal';
import { canRequestLoan, canRequestStaffBenefits, canRequestWfh } from '../../utils/permissions';
import { formatUnpaidLeaveAvailable } from '../../utils/hrPolicy';
import { invalidateRequestQueries } from '../../hooks/useLiveNotifications';
import { CATEGORY, cairoToday, dayLabel } from './shared';
import { ScheduleCalendar, useMySchedule } from './MySchedule';

const STEPS = ['Type', 'When', 'Review & send'];
const EXCUSE_MAX_HOURS = 2;

const HOLIDAY_TYPES = [
  { value: 'casual', label: 'Casual', needsAccess: true },
  { value: 'annual', label: 'Annual', needsAccess: true },
  { value: 'unpaid', label: 'Unpaid', needsAccess: false },
];

function minutes(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function addMinutes(t, delta) {
  const total = minutes(t) + delta;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function daysInclusive(from, to) {
  if (!from || !to) return 0;
  return Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000) + 1;
}

export default function NewRequestWizard({ user, leaveSnap, initial = {}, onClose }) {
  const qc = useQueryClient();
  const today = cairoToday();
  const benefits = canRequestStaffBenefits(user);
  const holidayAccess = leaveSnap?.can_request_holidays !== false;
  const excusesLeft = leaveSnap?.paid_excuse_remaining ?? 2;
  const excusesMax = leaveSnap?.paid_excuse_max ?? 2;

  const types = [
    benefits ? { id: 'holiday', help: holidayAccess ? 'Casual, annual or unpaid days off' : 'Unpaid days off (casual and annual open after 6 months)' } : null,
    benefits ? { id: 'excuse', help: `Up to ${EXCUSE_MAX_HOURS} hours, ${excusesLeft} of ${excusesMax} left this month`, disabled: excusesLeft < 1 } : null,
    benefits ? { id: 'mission', help: 'Paid time out of the office for work' } : null,
    canRequestWfh(user) ? { id: 'wfh', help: 'Work from home for a day (half-day deduction)' } : null,
    canRequestLoan(user) ? { id: 'loan', help: 'Deducted from next month’s salary' } : null,
  ].filter(Boolean);

  const firstType = types.find((t) => t.id === initial.category && !t.disabled)?.id || null;
  const [step, setStep] = useState(firstType && initial.date ? 1 : 0);
  const [form, setForm] = useState({
    category: firstType,
    leave_type: holidayAccess ? 'casual' : 'unpaid',
    from: initial.date || '',
    to: initial.date || '',
    start_time: '',
    end_time: '',
    amount: '',
    reason: '',
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const [month, setMonth] = useState((initial.date || today).slice(0, 7));
  const schedule = useMySchedule(user, month, form.category !== 'loan');

  const isRange = form.category === 'holiday';
  const isTimed = form.category === 'excuse' || form.category === 'mission';
  const shift = schedule.data?.shift;
  const hours = isTimed && minutes(form.end_time) != null && minutes(form.start_time) != null
    ? (minutes(form.end_time) - minutes(form.start_time)) / 60
    : null;

  const pickDay = (day) => {
    if (!isRange) return set({ from: day.date, to: day.date });
    if (!form.from || (form.from && form.to && form.from !== form.to) || day.date < form.from) {
      return set({ from: day.date, to: day.date });
    }
    return set({ to: day.date });
  };

  // What the chosen dates run into on the person's schedule.
  const warnings = useMemo(() => {
    const out = [];
    const days = schedule.data?.days || [];
    if (!form.from || form.category === 'loan') return out;
    const chosen = days.filter((d) => d.date >= form.from && d.date <= (form.to || form.from));
    const off = chosen.filter((d) => d.day_off);
    if (off.length && isRange) out.push(`Includes your day off (${off.map((d) => dayLabel(d.date)).join(', ')}); it still counts in the number of days.`);
    if (off.length && !isRange) out.push('That’s your day off.');
    const clash = chosen.flatMap((d) => d.items.map((it) => ({ ...it, date: d.date })));
    if (clash.length) out.push(`You already have ${clash.map((c) => `${CATEGORY[c.category]?.label.toLowerCase()} (${c.status}) on ${dayLabel(c.date)}`).join(', ')}.`);
    if (form.category === 'holiday') {
      const n = daysInclusive(form.from, form.to || form.from);
      if (form.leave_type === 'casual' && n > (leaveSnap?.casual_available ?? Infinity)) out.push(`You have ${leaveSnap.casual_available} casual day(s) left.`);
      if (form.leave_type === 'annual' && n > (leaveSnap?.annual_available ?? Infinity)) out.push(`You have ${leaveSnap.annual_available} annual day(s) left.`);
    }
    if (form.from < today && form.category !== 'holiday') out.push('This date is in the past.');
    return out;
  }, [schedule.data, form, isRange, leaveSnap, today]);

  const problems = useMemo(() => {
    const p = [[], [], []];
    if (!form.category) p[0].push('Choose what you’re requesting');
    if (form.category === 'loan') {
      if (!(Number(form.amount) > 0)) p[1].push('Enter the loan amount');
      if (!form.reason.trim()) p[2].push('Add the reason for the loan');
      return p;
    }
    if (!form.from) p[1].push(isRange ? 'Pick the first day' : 'Pick the day');
    if (isRange && form.to && form.to < form.from) p[1].push('The last day must be on or after the first');
    if (isTimed) {
      if (!form.start_time || !form.end_time) p[1].push('Choose the from and to times');
      else if (!(hours > 0)) p[1].push('The end time must be after the start time');
      else if (form.category === 'excuse' && hours > EXCUSE_MAX_HOURS) p[1].push(`An excuse can be at most ${EXCUSE_MAX_HOURS} hours`);
    }
    if (form.category === 'mission' && !form.reason.trim()) p[2].push('Describe the mission');
    return p;
  }, [form, isRange, isTimed, hours]);

  const send = useMutation({
    mutationFn: () => {
      if (form.category === 'loan') return api.post('/hr/loans', { amount: Number(form.amount), reason: form.reason.trim() });
      if (form.category === 'wfh') return api.post('/hr/wfh', { work_date: form.from, reason: form.reason.trim() });
      const leaveType = form.category === 'excuse' ? 'paid_excuse' : form.category === 'mission' ? 'mission' : form.leave_type;
      return api.post('/hr/leave-requests', {
        leave_type: leaveType,
        start_date: form.from,
        end_date: isRange ? form.to || form.from : form.from,
        start_time: isTimed ? form.start_time : undefined,
        end_time: isTimed ? form.end_time : undefined,
        reason: form.reason.trim(),
      });
    },
    onSuccess: () => {
      invalidateRequestQueries(qc);
      toast.success('Request sent. You’ll get a notification when it’s reviewed.');
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not send the request'),
  });

  const next = () => {
    const blockers = problems[step];
    if (blockers.length) return toast.error(blockers[0]);
    return setStep(step + 1);
  };

  const approvers =
    form.category === 'loan'
      ? 'The HR Manager, then the Financial Manager'
      : 'Your manager, then the HR Manager';
  const whenText = (() => {
    if (form.category === 'loan') return `EGP ${Number(form.amount || 0).toLocaleString('en-EG')}`;
    if (!form.from) return '—';
    if (isTimed) return `${dayLabel(form.from)} · ${form.start_time}–${form.end_time}${hours ? ` (${hours}h)` : ''}`;
    if (isRange && form.to && form.to !== form.from) return `${dayLabel(form.from)} – ${dayLabel(form.to)} · ${daysInclusive(form.from, form.to)} days`;
    return `${dayLabel(form.from)}${isRange ? ' · 1 day' : ''}`;
  })();
  const typeText =
    form.category === 'holiday'
      ? `${HOLIDAY_TYPES.find((t) => t.value === form.leave_type)?.label} leave`
      : CATEGORY[form.category]?.label;

  return (
    <Modal
      open
      onClose={onClose}
      title="New request"
      size="xl"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={() => (step ? setStep(step - 1) : onClose())}>
            {step ? 'Back' : 'Cancel'}
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn-primary" onClick={next}>
              Next
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              disabled={send.isPending}
              onClick={() => {
                const all = problems.flat();
                return all.length ? toast.error(all[0]) : send.mutate();
              }}
            >
              {send.isPending ? 'Sending…' : 'Send request'}
            </button>
          )}
        </>
      }
    >
      <ol className="mb-5 flex flex-wrap gap-1.5">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => (i < step ? setStep(i) : null)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                i === step ? 'bg-soul-blue text-white' : i < step ? 'bg-soul-blue-50 text-soul-blue hover:bg-soul-blue/10' : 'bg-slate-100 text-slate-400'
              }`}
            >
              {i + 1}. {label}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-soul-muted">What do you need?</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {types.map((t) => {
              const meta = CATEGORY[t.id];
              const Icon = meta.icon;
              const on = form.category === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={t.disabled}
                  onClick={() => set({ category: t.id, ...(t.id === 'wfh' || t.id === 'excuse' || t.id === 'mission' ? { to: form.from } : {}) })}
                  className={`rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    on ? 'border-soul-blue bg-soul-blue-50/60 ring-1 ring-soul-blue' : 'border-soul-line hover:bg-slate-50'
                  }`}
                >
                  <span className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-xl border ${meta.chip}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <p className="font-semibold text-soul-blue">{meta.label}</p>
                  <p className="mt-1 text-xs text-soul-muted">{t.disabled ? 'No excuses left this month (resets on the 26th)' : t.help}</p>
                </button>
              );
            })}
          </div>
          {form.category === 'holiday' ? (
            <div>
              <label className="label">Kind of leave</label>
              <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-0.5">
                {HOLIDAY_TYPES.map((t) => {
                  const disabled = t.needsAccess && !holidayAccess;
                  const left =
                    t.value === 'casual'
                      ? leaveSnap?.casual_available
                      : t.value === 'annual'
                        ? leaveSnap?.annual_available
                        : leaveSnap
                          ? formatUnpaidLeaveAvailable(leaveSnap)
                          : null;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      disabled={disabled}
                      onClick={() => set({ leave_type: t.value })}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
                        form.leave_type === t.value ? 'bg-white text-soul-blue shadow-sm' : 'text-slate-500 hover:text-soul-blue'
                      }`}
                    >
                      {t.label}
                      {left != null ? <span className="ml-1 text-soul-muted">({left} left)</span> : null}
                    </button>
                  );
                })}
              </div>
              {!holidayAccess ? (
                <p className="mt-2 text-xs text-amber-800">
                  Casual and annual leave open after 6 months, or when HR gives you access
                  {leaveSnap?.tenure_months != null ? ` (you’re at ${leaveSnap.tenure_months} months)` : ''}.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 1 && form.category === 'loan' ? (
        <div className="max-w-sm space-y-3">
          <div>
            <label className="label">Amount (EGP)</label>
            <input type="number" min="0" step="1" className="input" value={form.amount} onChange={(e) => set({ amount: e.target.value })} autoFocus />
          </div>
          <p className="text-xs text-soul-muted">Once approved, the full amount is deducted from next month’s salary.</p>
        </div>
      ) : null}

      {step === 1 && form.category !== 'loan' ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_16rem]">
          <div>
            <p className="mb-2 text-sm text-soul-muted">
              {isRange ? 'Tap the first day, then the last day.' : 'Tap the day.'} Your shift, days off and other requests are shown.
            </p>
            <ScheduleCalendar
              data={schedule.data}
              month={month}
              onMonth={setMonth}
              today={today}
              onDay={pickDay}
              selected={form.from ? { from: form.from, to: isRange ? form.to : form.from } : null}
              compact
            />
          </div>
          <div className="space-y-3">
            <div className={isRange ? 'grid grid-cols-2 gap-2 lg:grid-cols-1' : ''}>
              <div>
                <label className="label">{isRange ? 'First day' : 'Day'}</label>
                <input
                  type="date"
                  className="input"
                  value={form.from}
                  onChange={(e) => {
                    const v = e.target.value;
                    set({ from: v, to: !isRange || !form.to || form.to < v ? v : form.to });
                    if (v) setMonth(v.slice(0, 7));
                  }}
                />
              </div>
              {isRange ? (
                <div>
                  <label className="label">Last day</label>
                  <input type="date" className="input" min={form.from || undefined} value={form.to} onChange={(e) => set({ to: e.target.value })} />
                </div>
              ) : null}
            </div>
            {isTimed ? (
              <>
                {form.category === 'excuse' && shift ? (
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className="rounded-full border border-soul-line px-2.5 py-1 text-xs hover:bg-slate-50" onClick={() => set({ start_time: shift.start, end_time: addMinutes(shift.start, 120) })}>
                      Come in late ({shift.start}–{addMinutes(shift.start, 120)})
                    </button>
                    <button type="button" className="rounded-full border border-soul-line px-2.5 py-1 text-xs hover:bg-slate-50" onClick={() => set({ start_time: addMinutes(shift.end, -120), end_time: shift.end })}>
                      Leave early ({addMinutes(shift.end, -120)}–{shift.end})
                    </button>
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label">From</label>
                    <input type="time" className="input" value={form.start_time} onChange={(e) => set({ start_time: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">To</label>
                    <input type="time" className="input" value={form.end_time} onChange={(e) => set({ end_time: e.target.value })} />
                  </div>
                </div>
                <p className="text-xs text-soul-muted">
                  {form.category === 'excuse'
                    ? `Up to ${EXCUSE_MAX_HOURS} hours. You have ${excusesLeft} of ${excusesMax} excuses left this month (26th–25th).`
                    : 'Paid time; it doesn’t affect your attendance.'}
                  {hours > 0 ? ` This one is ${hours}h.` : ''}
                </p>
              </>
            ) : null}
            {form.from ? (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-soul-blue">
                <span className="font-medium">{whenText}</span>
              </div>
            ) : null}
            {warnings.length ? (
              <ul className="space-y-1.5">
                {warnings.map((w) => (
                  <li key={w} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-3 rounded-xl border border-soul-line p-4">
            <div className="flex items-center gap-3">
              {(() => {
                const meta = CATEGORY[form.category];
                const Icon = meta.icon;
                return (
                  <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border ${meta.chip}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                );
              })()}
              <div>
                <p className="font-semibold text-soul-blue">{typeText}</p>
                <p className="text-sm text-soul-muted">{whenText}</p>
              </div>
            </div>
            <div className="text-xs text-soul-muted">
              <p className="font-semibold uppercase tracking-wide">Who approves</p>
              <p className="mt-1 text-sm text-soul-blue">{approvers}</p>
              <p className="mt-1">You’ll get a notification at each step.</p>
            </div>
            {warnings.length ? (
              <ul className="space-y-1">
                {warnings.map((w) => (
                  <li key={w} className="flex gap-2 text-xs text-amber-900">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {w}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div>
            <label className="label">
              {form.category === 'loan' ? 'Reason' : form.category === 'mission' ? 'What’s the mission?' : 'Note (optional)'}
            </label>
            <textarea
              className="input min-h-[120px]"
              value={form.reason}
              onChange={(e) => set({ reason: e.target.value })}
              placeholder={form.category === 'loan' || form.category === 'mission' ? 'Required' : 'Anything your manager should know'}
              autoFocus
            />
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
