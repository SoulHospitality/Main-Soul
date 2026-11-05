import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Copy, Eye, Pencil, Play, Plus, Sparkles, Trash2 } from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import { ROLE_LABELS, ADMIN_STAFF_FILTER_ROLES } from '../utils/permissions';
import { currency } from '../utils/formatters';

/* ───────────────────────── vocabulary ───────────────────────── */

const TRIGGER_HELP = {
  late_arrival: 'Counts every day the person checked in after a time (optionally only up to a later time).',
  no_show: 'Counts every no-show day. You can limit it to no-shows they did or did not tell anyone about.',
  early_checkout: 'Counts every worked day the person checked out before a time.',
  overtime: 'Adds up the hours worked after a check-out time, in quarter hours.',
  worked_day_off: 'Counts days the person worked on one of their scheduled days off.',
  late_count: 'Applies once in the cycle if the person was late at least N times.',
  absence_count: 'Applies once in the cycle if the person had at least N no-shows.',
  perfect_attendance: 'Applies once if every recorded day in the cycle was on time.',
  leave_days: 'Counts approved leave days of the chosen type that fall in the cycle.',
  excuse_hours: 'Adds up approved excuse hours of the chosen type in the cycle.',
  monthly_fixed: 'Applies once every pay cycle — allowances, insurance, fixed deductions.',
  tenure: 'Applies every cycle once the person has worked here for N months.',
};

const AMOUNT_LABELS = {
  daily_rate: '× daily rate',
  hourly_rate: '× hourly rate',
  fixed: 'EGP fixed',
  percent_base: '% of base salary',
};

const LEAVE_LABELS = {
  casual: 'Casual',
  annual: 'Annual',
  sick: 'Sick',
  unpaid: 'Unpaid',
  holiday: 'Holiday',
  day_off: 'Day off',
  mission: 'Mission',
  meeting: 'Meeting',
  paid_excuse: 'Paid excuse',
  unpaid_excuse: 'Unpaid excuse',
  early_leave: 'Early leave',
};

const UNIT_WORD = { day: 'each time', hour: 'per hour', cycle: 'once per cycle' };

const TEMPLATES = [
  { name: 'Late after 11:30', effect: 'deduction', trigger: 'late_arrival', params: { after: '11:30' }, amount_type: 'daily_rate', amount: 0.25 },
  { name: 'Perfect attendance bonus', effect: 'bonus', trigger: 'perfect_attendance', params: {}, amount_type: 'fixed', amount: 500 },
  { name: 'Overtime pay', effect: 'bonus', trigger: 'overtime', params: { after: '19:00' }, amount_type: 'hourly_rate', amount: 1.5 },
  { name: 'Transport allowance', effect: 'bonus', trigger: 'monthly_fixed', params: {}, amount_type: 'fixed', amount: 1000 },
  { name: 'Worked a day off', effect: 'bonus', trigger: 'worked_day_off', params: {}, amount_type: 'daily_rate', amount: 1 },
  { name: 'Three lates in a cycle', effect: 'deduction', trigger: 'late_count', params: { min_count: 3 }, amount_type: 'daily_rate', amount: 1 },
];

const BLANK_RULE = {
  name: '',
  effect: 'deduction',
  trigger: 'late_arrival',
  params: { after: '11:30' },
  amount_type: 'daily_rate',
  amount: 0.25,
  roles: [],
  staff_ids: [],
  free_count: 0,
  cap_amount: '',
  effective_from: '',
  effective_to: '',
  active: true,
  notes: '',
};

function formatDay(iso) {
  if (!iso) return '';
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function minutesLabel(value) {
  if (value == null || value === '') return '';
  const minutes = Number(value);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Plain-language description of a rule, e.g. "Deduct 0.25 × daily rate each time someone checks in after 11:30". */
function describeRule(rule, units, staffById) {
  const p = rule.params || {};
  const verb = rule.effect === 'bonus' ? 'Pay' : 'Deduct';
  const amount =
    rule.amount_type === 'fixed'
      ? currency(Number(rule.amount) || 0)
      : rule.amount_type === 'percent_base'
        ? `${rule.amount}% of base salary`
        : `${rule.amount} ${AMOUNT_LABELS[rule.amount_type]}`;
  const when = {
    late_arrival: `they check in after ${p.after || '—'}${p.before ? ` (up to ${p.before})` : ''}`,
    no_show: `they don’t show up${p.notified === 'yes' ? ' after telling us' : p.notified === 'no' ? ' without telling us' : ''}`,
    early_checkout: `they check out before ${p.before || '—'}`,
    overtime: `they work after ${p.after || '—'}`,
    worked_day_off: 'they work on a scheduled day off',
    late_count: `they’re late ${p.min_count || 'N'}+ times${p.after ? ` after ${p.after}` : ''}`,
    absence_count: `they have ${p.min_count || 'N'}+ no-shows`,
    perfect_attendance: 'every recorded day is on time',
    leave_days: `they take an approved ${LEAVE_LABELS[p.leave_type]?.toLowerCase() || '—'} day`,
    excuse_hours: `they take approved ${LEAVE_LABELS[p.leave_type]?.toLowerCase() || '—'} hours`,
    monthly_fixed: '',
    tenure: `they’ve worked here ${p.min_months || 'N'}+ months`,
  }[rule.trigger];
  const unit = units[rule.trigger] || 'cycle';
  const per = UNIT_WORD[unit];
  const who = rule.staff_ids?.length
    ? rule.staff_ids.map((id) => staffById[id]?.full_name || `#${id}`).join(', ')
    : rule.roles?.length
      ? rule.roles.map((r) => ROLE_LABELS[r] || r).join(', ')
      : 'everyone';
  const condition = when ? ` ${unit === 'cycle' ? 'when' : 'whenever'} ${when}` : '';
  return `${verb} ${amount} ${per}${condition} — for ${who}.`;
}

/* ───────────────────────── small inputs ───────────────────────── */

function Field({ label, hint, children, className = '' }) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-soul-muted">{hint}</p> : null}
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            value === o.value ? 'bg-white text-soul-blue shadow-sm' : 'text-slate-500 hover:text-soul-blue'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ChipPicker({ options, selected, onChange, empty }) {
  const set = new Set(selected.map(String));
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = set.has(String(o.value));
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(on ? selected.filter((v) => String(v) !== String(o.value)) : [...selected, o.value])}
            className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset transition ${
              on ? 'bg-soul-blue text-white ring-soul-blue' : 'bg-white text-soul-muted ring-soul-line hover:text-soul-blue'
            }`}
          >
            {o.label}
          </button>
        );
      })}
      {!options.length ? <span className="text-xs text-soul-muted">{empty}</span> : null}
    </div>
  );
}

/* ───────────────────────── rule editor ───────────────────────── */

function TriggerSettings({ trigger, params, setParams }) {
  const set = (k) => (e) => setParams({ ...params, [k]: e.target.value });
  const time = (k, label, optional) => (
    <Field label={label} hint={optional ? 'Optional' : null}>
      <input type="time" className="input" value={params[k] || ''} onChange={set(k)} required={!optional} />
    </Field>
  );
  const count = (k, label) => (
    <Field label={label}>
      <input type="number" min="1" step="1" className="input" value={params[k] ?? ''} onChange={set(k)} required />
    </Field>
  );
  const leave = (
    <Field label="Leave type">
      <select className="input" value={params.leave_type || ''} onChange={set('leave_type')} required>
        <option value="" disabled>
          Choose…
        </option>
        {Object.entries(LEAVE_LABELS)
          .filter(([k]) => (trigger === 'excuse_hours' ? /excuse|early/.test(k) : !/excuse|early/.test(k)))
          .map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
      </select>
    </Field>
  );
  switch (trigger) {
    case 'late_arrival':
      return <div className="grid grid-cols-2 gap-3">{time('after', 'Checked in after')}{time('before', 'Up to', true)}</div>;
    case 'no_show':
      return (
        <Field label="Which no-shows">
          <Segmented
            value={params.notified || 'any'}
            onChange={(v) => setParams({ ...params, notified: v })}
            options={[
              { value: 'any', label: 'All' },
              { value: 'no', label: 'Without telling us' },
              { value: 'yes', label: 'After telling us' },
            ]}
          />
        </Field>
      );
    case 'early_checkout':
      return time('before', 'Checked out before');
    case 'overtime':
      return time('after', 'Hours worked after');
    case 'late_count':
      return <div className="grid grid-cols-2 gap-3">{count('min_count', 'Late at least (times)')}{time('after', 'Counting check-ins after', true)}</div>;
    case 'absence_count':
      return count('min_count', 'No-shows at least');
    case 'tenure':
      return count('min_months', 'Months of service at least');
    case 'leave_days':
    case 'excuse_hours':
      return leave;
    default:
      return null;
  }
}

function RuleEditor({ open, initial, onClose, catalog, staff, cycle }) {
  const qc = useQueryClient();
  const [rule, setRule] = useState(initial);
  const [preview, setPreview] = useState(null);
  const units = useMemo(() => Object.fromEntries(catalog.triggers.map((t) => [t.key, t.unit])), [catalog]);
  const staffById = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s])), [staff]);
  const unit = units[rule.trigger];
  const set = (patch) => {
    setRule((r) => ({ ...r, ...patch }));
    setPreview(null);
  };

  const payload = () => ({
    ...rule,
    amount: Number(rule.amount),
    free_count: Number(rule.free_count) || 0,
    cap_amount: rule.cap_amount === '' ? null : Number(rule.cap_amount),
  });

  const save = useMutation({
    mutationFn: () =>
      rule.id ? api.put(`/hr/payroll-rules/${rule.id}`, payload()) : api.post('/hr/payroll-rules', payload()),
    onSuccess: (res) => {
      const n = res.data?.applied;
      toast.success(n ? `Saved · applied to ${n} payroll${n === 1 ? '' : 's'} this cycle` : 'Rule saved');
      qc.invalidateQueries({ queryKey: ['hr-payroll-rules'] });
      qc.invalidateQueries({ queryKey: ['hr-rules-preview'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not save the rule'),
  });

  const runPreview = useMutation({
    mutationFn: () => api.post('/hr/payroll-rules/preview', { rule: payload(), year: cycle.year, month: cycle.month }).then((r) => r.data),
    onSuccess: setPreview,
    onError: (err) => toast.error(err.response?.data?.error || 'Could not preview the rule'),
  });

  const roleOptions = ADMIN_STAFF_FILTER_ROLES.filter((r) => r !== 'admin').map((r) => ({ value: r, label: ROLE_LABELS[r] || r }));
  const staffOptions = staff.map((s) => ({ value: s.id, label: s.full_name }));
  const whoMode = rule.staff_ids.length ? 'people' : rule.roles.length ? 'roles' : 'all';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={rule.id ? 'Edit rule' : 'New rule'}
      size="xl"
      footer={
        <>
          <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => runPreview.mutate()} disabled={runPreview.isPending}>
            <Eye className="h-4 w-4" /> {runPreview.isPending ? 'Checking…' : 'Preview this cycle'}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save rule'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl bg-soul-blue-50/70 px-4 py-3 text-sm text-soul-blue">
          <span className="font-semibold">{rule.name || 'This rule'}: </span>
          {describeRule(rule, units, staffById)}
        </div>

        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Field label="Rule name">
            <input className="input" value={rule.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Late after 11:30" />
          </Field>
          <Field label="Type">
            <Segmented
              value={rule.effect}
              onChange={(effect) => set({ effect })}
              options={[
                { value: 'deduction', label: 'Deduction' },
                { value: 'bonus', label: 'Bonus' },
              ]}
            />
          </Field>
        </div>

        <section className="space-y-3 rounded-xl border border-soul-line p-4">
          <h3 className="text-sm font-semibold text-soul-blue">1 · When does it apply?</h3>
          <select
            className="input"
            value={rule.trigger}
            onChange={(e) => set({ trigger: e.target.value, params: {} })}
          >
            {['attendance', 'leave', 'fixed'].map((group) => (
              <optgroup key={group} label={{ attendance: 'Attendance', leave: 'Leave', fixed: 'Every cycle' }[group]}>
                {catalog.triggers
                  .filter((t) => t.group === group)
                  .map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <p className="text-xs text-soul-muted">{TRIGGER_HELP[rule.trigger]}</p>
          <TriggerSettings trigger={rule.trigger} params={rule.params} setParams={(params) => set({ params })} />
        </section>

        <section className="space-y-3 rounded-xl border border-soul-line p-4">
          <h3 className="text-sm font-semibold text-soul-blue">2 · How much?</h3>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
            <Field label="Amount" hint={unit === 'cycle' ? 'Once per pay cycle' : unit === 'hour' ? 'Per hour' : 'Each time it happens'}>
              <input type="number" min="0" step="0.01" className="input" value={rule.amount} onChange={(e) => set({ amount: e.target.value })} />
            </Field>
            <Field label="Worked out as">
              <select className="input" value={rule.amount_type} onChange={(e) => set({ amount_type: e.target.value })}>
                {catalog.amount_types.map((t) => (
                  <option key={t} value={t}>
                    {AMOUNT_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {unit !== 'cycle' ? (
              <Field label="Free before it counts" hint="e.g. 2 = the first two times each cycle are free">
                <input type="number" min="0" step="1" className="input" value={rule.free_count} onChange={(e) => set({ free_count: e.target.value })} />
              </Field>
            ) : null}
            <Field label="Cap per cycle (EGP)" hint="Optional maximum per person">
              <input type="number" min="0" step="1" className="input" value={rule.cap_amount ?? ''} onChange={(e) => set({ cap_amount: e.target.value })} />
            </Field>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-soul-line p-4">
          <h3 className="text-sm font-semibold text-soul-blue">3 · Who is it for?</h3>
          <Segmented
            value={whoMode}
            onChange={(mode) =>
              set(
                mode === 'all'
                  ? { roles: [], staff_ids: [] }
                  : mode === 'roles'
                    ? { staff_ids: [], roles: rule.roles.length ? rule.roles : [roleOptions[0]?.value].filter(Boolean) }
                    : { roles: [], staff_ids: rule.staff_ids.length ? rule.staff_ids : [staffOptions[0]?.value].filter(Boolean) }
              )
            }
            options={[
              { value: 'all', label: 'Everyone' },
              { value: 'roles', label: 'Some roles' },
              { value: 'people', label: 'Specific people' },
            ]}
          />
          {whoMode === 'roles' ? <ChipPicker options={roleOptions} selected={rule.roles} onChange={(roles) => set({ roles })} /> : null}
          {whoMode === 'people' ? (
            <ChipPicker options={staffOptions} selected={rule.staff_ids} onChange={(ids) => set({ staff_ids: ids.map(Number) })} empty="No active staff" />
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts" hint="Optional">
              <input type="date" className="input" value={rule.effective_from || ''} onChange={(e) => set({ effective_from: e.target.value })} />
            </Field>
            <Field label="Ends" hint="Optional">
              <input type="date" className="input" value={rule.effective_to || ''} onChange={(e) => set({ effective_to: e.target.value })} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-soul-blue">
            <input type="checkbox" className="h-4 w-4 accent-soul-blue" checked={rule.active} onChange={(e) => set({ active: e.target.checked })} />
            Rule is on
          </label>
          <Field label="Notes" hint="Optional — why the rule exists">
            <textarea className="input min-h-[60px]" value={rule.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </section>

        {preview ? <PreviewTable data={preview} title="If you save this rule" /> : null}
      </div>
    </Modal>
  );
}

/* ───────────────────────── preview + cards ───────────────────────── */

function PreviewTable({ data, title }) {
  const rows = data?.results || [];
  return (
    <section className="rounded-xl border border-soul-line">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-soul-line px-4 py-2.5">
        <h3 className="text-sm font-semibold text-soul-blue">{title}</h3>
        <span className="text-xs text-soul-muted">
          Cycle {formatDay(data?.cycle?.from)} – {formatDay(data?.cycle?.through)} · {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
        </span>
      </header>
      {!rows.length ? (
        <p className="px-4 py-4 text-sm text-soul-muted">Nobody is affected this cycle with the attendance and leave recorded so far.</p>
      ) : (
        <div className="max-h-72 overflow-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="sticky top-0 bg-white text-left text-xs text-soul-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Person</th>
                <th className="px-3 py-2 font-medium">Rule</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.staff_user_id}-${r.rule_id}-${i}`} className="border-t border-soul-line/70">
                  <td className="px-4 py-2 font-medium text-soul-blue">{r.full_name}</td>
                  <td className="px-3 py-2 text-soul-muted">{r.reason}</td>
                  <td className={`px-4 py-2 text-right tabular-nums font-medium ${r.effect === 'bonus' ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {r.effect === 'bonus' ? '+' : '−'}
                    {currency(r.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RuleCard({ rule, units, staffById, onEdit, onDuplicate, onDelete, onToggle }) {
  const impact = rule.this_cycle || { people: 0, total: 0 };
  return (
    <li className={`card p-4 ${rule.active ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={`mt-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            rule.effect === 'bonus' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
          }`}
        >
          {rule.effect === 'bonus' ? 'Bonus' : 'Deduction'}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-soul-blue">{rule.name}</h3>
          <p className="mt-0.5 text-sm text-soul-muted">{describeRule(rule, units, staffById)}</p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-soul-muted">
            {rule.free_count ? <span className="rounded bg-slate-100 px-1.5 py-0.5">First {rule.free_count} free</span> : null}
            {rule.cap_amount ? <span className="rounded bg-slate-100 px-1.5 py-0.5">Cap {currency(rule.cap_amount)}</span> : null}
            {rule.effective_from || rule.effective_to ? (
              <span className="rounded bg-slate-100 px-1.5 py-0.5">
                {rule.effective_from ? `From ${formatDay(rule.effective_from)}` : ''} {rule.effective_to ? `until ${formatDay(rule.effective_to)}` : ''}
              </span>
            ) : null}
            {rule.active ? (
              <span className="rounded bg-soul-blue-50 px-1.5 py-0.5 text-soul-blue">
                This cycle: {impact.people} {impact.people === 1 ? 'person' : 'people'} · {currency(impact.total)}
              </span>
            ) : (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">Off</span>
            )}
          </div>
          {rule.notes ? <p className="mt-2 text-xs italic text-soul-muted">{rule.notes}</p> : null}
        </div>
        <div className="flex items-center gap-1">
          <label className="me-1 inline-flex cursor-pointer items-center gap-1.5 text-xs text-soul-muted" title={rule.active ? 'Switch off' : 'Switch on'}>
            <input type="checkbox" className="h-4 w-4 accent-soul-blue" checked={rule.active} onChange={onToggle} />
            On
          </label>
          <button type="button" className="rounded-lg p-2 text-soul-muted hover:bg-soul-blue-50 hover:text-soul-blue" onClick={onEdit} aria-label="Edit rule">
            <Pencil className="h-4 w-4" />
          </button>
          <button type="button" className="rounded-lg p-2 text-soul-muted hover:bg-soul-blue-50 hover:text-soul-blue" onClick={onDuplicate} aria-label="Duplicate rule">
            <Copy className="h-4 w-4" />
          </button>
          <button type="button" className="rounded-lg p-2 text-soul-muted hover:bg-rose-50 hover:text-rose-700" onClick={onDelete} aria-label="Delete rule">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </li>
  );
}

/* ───────────────────────── attendance basics ───────────────────────── */

const SHIFT_END_LABEL = '19:00';
const KIND_LABELS = { lateness: 'Late arrival', absence: 'No-show', unpaid_leave: 'Unpaid leave day' };

function toMinutes(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function penaltyText(factor, type) {
  const n = Number(factor) || 0;
  if (!n) return 'No penalty';
  return type === 'amount' ? currency(n) : `${n} day${n === 1 ? '' : 's'} of pay`;
}

/** Same matching as the server: start ≤ arrival ≤ end (no end = until the end of the shift); latest start wins. */
function matchBand(bands, minutes) {
  if (minutes == null) return null;
  const hits = bands.filter((b) => minutes >= (b.start_minutes ?? 0) && (b.end_minutes == null || minutes <= b.end_minutes));
  if (hits.length) return hits.sort((a, b) => (b.start_minutes ?? 0) - (a.start_minutes ?? 0))[0];
  const earliest = Math.min(...bands.map((b) => b.start_minutes ?? 0));
  if (minutes < earliest) return 'on_time';
  return bands.filter((b) => (b.start_minutes ?? 0) <= minutes).sort((a, b) => (b.start_minutes ?? 0) - (a.start_minutes ?? 0))[0] || null;
}

function PenaltyInput({ factor, type, onFactor, onType }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        className="input w-24"
        type="number"
        min="0"
        max={type === 'amount' ? 100000 : 10}
        step={type === 'amount' ? '1' : '0.05'}
        value={factor}
        onChange={(e) => onFactor(e.target.value)}
        aria-label="Penalty"
      />
      <select className="input w-auto py-2 text-xs" value={type} onChange={(e) => onType(e.target.value)} aria-label="Penalty unit">
        <option value="days">day(s) of pay</option>
        <option value="amount">EGP</option>
      </select>
    </div>
  );
}

function BandRow({ row, onSave, onDelete, saving }) {
  const [label, setLabel] = useState(row.label);
  const [factor, setFactor] = useState(String(row.factor));
  const [type, setType] = useState(row.penalty_type || 'days');
  const [from, setFrom] = useState(minutesLabel(row.start_minutes));
  const [until, setUntil] = useState(minutesLabel(row.end_minutes));
  const lateness = row.kind === 'lateness';
  const dirty =
    label !== row.label ||
    Number(factor) !== Number(row.factor) ||
    type !== (row.penalty_type || 'days') ||
    (lateness && (from !== minutesLabel(row.start_minutes) || until !== minutesLabel(row.end_minutes)));
  return (
    <tr className="border-t border-soul-line/70 align-middle">
      <td className="px-4 py-2.5">
        <input className="input min-w-[9rem]" value={label} onChange={(e) => setLabel(e.target.value)} />
      </td>
      <td className="px-3 py-2.5 text-xs text-soul-muted">{KIND_LABELS[row.kind] || row.kind}</td>
      <td className="px-3 py-2.5">
        {lateness ? <input type="time" className="input w-28" value={from} onChange={(e) => setFrom(e.target.value)} /> : <span className="text-soul-muted">—</span>}
      </td>
      <td className="px-3 py-2.5">
        {lateness ? (
          <div className="flex items-center gap-1">
            <input type="time" className="input w-28" value={until} onChange={(e) => setUntil(e.target.value)} />
            {until ? (
              <button type="button" className="text-[11px] text-soul-muted hover:text-soul-blue" onClick={() => setUntil('')} title="Clear: until the end of the shift">
                clear
              </button>
            ) : (
              <span className="whitespace-nowrap text-[11px] text-soul-muted">end of shift</span>
            )}
          </div>
        ) : (
          <span className="text-soul-muted">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <PenaltyInput factor={factor} type={type} onFactor={setFactor} onType={setType} />
      </td>
      <td className="px-4 py-2.5 text-right whitespace-nowrap">
        <button
          type="button"
          className={`${dirty ? 'btn-primary' : 'btn-secondary'} !px-3 !py-1.5 text-xs`}
          disabled={saving || !dirty}
          onClick={() =>
            onSave({
              id: row.id,
              label,
              factor: Number(factor),
              penalty_type: type,
              start_minutes: lateness ? from : row.start_minutes,
              end_minutes: lateness ? until || null : row.end_minutes,
              active: row.active,
            })
          }
        >
          Save
        </button>
        {lateness ? (
          <button type="button" className="ms-1 rounded-lg p-2 text-soul-muted hover:bg-rose-50 hover:text-rose-700" onClick={() => onDelete(row)} aria-label="Remove band">
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </td>
    </tr>
  );
}

const BLANK_BAND = { label: '', start_minutes: '12:01', end_minutes: '', factor: '1', penalty_type: 'days' };

function AttendanceBasics() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(BLANK_BAND);
  const [tryTime, setTryTime] = useState('11:40');
  const [trySalary, setTrySalary] = useState('9000');
  const { data, isLoading } = useQuery({
    queryKey: ['hr-deduction-rules'],
    queryFn: () => api.get('/hr/deduction-rules').then((r) => r.data),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['hr-deduction-rules'] });
  const save = useMutation({
    mutationFn: (row) => api.put(`/hr/deduction-rules/${row.id}`, row),
    onSuccess: () => {
      toast.success('Saved');
      refresh();
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not save'),
  });
  const create = useMutation({
    mutationFn: (row) => api.post('/hr/deduction-rules', row),
    onSuccess: () => {
      toast.success('Band added');
      setDraft(BLANK_BAND);
      refresh();
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not add the band'),
  });
  const remove = useMutation({
    mutationFn: (row) => api.delete(`/hr/deduction-rules/${row.id}`),
    onSuccess: () => {
      toast.success('Band removed');
      refresh();
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not remove the band'),
  });

  if (isLoading) return <LoadingSpinner />;
  const rows = (Array.isArray(data) ? data : []).sort(
    (a, b) => (a.kind === 'lateness' ? 0 : 1) - (b.kind === 'lateness' ? 0 : 1) || (a.start_minutes ?? 9999) - (b.start_minutes ?? 9999)
  );
  const bands = rows.filter((r) => r.kind === 'lateness' && r.active !== false);
  const hit = matchBand(bands, toMinutes(tryTime));
  const rate = (Number(trySalary) || 0) / 30;
  const tryAmount = hit && hit !== 'on_time' ? (hit.penalty_type === 'amount' ? Number(hit.factor) : rate * Number(hit.factor)) : 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-soul-muted">
        Applied the moment attendance is recorded (including phone clock-ins). A late arrival gets the penalty of the band it falls in:
        from the start time to the end time. Leave the end empty to run until the end of the shift ({SHIFT_END_LABEL}). The penalty is
        either days of pay (base salary ÷ 30 per day) or a fixed amount in EGP.
      </p>
      <section className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="text-left text-xs text-soul-muted">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-3 py-3 font-medium">Applies to</th>
              <th className="px-3 py-3 font-medium">From</th>
              <th className="px-3 py-3 font-medium">Until</th>
              <th className="px-3 py-3 font-medium">Penalty</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <BandRow
                key={`${row.id}-${row.start_minutes}-${row.end_minutes}-${row.factor}-${row.penalty_type}`}
                row={row}
                onSave={(r) => save.mutate(r)}
                onDelete={(r) => remove.mutate(r)}
                saving={save.isPending}
              />
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <form
          className="card flex flex-wrap items-end gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ ...draft, end_minutes: draft.end_minutes || null, factor: Number(draft.factor) });
          }}
        >
          <Field label="New lateness band">
            <input className="input" required value={draft.label} placeholder="e.g. 12:01 onwards" onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} />
          </Field>
          <Field label="From">
            <input type="time" className="input w-32" required value={draft.start_minutes} onChange={(e) => setDraft((d) => ({ ...d, start_minutes: e.target.value }))} />
          </Field>
          <Field label="Until" hint="Empty = end of shift">
            <input type="time" className="input w-32" value={draft.end_minutes} onChange={(e) => setDraft((d) => ({ ...d, end_minutes: e.target.value }))} />
          </Field>
          <Field label="Penalty">
            <PenaltyInput
              factor={draft.factor}
              type={draft.penalty_type}
              onFactor={(factor) => setDraft((d) => ({ ...d, factor }))}
              onType={(penalty_type) => setDraft((d) => ({ ...d, penalty_type }))}
            />
          </Field>
          <button type="submit" className="btn-primary" disabled={create.isPending}>
            Add band
          </button>
        </form>

        <section className="card space-y-3 p-4">
          <p className="text-sm font-semibold text-soul-blue">Try it</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Arrives at">
              <input type="time" className="input" value={tryTime} onChange={(e) => setTryTime(e.target.value)} />
            </Field>
            <Field label="Base salary">
              <input type="number" className="input" value={trySalary} onChange={(e) => setTrySalary(e.target.value)} />
            </Field>
          </div>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-soul-blue">
            {hit === 'on_time' || !hit
              ? 'On time: no penalty.'
              : `${hit.label} · ${penaltyText(hit.factor, hit.penalty_type)} → ${currency(Math.round(tryAmount * 100) / 100)}`}
          </p>
        </section>
      </div>
    </div>
  );
}

/* ───────────────────────── page ───────────────────────── */

export default function HrRules() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('rules');
  const [editing, setEditing] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['hr-payroll-rules'],
    queryFn: () => api.get('/hr/payroll-rules').then((r) => r.data),
  });
  const cycle = data?.cycle;
  const preview = useQuery({
    queryKey: ['hr-rules-preview', cycle?.year, cycle?.month],
    queryFn: () => api.post('/hr/payroll-rules/preview', { year: cycle.year, month: cycle.month }).then((r) => r.data),
    enabled: Boolean(showPreview && cycle),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['hr-payroll-rules'] });
    qc.invalidateQueries({ queryKey: ['hr-rules-preview'] });
  };

  const toggle = useMutation({
    mutationFn: (rule) => api.put(`/hr/payroll-rules/${rule.id}`, { ...rule, active: !rule.active }),
    onSuccess: (_res, rule) => {
      toast.success(rule.active ? 'Rule switched off' : 'Rule switched on');
      refresh();
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not update the rule'),
  });
  const remove = useMutation({
    mutationFn: (rule) => api.delete(`/hr/payroll-rules/${rule.id}`),
    onSuccess: () => {
      toast.success('Rule deleted');
      refresh();
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not delete the rule'),
  });
  const applyNow = useMutation({
    mutationFn: () => api.post('/hr/payroll-rules/apply', { year: cycle.year, month: cycle.month }).then((r) => r.data),
    onSuccess: (res) => {
      toast.success(`Applied ${res.results.length} ${res.results.length === 1 ? 'entry' : 'entries'} to this cycle’s payroll`);
      refresh();
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not apply the rules'),
  });

  if (isLoading) return <LoadingSpinner />;
  if (error) return <EmptyState title={error.response?.data?.error || 'Could not load HR rules'} />;

  const catalog = data?.catalog || { triggers: [], amount_types: [], leave_types: [] };
  const staff = data?.staff || [];
  const rules = data?.rules || [];
  const units = Object.fromEntries(catalog.triggers.map((t) => [t.key, t.unit]));
  const staffById = Object.fromEntries(staff.map((s) => [s.id, s]));
  const open = (rule) => setEditing({ ...BLANK_RULE, ...rule, cap_amount: rule.cap_amount ?? '', roles: rule.roles || [], staff_ids: rule.staff_ids || [] });

  return (
    <div className="space-y-5">
      <div className="page-header mb-0 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">HR rules</h1>
          <p className="page-subtitle">
            Build any deduction or bonus. Rules apply automatically to every unpaid payroll and payslip; paid payrolls are never changed.
            {cycle ? ` Current pay cycle: ${formatDay(cycle.from)} – ${formatDay(cycle.through)}.` : ''}
          </p>
        </div>
        {tab === 'rules' ? (
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => open(BLANK_RULE)}>
            <Plus className="h-4 w-4" /> New rule
          </button>
        ) : null}
      </div>

      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 sm:w-fit">
        {[
          { id: 'rules', label: `Payroll rules (${rules.length})` },
          { id: 'basics', label: 'Attendance basics' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition sm:flex-none ${
              tab === t.id ? 'bg-white text-soul-blue shadow-sm' : 'text-slate-500 hover:text-soul-blue'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'basics' ? (
        <AttendanceBasics />
      ) : (
        <>
          <div className="card p-4">
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-soul-muted">
              <Sparkles className="h-3.5 w-3.5" /> Start from an example
            </p>
            <div className="flex flex-wrap gap-2">
              {TEMPLATES.map((t) => (
                <button key={t.name} type="button" className="rounded-full bg-soul-blue-50 px-3 py-1.5 text-xs font-medium text-soul-blue hover:bg-soul-blue/10" onClick={() => open(t)}>
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          {!rules.length ? (
            <EmptyState title="No payroll rules yet" subtitle="Create one, or start from an example above. It will apply to this cycle straight away." />
          ) : (
            <ul className="space-y-3">
              {rules.map((rule) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  units={units}
                  staffById={staffById}
                  onEdit={() => open(rule)}
                  onDuplicate={() => open({ ...rule, id: undefined, name: `${rule.name} (copy)` })}
                  onDelete={() => {
                    if (window.confirm(`Delete “${rule.name}”? It will be removed from unpaid payrolls.`)) remove.mutate(rule);
                  }}
                  onToggle={() => toggle.mutate(rule)}
                />
              ))}
            </ul>
          )}

          <div className="card space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold text-soul-blue">This cycle</h2>
                <p className="text-xs text-soul-muted">See exactly who every active rule affects, and re-apply after correcting attendance.</p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => setShowPreview((v) => !v)}>
                  <Eye className="h-4 w-4" /> {showPreview ? 'Hide' : 'Show'} breakdown
                </button>
                <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => applyNow.mutate()} disabled={applyNow.isPending || !cycle}>
                  <Play className="h-4 w-4" /> {applyNow.isPending ? 'Applying…' : 'Apply now'}
                </button>
              </div>
            </div>
            {showPreview ? preview.isLoading ? <LoadingSpinner /> : <PreviewTable data={preview.data} title="Active rules this cycle" /> : null}
          </div>
        </>
      )}

      {editing ? (
        <RuleEditor
          key={editing.id || editing.name || 'new'}
          open
          initial={editing}
          onClose={() => setEditing(null)}
          catalog={catalog}
          staff={staff}
          cycle={cycle}
        />
      ) : null}
    </div>
  );
}
