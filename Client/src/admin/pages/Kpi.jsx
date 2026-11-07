import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  BarChart3,
  CalendarCheck,
  CheckSquare,
  ChevronRight,
  ClipboardList,
  Copy,
  Pencil,
  Plus,
  Search,
  Star,
  Target,
  Trash2,
  UserMinus,
  Users,
} from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import { ROLE_LABELS } from '../utils/permissions';
import { useAuth } from '../context/AuthContext';
import { currency } from '../utils/formatters';

/* ───────────────────────── vocabulary & helpers ───────────────────────── */

const TEAM_LABELS = {
  mine: 'My team',
  all: 'Everyone',
  reservations: 'Reservations team',
  operations: 'Operations team',
  acquisition: 'Unit acquisition team',
};

const METRIC_INFO = {
  reservations: { icon: CalendarCheck, help: 'Reservations this person makes in the period — by number or by total value.' },
  unit_acquisitions: { icon: Target, help: 'Units this person adds to the system in the period.' },
  reviews: { icon: Star, help: 'Average guest review for stays this person checked in. Needs at least 3 reviews to judge.' },
  check_ins: { icon: CheckSquare, help: 'Check-ins this person hands over to guests in the period.' },
};

const STATUS_STYLES = {
  not_started: 'bg-slate-100 text-slate-600',
  early: 'bg-slate-100 text-slate-700',
  on_track: 'bg-emerald-50 text-emerald-800',
  at_risk: 'bg-amber-50 text-amber-800',
  behind: 'bg-rose-50 text-rose-800',
  achieved: 'bg-emerald-600 text-white',
  missed: 'bg-rose-600 text-white',
};

const BAR_STYLES = {
  on_track: 'bg-emerald-500',
  achieved: 'bg-emerald-600',
  at_risk: 'bg-amber-500',
  behind: 'bg-rose-500',
  missed: 'bg-rose-600',
};

const STATUS_ORDER = ['behind', 'at_risk', 'on_track', 'early', 'achieved', 'missed', 'not_started'];

function shiftIso(iso, days) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDay(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  if (!iso) return '';
  return new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
}

function formatAmount(kpi, value) {
  if (value == null) return '—';
  if (kpi.measure === 'value') return currency(value);
  return String(Math.round(Number(value) * 10) / 10);
}

function formatTarget(kpi) {
  if (kpi.metric === 'reviews') return `${kpi.target_value} average`;
  if (kpi.measure === 'value') return currency(kpi.target_value);
  if (kpi.metric === 'unit_acquisitions') return `${kpi.target_value} units`;
  if (kpi.metric === 'check_ins') return `${kpi.target_value} check-ins`;
  return `${kpi.target_value} reservations`;
}

function formatActual(kpi) {
  if (kpi.metric === 'reviews') {
    if (kpi.actual == null) return 'No reviews yet';
    return `${kpi.actual} avg · ${kpi.review_count} review${kpi.review_count === 1 ? '' : 's'}`;
  }
  return formatAmount(kpi, kpi.actual ?? 0);
}

function kpiName(kpi) {
  return kpi.title || kpi.metric_label;
}

function paceLine(kpi) {
  const p = kpi.pace || {};
  if (kpi.status === 'not_started') return `Starts ${formatDay(kpi.starts_on)}`;
  if (kpi.metric === 'reviews') {
    if (kpi.status === 'early') return `Needs ${p.min_reviews || 3}+ reviews to judge · ${p.days_left} days left`;
    return p.days_left ? `${p.days_left} days left` : 'Ended';
  }
  const parts = [];
  if (p.days_left) parts.push(`Expected by today ${formatAmount(kpi, p.expected)}`);
  if (p.days_left && p.projected != null) parts.push(`on pace for ${formatAmount(kpi, p.projected)}`);
  if (kpi.daily_target && kpi.status !== 'achieved') parts.push(`today’s target ${formatAmount(kpi, kpi.daily_target.amount)}`);
  parts.push(p.days_left ? `${p.days_left} days left` : 'ended');
  return parts.join(' · ');
}

function periodPreset(key, today) {
  const [y, m] = today.split('-').map(Number);
  const iso = (yy, mm, dd) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  switch (key) {
    case 'this_month':
      return { starts_on: today, deadline: iso(y, m + 1, 0) };
    case 'next_month':
      return { starts_on: iso(y, m + 1, 1), deadline: iso(y, m + 2, 0) };
    case 'next_7':
      return { starts_on: today, deadline: shiftIso(today, 6) };
    case 'next_30':
      return { starts_on: today, deadline: shiftIso(today, 29) };
    default:
      return null;
  }
}

function daysBetween(from, to) {
  if (!from || !to) return 0;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
}

/** Every KPI once, with the people on it (the API returns KPIs per person). */
function groupKpis(staff) {
  const map = new Map();
  for (const person of staff) {
    for (const kpi of person.kpis || []) {
      if (!map.has(kpi.id)) map.set(kpi.id, { ...kpi, people: [] });
      map.get(kpi.id).people.push({ ...person, kpi });
    }
  }
  return [...map.values()];
}

/* ───────────────────────── small UI pieces ───────────────────────── */

function StatusChip({ status, label }) {
  return (
    <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[status] || STATUS_STYLES.early}`}>
      {label || status}
    </span>
  );
}

function PaceBar({ kpi }) {
  const shown = Math.min(100, Math.max(0, Number(kpi.percent) || 0));
  const expected = kpi.metric === 'reviews' ? null : kpi.pace?.expected_percent;
  return (
    <div className="relative mt-2 h-2 rounded-full bg-slate-100" aria-hidden="true">
      <div className={`h-2 rounded-full ${BAR_STYLES[kpi.status] || 'bg-slate-400'}`} style={{ width: `${shown}%` }} />
      {expected != null && kpi.status !== 'not_started' && expected < 100 ? (
        <span className="absolute -top-1 h-4 w-0.5 rounded bg-soul-blue/70" style={{ left: `${Math.min(100, expected)}%` }} title="Expected by today" />
      ) : null}
    </div>
  );
}

function Score({ score, size = 'text-xl' }) {
  if (score == null) return <span className="text-sm text-soul-muted">—</span>;
  const tone = score >= 90 ? 'text-emerald-700' : score >= 70 ? 'text-amber-700' : 'text-rose-700';
  return <span className={`font-display tabular-nums ${size} ${tone}`}>{Math.round(score)}%</span>;
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

/** Today's share of the target: what's left before today ÷ days left (including today). */
function DailyTargetBox({ kpi, size = 'sm' }) {
  const d = kpi.daily_target;
  if (!d || kpi.status === 'achieved') return null;
  const met = d.met;
  return (
    <div
      className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-right ${met ? 'border-emerald-200 bg-emerald-50' : 'border-soul-line bg-white'}`}
      title={`Still needed before today ${formatAmount(kpi, d.remaining_before_today)} ÷ ${d.days_left} day${d.days_left === 1 ? '' : 's'} left`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-soul-muted">Today’s target</p>
      <p className={`font-semibold tabular-nums text-soul-blue ${size === 'lg' ? 'text-base' : 'text-sm'}`}>{formatAmount(kpi, d.amount)}</p>
      <p className={`text-[11px] tabular-nums ${met ? 'text-emerald-700' : 'text-soul-muted'}`}>
        {met ? '✓ ' : ''}{formatAmount(kpi, d.done_today)} done today
      </p>
    </div>
  );
}

function KpiCard({ kpi, active, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`card w-full p-4 text-left transition ${active ? 'ring-2 ring-[var(--pms-accent,#F28C28)]' : 'hover:shadow-md'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-soul-blue">{kpiName(kpi)}</p>
            <StatusChip status={kpi.status} label={kpi.status_label} />
          </div>
          <p className="mt-1 text-xs text-soul-muted">
            Target {formatTarget(kpi)} · {formatDay(kpi.starts_on, { day: 'numeric', month: 'short' })}–{formatDay(kpi.deadline, { day: 'numeric', month: 'short' })}
          </p>
        </div>
        <DailyTargetBox kpi={kpi} />
      </div>
      <p className="mt-2 text-sm">
        {formatActual(kpi)} · <span className="font-semibold">{kpi.percent}%</span>
      </p>
      <PaceBar kpi={kpi} />
      <p className="mt-1.5 text-[11px] text-soul-muted">{paceLine(kpi)}</p>
    </button>
  );
}

/* ───────────────────────── progress chart ───────────────────────── */

/** Running total against a straight line to the target. Single series, so no legend; the title names it. */
function ProgressChart({ kpi }) {
  const [hover, setHover] = useState(null);
  const total = kpi.pace?.total_days || daysBetween(kpi.starts_on, kpi.deadline);
  const points = useMemo(() => {
    let sum = 0;
    return (kpi.daily || []).map((row, i) => {
      sum += Number(row.value) || 0;
      return { i, date: row.date, value: sum };
    });
  }, [kpi.daily]);
  if (!total || kpi.metric === 'reviews') return null;
  const target = Number(kpi.target_value) || 0;
  const max = Math.max(target, ...points.map((p) => p.value), 1) * 1.08;
  const W = 600;
  const H = 170;
  const pad = { l: 8, r: 8, t: 12, b: 22 };
  const x = (i) => pad.l + ((W - pad.l - pad.r) * i) / Math.max(1, total - 1);
  const y = (v) => H - pad.b - ((H - pad.t - pad.b) * v) / max;
  const line = points.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const hp = hover != null ? points[hover] : null;
  const expectedAt = (i) => (target * (i + 1)) / total;

  return (
    <figure className="relative">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-soul-blue">Running total vs. target pace</span>
        <span className="text-[11px] text-soul-muted">Dashed line = where it should be each day</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label={`Running total ${formatAmount(kpi, points.at(-1)?.value || 0)} of ${formatTarget(kpi)}`}>
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="stroke-slate-200" strokeWidth="1" />
        <line x1={pad.l} x2={W - pad.r} y1={y(target)} y2={y(target)} className="stroke-slate-200" strokeWidth="1" />
        <text x={W - pad.r} y={y(target) - 4} textAnchor="end" className="fill-slate-500 text-[11px]">
          Target {formatAmount(kpi, target)}
        </text>
        <line x1={x(0)} y1={y(expectedAt(0))} x2={x(total - 1)} y2={y(target)} className="stroke-slate-400" strokeWidth="1.5" strokeDasharray="4 4" />
        {points.length ? <path d={line} fill="none" className="stroke-soul-blue" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /> : null}
        {hp ? (
          <>
            <line x1={x(hp.i)} x2={x(hp.i)} y1={pad.t} y2={y(0)} className="stroke-slate-300" strokeWidth="1" />
            <circle cx={x(hp.i)} cy={y(hp.value)} r="4.5" className="fill-soul-blue stroke-white" strokeWidth="2" />
          </>
        ) : null}
        <text x={pad.l} y={H - 6} className="fill-slate-500 text-[11px]">{formatDay(kpi.starts_on, { day: 'numeric', month: 'short' })}</text>
        <text x={W - pad.r} y={H - 6} textAnchor="end" className="fill-slate-500 text-[11px]">{formatDay(kpi.deadline, { day: 'numeric', month: 'short' })}</text>
        {points.map((p) => (
          <rect
            key={p.date}
            x={x(p.i) - (W / total) / 2}
            y={0}
            width={W / total}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(p.i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hp ? (
        <div
          className="pointer-events-none absolute top-8 z-10 rounded-lg border border-soul-line bg-white px-3 py-2 text-xs shadow-lg"
          style={{ left: `clamp(0px, calc(${(x(hp.i) / W) * 100}% - 70px), calc(100% - 150px))` }}
        >
          <p className="font-semibold text-soul-blue">{formatDay(hp.date)}</p>
          <p className="text-soul-blue">So far: {formatAmount(kpi, hp.value)}</p>
          <p className="text-soul-muted">Expected: {formatAmount(kpi, expectedAt(hp.i))}</p>
        </div>
      ) : null}
    </figure>
  );
}

/* ───────────────────────── checklist pieces ───────────────────────── */

function useTick() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => api.post(`/kpi/checklists/${payload.checklistId}/ticks`, payload).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kpi'] }),
    onError: (err) => toast.error(err.response?.data?.error || 'Could not update the checklist'),
  });
}

/** Checklist edits only change later days, so each day shows the items it had. */
function itemOnDay(item, day) {
  if (!day) return !item.active_until;
  if (item.active_from && day < item.active_from) return false;
  if (item.active_until && day > item.active_until) return false;
  return true;
}

function ChecklistItems({ checklist, kpi, staffId, day, today, canFixAnyDay }) {
  const { user } = useAuth();
  const tick = useTick();
  const yesterday = today ? shiftIso(today, -1) : null;
  const own = Number(user?.id) === Number(staffId);
  const editable = Boolean(day) && (!today || day <= today) && (canFixAnyDay || checklist.can_delete || (own && (!yesterday || day >= yesterday)));
  return (
    <ul className="mt-2 space-y-1.5">
      {checklist.items.filter((item) => itemOnDay(item, day)).map((item) => {
        const checked = (item.checked_dates || []).includes(day);
        return (
          <li key={item.id}>
            <label className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm ${editable ? 'cursor-pointer hover:bg-slate-50' : 'opacity-70'}`}>
              <input
                type="checkbox"
                className="h-4 w-4 accent-soul-blue"
                checked={checked}
                disabled={!editable || tick.isPending}
                onChange={() => tick.mutate({ checklistId: checklist.id, staff_id: staffId, item_id: item.id, date: day, checked: !checked })}
              />
              <span className={checked ? 'text-soul-muted line-through' : 'text-soul-blue'}>{item.label}</span>
            </label>
          </li>
        );
      })}
      {!editable && own && day < (yesterday || day) ? (
        <li className="px-2 text-[11px] text-soul-muted">You can tick today or yesterday. Ask your manager to fix older days.</li>
      ) : null}
      {kpi && !kpi.work_days?.includes(day) && day <= (today || day) ? (
        <li className="px-2 text-[11px] text-soul-muted">Day off or approved leave — this day doesn’t count.</li>
      ) : null}
    </ul>
  );
}

/** Seven-day strip: pick a day, see how complete each day was. */
function WeekStrip({ kpi, day, setDay, today }) {
  const last = today && today < kpi.deadline ? today : kpi.deadline;
  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = shiftIso(last, -i);
    if (d >= kpi.starts_on) days.push(d);
  }
  const doneFor = (d) => {
    let checked = 0;
    let total = 0;
    for (const c of kpi.checklists || []) {
      const onList = c.items.filter((it) => itemOnDay(it, d));
      total += onList.length;
      checked += onList.filter((it) => (it.checked_dates || []).includes(d)).length;
    }
    return { checked, total };
  };
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {days.map((d) => {
        const { checked, total } = doneFor(d);
        const off = !(kpi.work_days || []).includes(d);
        const full = total && checked === total;
        return (
          <button
            key={d}
            type="button"
            onClick={() => setDay(d)}
            className={`min-w-[3.6rem] rounded-xl border px-2 py-1.5 text-center text-xs transition ${
              d === day ? 'border-soul-blue bg-soul-blue text-white' : 'border-soul-line bg-white text-soul-blue hover:bg-slate-50'
            }`}
          >
            <span className="block font-medium">{formatDay(d, { weekday: 'short' })}</span>
            <span className="block opacity-80">{formatDay(d, { day: 'numeric' })}</span>
            <span className={`mt-0.5 block text-[10px] ${d === day ? 'text-white/80' : full ? 'text-emerald-700' : 'text-soul-muted'}`}>
              {off ? 'off' : `${checked}/${total}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────── modals ───────────────────────── */

function ChecklistFields({ value, onChange, maxWeight, people }) {
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1.5fr_1fr]">
        <div>
          <label className="label">Checklist name</label>
          <input className="input" placeholder="e.g. Daily follow-ups" value={value.title} onChange={(e) => set({ title: e.target.value })} />
        </div>
        <div>
          <label className="label">Share of the KPI (%)</label>
          <input className="input" type="number" min="1" max={maxWeight} step="1" value={value.weight_percent} onChange={(e) => set({ weight_percent: e.target.value })} />
          <p className="mt-1 text-[11px] text-soul-muted">The rest stays on the result. Up to {maxWeight}%.</p>
        </div>
      </div>
      <div className="space-y-2">
        <label className="label">Things to tick every working day</label>
        {value.items.map((item, i) => (
          <div key={i} className="flex gap-2">
            <span className="grid h-10 w-7 shrink-0 place-items-center text-xs text-soul-muted">{i + 1}.</span>
            <input
              className="input"
              value={item}
              placeholder={i === 0 ? 'e.g. Call back every new lead' : 'Another item'}
              onChange={(e) => {
                const items = value.items.slice();
                items[i] = e.target.value;
                set({ items });
              }}
            />
            {value.items.length > 1 ? (
              <button type="button" className="rounded-lg px-2 text-soul-muted hover:bg-rose-50 hover:text-rose-700" aria-label="Remove item" onClick={() => set({ items: value.items.filter((_, k) => k !== i) })}>
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ))}
        {value.items.length < 12 ? (
          <button type="button" className="text-sm font-medium text-soul-blue hover:underline" onClick={() => set({ items: [...value.items, ''] })}>
            + Add item
          </button>
        ) : null}
      </div>
      {people && people.length > 1 ? (
        <div className="space-y-2">
          <label className="label">Who ticks it</label>
          <Segmented
            value={value.scope}
            onChange={(scope) => set({ scope })}
            options={[
              { value: 'all', label: `Everyone on the KPI (${people.length})` },
              { value: 'staff', label: 'Some of them' },
            ]}
          />
          {value.scope === 'staff' ? (
            <div className="flex flex-wrap gap-1.5">
              {people.map((p) => {
                const on = value.staff_ids.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => set({ staff_ids: on ? value.staff_ids.filter((id) => id !== p.id) : [...value.staff_ids, p.id] })}
                    className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset ${on ? 'bg-soul-blue text-white ring-soul-blue' : 'bg-white text-soul-muted ring-soul-line'}`}
                  >
                    {p.full_name}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const BLANK_CHECKLIST = { title: '', weight_percent: '20', items: [''], scope: 'all', staff_ids: [] };

function checklistPayload(value) {
  return {
    title: value.title,
    weight_percent: Number(value.weight_percent),
    items: value.items.map((i) => i.trim()).filter(Boolean),
    scope: value.scope === 'staff' ? 'staff' : 'all',
    staff_ids: value.staff_ids,
  };
}

function AddChecklistModal({ kpi, onClose }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(BLANK_CHECKLIST);
  const used = Number(kpi.checklist_weight) || 0;
  const save = useMutation({
    mutationFn: () => api.post(`/kpi/${kpi.id}/checklists`, checklistPayload(value)).then((r) => r.data),
    onSuccess: () => {
      toast.success('Checklist added');
      qc.invalidateQueries({ queryKey: ['kpi'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not add the checklist'),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Daily checklist · ${kpiName(kpi)}`}
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Add checklist</button>
        </>
      }
    >
      {used >= 100 ? (
        <p className="text-sm text-soul-muted">Checklists already make up 100% of this KPI. Remove one first.</p>
      ) : (
        <ChecklistFields value={value} onChange={setValue} maxWeight={100 - used} people={kpi.people} />
      )}
    </Modal>
  );
}

function EditKpiModal({ kpi, today, onClose }) {
  const qc = useQueryClient();
  const started = Boolean(today) && kpi.starts_on <= today;
  const finished = Boolean(today) && kpi.deadline < today;
  const [edit, setEdit] = useState({
    title: kpi.title || '',
    target_value: String(kpi.target_value),
    starts_on: kpi.starts_on,
    deadline: kpi.deadline,
    notes: kpi.notes || '',
    measure: kpi.measure,
  });
  const ownLists = (kpi.checklists || []).filter((c) => c.can_delete);
  const [lists, setLists] = useState(() =>
    ownLists.map((c) => ({
      id: c.id,
      title: c.title,
      weight_percent: String(c.weight_percent),
      items: c.items.filter((it) => !it.active_until || (today && it.active_until >= today)).map((it) => ({ id: it.id, label: it.label })),
    }))
  );
  const save = useMutation({
    mutationFn: async () => {
      await api.patch(`/kpi/${kpi.id}`, { ...edit, target_value: Number(edit.target_value) });
      for (const list of lists) {
        await api.patch(`/kpi/${kpi.id}/checklists/${list.id}`, {
          title: list.title,
          weight_percent: Number(list.weight_percent),
          items: list.items.filter((it) => it.label.trim()),
        });
      }
    },
    onSuccess: () => {
      toast.success('KPI updated');
      qc.invalidateQueries({ queryKey: ['kpi'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not update the KPI'),
  });
  const setList = (i, patch) => setLists((all) => all.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const set = (patch) => setEdit((c) => ({ ...c, ...patch }));
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit KPI"
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={save.isPending || finished} onClick={() => save.mutate()}>Save changes</button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-soul-muted">{kpi.metric_label} · {kpi.measure_label}. Changes apply to everyone on this KPI.</p>
        {finished ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-soul-muted">This KPI has finished. Its results are final and can’t be changed.</p>
        ) : started ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Changes apply from today on. Days before today are already counted and stay as they were.
          </p>
        ) : null}
        <div>
          <label className="label">Name</label>
          <input className="input" value={edit.title} placeholder={kpi.metric_label} onChange={(e) => set({ title: e.target.value })} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label">Target</label>
            <input className="input" type="number" min="1" max={kpi.metric === 'reviews' ? '5' : undefined} step={kpi.metric === 'reviews' || kpi.measure === 'value' ? '0.1' : '1'} value={edit.target_value} onChange={(e) => set({ target_value: e.target.value })} />
          </div>
          <div>
            <label className="label">Starts</label>
            <input className="input disabled:opacity-60" type="date" disabled={started} title={started ? 'This KPI has started, so its start date stays' : undefined} value={edit.starts_on} onChange={(e) => set({ starts_on: e.target.value })} />
          </div>
          <div>
            <label className="label">Deadline</label>
            <input className="input" type="date" min={today || undefined} value={edit.deadline} onChange={(e) => set({ deadline: e.target.value })} />
          </div>
        </div>
        {lists.map((list, i) => (
          <div key={list.id} className="space-y-3 rounded-xl border border-soul-line p-4">
            <p className="text-sm font-semibold text-soul-blue">Daily checklist</p>
            <div className="grid gap-4 sm:grid-cols-[1.5fr_1fr]">
              <div>
                <label className="label">Checklist name</label>
                <input className="input" value={list.title} onChange={(e) => setList(i, { title: e.target.value })} />
              </div>
              <div>
                <label className="label">Share of the KPI (%)</label>
                <input className="input" type="number" min="1" max="100" step="1" value={list.weight_percent} onChange={(e) => setList(i, { weight_percent: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <label className="label">Things to tick every working day</label>
              {list.items.map((item, k) => (
                <div key={item.id || `new-${k}`} className="flex gap-2">
                  <span className="grid h-10 w-7 shrink-0 place-items-center text-xs text-soul-muted">{k + 1}.</span>
                  <input
                    className="input"
                    value={item.label}
                    placeholder="Another item"
                    onChange={(e) => setList(i, { items: list.items.map((it, j) => (j === k ? { ...it, label: e.target.value } : it)) })}
                  />
                  {list.items.length > 1 ? (
                    <button type="button" className="rounded-lg px-2 text-soul-muted hover:bg-rose-50 hover:text-rose-700" aria-label="Remove item" onClick={() => setList(i, { items: list.items.filter((_, j) => j !== k) })}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              ))}
              {list.items.length < 12 ? (
                <button type="button" className="text-sm font-medium text-soul-blue hover:underline" onClick={() => setList(i, { items: [...list.items, { id: null, label: '' }] })}>
                  + Add item
                </button>
              ) : null}
              {started ? <p className="text-[11px] text-soul-muted">New items start today; removed items stay on the days they were ticked.</p> : null}
            </div>
          </div>
        ))}
        <div>
          <label className="label">Notes</label>
          <textarea className="input min-h-[56px]" value={edit.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}

/* ───────────────────────── new KPI wizard ───────────────────────── */

const STEPS = ['Measure', 'Target & period', 'People', 'Daily checklist', 'Review'];

function NewKpiWizard({ data, onClose }) {
  const qc = useQueryClient();
  const today = data.today;
  const metrics = data.metrics || [];
  const teamKeys = data.team_keys || [];
  const team = data.team || [];
  const [step, setStep] = useState(0);
  const [peopleSearch, setPeopleSearch] = useState('');
  const [form, setForm] = useState(() => ({
    metric: metrics[0]?.key || 'reservations',
    measure: metrics[0]?.measures?.[0]?.key || 'count',
    target_value: '30',
    period: 'this_month',
    ...periodPreset('this_month', today),
    title: '',
    notes: '',
    scope: 'team',
    team_key: teamKeys[0] || 'mine',
    staff_ids: [],
    withChecklist: false,
    checklist: BLANK_CHECKLIST,
  }));
  const set = (patch) => setForm((c) => ({ ...c, ...patch }));
  const metric = metrics.find((m) => m.key === form.metric);
  const length = daysBetween(form.starts_on, form.deadline);
  const draft = { metric: form.metric, measure: form.measure, target_value: Number(form.target_value), metric_label: metric?.label };
  const peopleCount = form.scope === 'staff' ? form.staff_ids.length : null;

  const problems = [
    !(Number(form.target_value) > 0) && 'Set a target',
    form.metric === 'reviews' && !(Number(form.target_value) >= 1 && Number(form.target_value) <= 5) && 'A review target is a rating from 1 to 5',
    (!form.starts_on || !form.deadline || form.deadline < form.starts_on) && 'The deadline must be on or after the start',
    length > 120 && 'A KPI can cover at most 120 days',
    form.scope === 'staff' && !form.staff_ids.length && 'Choose at least one person',
    form.withChecklist && !form.checklist.items.some((i) => i.trim()) && 'Add at least one checklist item',
    form.withChecklist && form.checklist.title.trim().length < 2 && 'Name the checklist',
  ].filter(Boolean);
  const stepProblems = {
    1: problems.filter((p) => /target|deadline|120|rating/i.test(p)),
    2: problems.filter((p) => /person/.test(p)),
    3: problems.filter((p) => /checklist/i.test(p)),
  };

  const create = useMutation({
    mutationFn: async () => {
      const { data: created } = await api.post('/kpi', {
        metric: form.metric,
        measure: form.measure,
        target_value: Number(form.target_value),
        starts_on: form.starts_on,
        deadline: form.deadline,
        scope: form.scope,
        team_key: form.team_key,
        staff_ids: form.staff_ids,
        title: form.title,
        notes: form.notes,
      });
      if (form.withChecklist) {
        await api.post(`/kpi/${created.id}/checklists`, { ...checklistPayload(form.checklist), scope: 'all', staff_ids: [] });
      }
      return created;
    },
    onSuccess: () => {
      toast.success(form.withChecklist ? 'KPI and daily checklist created' : 'KPI created');
      qc.invalidateQueries({ queryKey: ['kpi'] });
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not create the KPI'),
  });

  const filteredTeam = team.filter((p) => p.full_name.toLowerCase().includes(peopleSearch.trim().toLowerCase()));
  const perDay = length && Number(form.target_value) > 0 && form.metric !== 'reviews' ? Number(form.target_value) / length : null;

  return (
    <Modal
      open
      onClose={onClose}
      title="New KPI"
      size="xl"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={() => (step ? setStep(step - 1) : onClose())}>
            {step ? 'Back' : 'Cancel'}
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                const blockers = stepProblems[step] || [];
                if (blockers.length) return toast.error(blockers[0]);
                return setStep(step + 1);
              }}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              disabled={create.isPending}
              onClick={() => (problems.length ? toast.error(problems[0]) : create.mutate())}
            >
              {create.isPending ? 'Creating…' : 'Create KPI'}
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
          <p className="text-sm text-soul-muted">What should this KPI measure? Results are counted automatically from the system.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {metrics.map((m) => {
              const Icon = METRIC_INFO[m.key]?.icon || Target;
              const on = form.metric === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => set({ metric: m.key, measure: m.measures?.[0]?.key || 'count', target_value: m.key === 'reviews' ? '4.5' : form.metric === 'reviews' ? '30' : form.target_value })}
                  className={`rounded-xl border p-4 text-left transition ${on ? 'border-soul-blue bg-soul-blue-50/60 ring-1 ring-soul-blue' : 'border-soul-line hover:bg-slate-50'}`}
                >
                  <Icon className="mb-2 h-5 w-5 text-soul-blue" />
                  <p className="font-semibold text-soul-blue">{m.label}</p>
                  <p className="mt-1 text-xs text-soul-muted">{METRIC_INFO[m.key]?.help}</p>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="space-y-5">
          {metric?.measures?.length > 1 ? (
            <div>
              <label className="label">Count by</label>
              <Segmented
                value={form.measure}
                onChange={(measure) => set({ measure, target_value: measure === 'value' ? '300000' : '30' })}
                options={metric.measures.map((m) => ({ value: m.key, label: m.key === 'count' ? 'Number of reservations' : 'Total value (EGP)' }))}
              />
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">
                {form.metric === 'reviews' ? 'Target average rating (1–5)' : form.measure === 'value' ? 'Target value (EGP)' : `Target ${metric?.label?.toLowerCase() || ''}`}
              </label>
              <input className="input text-lg" type="number" min="1" max={form.metric === 'reviews' ? '5' : undefined} step={form.metric === 'reviews' || form.measure === 'value' ? '0.1' : '1'} value={form.target_value} onChange={(e) => set({ target_value: e.target.value })} />
              {perDay ? <p className="mt-1 text-[11px] text-soul-muted">≈ {formatAmount(draft, perDay)} per day over {length} days</p> : null}
            </div>
            <div>
              <label className="label">Name (optional)</label>
              <input className="input" placeholder={`e.g. ${formatDay(form.starts_on, { month: 'long' })} ${metric?.label?.toLowerCase() || ''}`} value={form.title} onChange={(e) => set({ title: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <label className="label">Period</label>
            <Segmented
              value={form.period}
              onChange={(period) => set({ period, ...(periodPreset(period, today) || {}) })}
              options={[
                { value: 'this_month', label: 'Rest of this month' },
                { value: 'next_month', label: 'Next month' },
                { value: 'next_7', label: 'Next 7 days' },
                { value: 'next_30', label: 'Next 30 days' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <input className="input" type="date" value={form.starts_on} onChange={(e) => set({ starts_on: e.target.value, period: 'custom' })} aria-label="Starts" />
              <input className="input" type="date" value={form.deadline} onChange={(e) => set({ deadline: e.target.value, period: 'custom' })} aria-label="Deadline" />
            </div>
            <p className="text-[11px] text-soul-muted">
              {formatDay(form.starts_on)} → {formatDay(form.deadline)} · {length} day{length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-4">
          <Segmented
            value={form.scope}
            onChange={(scope) => set({ scope })}
            options={[
              { value: 'team', label: 'A whole team' },
              { value: 'staff', label: 'Chosen people' },
            ]}
          />
          {form.scope === 'team' ? (
            teamKeys.length > 1 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {teamKeys.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => set({ team_key: key })}
                    className={`rounded-xl border p-3 text-left text-sm ${form.team_key === key ? 'border-soul-blue bg-soul-blue-50/60 ring-1 ring-soul-blue' : 'border-soul-line hover:bg-slate-50'}`}
                  >
                    <Users className="mb-1 h-4 w-4 text-soul-blue" />
                    <span className="font-medium text-soul-blue">{TEAM_LABELS[key] || key}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-soul-muted">Everyone who reports to you ({team.length}) gets their own copy of this target.</p>
            )
          ) : (
            <div className="space-y-2">
              <label className="relative block">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soul-muted" />
                <input className="input !ps-9" placeholder="Find a person…" value={peopleSearch} onChange={(e) => setPeopleSearch(e.target.value)} />
              </label>
              <div className="max-h-64 divide-y divide-soul-line/70 overflow-y-auto rounded-xl border border-soul-line">
                {filteredTeam.map((p) => (
                  <label key={p.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-soul-blue"
                      checked={form.staff_ids.includes(p.id)}
                      onChange={() => set({ staff_ids: form.staff_ids.includes(p.id) ? form.staff_ids.filter((id) => id !== p.id) : [...form.staff_ids, p.id] })}
                    />
                    <span className="font-medium text-soul-blue">{p.full_name}</span>
                    <span className="text-xs text-soul-muted">{ROLE_LABELS[p.role] || p.role}</span>
                  </label>
                ))}
                {!filteredTeam.length ? <p className="px-3 py-3 text-sm text-soul-muted">No one matches.</p> : null}
              </div>
              <p className="text-[11px] text-soul-muted">{form.staff_ids.length} selected · each person gets their own copy of the target.</p>
            </div>
          )}
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-4">
          <label className="flex items-start gap-3 rounded-xl border border-soul-line p-4">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-soul-blue" checked={form.withChecklist} onChange={(e) => set({ withChecklist: e.target.checked })} />
            <span>
              <span className="block font-medium text-soul-blue">Add a daily checklist to this KPI</span>
              <span className="block text-xs text-soul-muted">
                Habits people tick each working day (days off and leave are skipped). The checklist counts for a share of the KPI; the rest is the result.
              </span>
            </span>
          </label>
          {form.withChecklist ? (
            <ChecklistFields value={form.checklist} onChange={(checklist) => set({ checklist })} maxWeight={100} />
          ) : (
            <p className="text-sm text-soul-muted">You can also add a checklist later from the KPI.</p>
          )}
        </div>
      ) : null}

      {step === 4 ? (
        <div className="space-y-3">
          <div className="rounded-xl bg-soul-blue-50/70 p-4 text-sm text-soul-blue">
            <p className="font-semibold">{form.title || `${metric?.label} target`}</p>
            <p className="mt-1">
              Reach <b>{form.metric === 'reviews' ? `${form.target_value} average rating` : form.measure === 'value' ? currency(Number(form.target_value) || 0) : `${form.target_value} ${metric?.label?.toLowerCase()}`}</b>{' '}
              between <b>{formatDay(form.starts_on)}</b> and <b>{formatDay(form.deadline)}</b> ({length} days).
            </p>
            <p className="mt-1">
              For{' '}
              <b>
                {form.scope === 'staff'
                  ? `${peopleCount} ${peopleCount === 1 ? 'person' : 'people'}`
                  : teamKeys.length > 1
                    ? (TEAM_LABELS[form.team_key] || form.team_key).toLowerCase()
                    : `your team (${team.length})`}
              </b>
              .
            </p>
            {form.withChecklist ? (
              <p className="mt-1">
                Daily checklist “{form.checklist.title}” · {form.checklist.items.filter((i) => i.trim()).length} items · {form.checklist.weight_percent}% of the KPI.
              </p>
            ) : null}
          </div>
          <div>
            <label className="label">Notes (optional)</label>
            <textarea className="input min-h-[56px]" placeholder="Why this target, how it’s measured, anything people should know" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </div>
          {problems.length ? <p className="text-sm text-rose-700">{problems[0]}</p> : null}
        </div>
      ) : null}
    </Modal>
  );
}

/* ───────────────────────── KPI detail ───────────────────────── */

function useKpiActions() {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: ({ id, staffId }) => api.delete(`/kpi/${id}`, { params: staffId ? { staff_id: staffId } : {} }).then((r) => r.data),
    onSuccess: (_r, vars) => {
      toast.success(vars.staffId ? 'KPI removed for this person' : 'KPI deleted for the whole team');
      qc.invalidateQueries({ queryKey: ['kpi'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not remove the KPI'),
  });
  const repeat = useMutation({
    mutationFn: (id) => api.post(`/kpi/${id}/repeat`).then((r) => r.data),
    onSuccess: (res) => {
      toast.success(`Repeated for ${formatDay(res.starts_on)} – ${formatDay(res.deadline)}`);
      qc.invalidateQueries({ queryKey: ['kpi'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not repeat the KPI'),
  });
  const removeChecklist = useMutation({
    mutationFn: ({ kpiId, checklistId }) => api.delete(`/kpi/${kpiId}/checklists/${checklistId}`).then((r) => r.data),
    onSuccess: () => {
      toast.success('Checklist removed');
      qc.invalidateQueries({ queryKey: ['kpi'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not remove the checklist'),
  });
  return { remove, repeat, removeChecklist };
}

function KpiActions({ kpi, canManage, staffId, onEdit, onChecklist, compact, today }) {
  const { remove, repeat } = useKpiActions();
  const people = kpi.people?.length || 1;
  if (!kpi.can_delete && !canManage) return null;
  const btn = compact ? 'rounded-lg p-2 text-soul-muted hover:bg-soul-blue-50 hover:text-soul-blue' : 'btn-secondary inline-flex items-center gap-1.5 !px-3 !py-1.5 text-xs';
  return (
    <div className="flex flex-wrap gap-1.5">
      {canManage && !kpi.checklists?.length && !(today && kpi.deadline < today) ? (
        <button type="button" className={btn} onClick={onChecklist} title="Add daily checklist">
          <ClipboardList className="h-4 w-4" />
          {compact ? null : 'Checklist'}
        </button>
      ) : null}
      {kpi.can_delete ? (
        <>
          <button type="button" className={btn} onClick={onEdit} title="Edit">
            <Pencil className="h-4 w-4" />
            {compact ? null : 'Edit'}
          </button>
          {canManage ? (
            <button type="button" className={btn} disabled={repeat.isPending} onClick={() => repeat.mutate(kpi.id)} title="Repeat for the next period">
              <Copy className="h-4 w-4" />
              {compact ? null : 'Repeat'}
            </button>
          ) : null}
          {staffId && people > 1 ? (
            <button
              type="button"
              className={btn}
              disabled={remove.isPending}
              title="Remove for this person"
              onClick={() => window.confirm('Remove this KPI for this person only? Everyone else keeps it.') && remove.mutate({ id: kpi.id, staffId })}
            >
              <UserMinus className="h-4 w-4" />
              {compact ? null : 'Remove for this person'}
            </button>
          ) : null}
          <button
            type="button"
            className={compact ? 'rounded-lg p-2 text-soul-muted hover:bg-rose-50 hover:text-rose-700' : 'btn-secondary inline-flex items-center gap-1.5 !border-rose-200 !px-3 !py-1.5 text-xs !text-rose-700 hover:!bg-rose-50'}
            disabled={remove.isPending}
            title={people > 1 ? `Delete for all ${people} people` : 'Delete'}
            onClick={() =>
              window.confirm(
                people > 1
                  ? `Delete “${kpiName(kpi)}” for all ${people} people on it, with its checklists? This can’t be undone.`
                  : `Delete “${kpiName(kpi)}” and its checklists? This can’t be undone.`
              ) && remove.mutate({ id: kpi.id })
            }
          >
            <Trash2 className="h-4 w-4" />
            {compact ? null : people > 1 ? `Delete for team (${people})` : 'Delete'}
          </button>
        </>
      ) : null}
    </div>
  );
}

function KpiDetail({ kpi, staffId, today, canManage, onEdit, onChecklist }) {
  const [tab, setTab] = useState(kpi.checklists?.length ? 'checklist' : 'progress');
  const [day, setDay] = useState(today && today >= kpi.starts_on && today <= kpi.deadline ? today : kpi.deadline < today ? kpi.deadline : kpi.starts_on);
  const { removeChecklist } = useKpiActions();
  const resultShare = Math.max(0, 100 - (Number(kpi.checklist_weight) || 0));

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-soul-line px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-soul-blue">{kpiName(kpi)}</h3>
            <StatusChip status={kpi.status} label={kpi.status_label} />
          </div>
          <p className="mt-1 text-sm text-soul-muted">
            {formatActual(kpi)} of {formatTarget(kpi)} · <b className="text-soul-blue">{kpi.percent}%</b>
            {kpi.checklist_weight ? ` (result ${resultShare}% + checklist ${kpi.checklist_weight}%)` : ''}
          </p>
          <p className="mt-0.5 text-xs text-soul-muted">{paceLine(kpi)}</p>
          {kpi.notes ? <p className="mt-1 text-xs italic text-soul-muted">{kpi.notes}</p> : null}
        </div>
        <DailyTargetBox kpi={kpi} size="lg" />
        <KpiActions kpi={kpi} canManage={canManage} staffId={staffId} onEdit={onEdit} onChecklist={onChecklist} today={today} />
      </header>

      <div className="flex gap-1 border-b border-soul-line px-3 pt-2">
        {[
          { id: 'progress', label: 'Progress', icon: BarChart3 },
          { id: 'checklist', label: `Daily checklist${kpi.checklists?.length ? ` (${kpi.checklists.length})` : ''}`, icon: ClipboardList },
          { id: 'log', label: 'Day by day', icon: CalendarCheck },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${tab === t.id ? 'border-soul-blue text-soul-blue' : 'border-transparent text-soul-muted hover:text-soul-blue'}`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-5 py-4">
        {tab === 'progress' ? (
          kpi.metric === 'reviews' ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs text-soul-muted">Average so far</p>
                <p className="font-display text-2xl text-soul-blue">{kpi.actual ?? '—'}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs text-soul-muted">Target</p>
                <p className="font-display text-2xl text-soul-blue">{kpi.target_value}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs text-soul-muted">Reviews counted</p>
                <p className="font-display text-2xl text-soul-blue">{kpi.review_count || 0}</p>
              </div>
            </div>
          ) : kpi.status === 'not_started' ? (
            <p className="text-sm text-soul-muted">This KPI starts on {formatDay(kpi.starts_on)}.</p>
          ) : (
            <ProgressChart kpi={kpi} />
          )
        ) : null}

        {tab === 'checklist' ? (
          kpi.checklists?.length ? (
            <div className="space-y-4">
              {kpi.status !== 'not_started' ? <WeekStrip kpi={kpi} day={day} setDay={setDay} today={today} /> : null}
              {kpi.checklists.map((checklist) => (
                <div key={checklist.id} className="rounded-xl border border-soul-line p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-soul-blue">{checklist.title}</p>
                      <p className="mt-0.5 text-xs text-soul-muted">
                        {checklist.weight_percent}% of the KPI · {checklist.completion_percent}% of working days done
                        {checklist.created_by_name ? ` · by ${checklist.created_by_name}` : ''}
                      </p>
                    </div>
                    {checklist.can_delete ? (
                      <button
                        type="button"
                        className="rounded-lg p-2 text-soul-muted hover:bg-rose-50 hover:text-rose-700"
                        aria-label="Remove checklist"
                        onClick={() => window.confirm(`Remove the checklist “${checklist.title}”?`) && removeChecklist.mutate({ kpiId: kpi.id, checklistId: checklist.id })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                  {kpi.status !== 'not_started' ? <ChecklistItems checklist={checklist} kpi={kpi} staffId={staffId} day={day} today={today} /> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-soul-line p-6 text-center">
              <p className="text-sm text-soul-muted">No daily checklist on this KPI.</p>
              {canManage && !(today && kpi.deadline < today) ? (
                <button type="button" className="btn-primary mt-3" onClick={onChecklist}>
                  Add a daily checklist
                </button>
              ) : null}
            </div>
          )
        ) : null}

        {tab === 'log' ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-sm">
              <thead>
                <tr className="text-left text-xs text-soul-muted">
                  <th className="py-2 pr-3 font-medium">Day</th>
                  <th className="py-2 text-right font-medium">{kpi.metric === 'reviews' ? 'Average' : 'Result'}</th>
                  {kpi.checklists?.length ? <th className="py-2 pl-3 text-right font-medium">Checklist</th> : null}
                </tr>
              </thead>
              <tbody>
                {[...(kpi.daily || [])].reverse().map((row) => {
                  let checked = 0;
                  let total = 0;
                  for (const c of kpi.checklists || []) {
                    const d = (c.daily || []).find((x) => x.date === row.date);
                    if (d) {
                      checked += d.checked;
                      total += d.total;
                    }
                  }
                  return (
                    <tr key={row.date} className="border-t border-soul-line/70">
                      <td className="py-2 pr-3 text-soul-muted">{formatDay(row.date)}</td>
                      <td className="py-2 text-right tabular-nums">
                        {kpi.measure === 'value' ? currency(row.value) : row.value}
                        {kpi.metric === 'reviews' && row.count ? ` · ${row.count}` : ''}
                      </td>
                      {kpi.checklists?.length ? (
                        <td className="py-2 pl-3 text-right tabular-nums">{total ? `${checked}/${total}` : <span className="text-soul-muted">off</span>}</td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!kpi.daily?.length ? <p className="py-3 text-sm text-soul-muted">No days in this KPI yet.</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ───────────────────────── tabs ───────────────────────── */

function MyDay({ me, today, canManage, onEdit, onChecklist, grouped }) {
  const [selected, setSelected] = useState(null);
  const running = (me?.kpis || []).filter((k) => k.starts_on <= today && k.deadline >= today);
  const lists = running.flatMap((k) => (k.checklists || []).map((c) => ({ kpi: k, checklist: c })));
  const kpi = (me?.kpis || []).find((k) => k.id === selected) || null;
  // Keep this person's own numbers; borrow only the list of people on the KPI.
  const withPeople = (k) => ({ ...k, people: grouped.find((g) => g.id === k.id)?.people || [] });
  if (!me) return <EmptyState title="No KPIs for you yet" subtitle="Your manager sets your targets here." />;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="card p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold text-soul-blue">
              <ClipboardList className="h-4 w-4" /> Today’s checklist
            </h2>
            <span className="text-xs text-soul-muted">{formatDay(today, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          </div>
          {lists.length ? (
            <div className="mt-3 space-y-4">
              {lists.map(({ kpi: k, checklist }) => (
                <div key={checklist.id}>
                  <p className="text-sm font-medium text-soul-blue">
                    {checklist.title} <span className="text-xs font-normal text-soul-muted">· {kpiName(k)}</span>
                  </p>
                  <ChecklistItems checklist={checklist} kpi={k} staffId={me.id} day={today} today={today} />
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-soul-muted">Nothing to tick today.</p>
          )}
        </section>
        <section className="card flex flex-col justify-center p-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-soul-muted">My score</p>
          <p className="mt-1"><Score score={me.score} size="text-4xl" /></p>
          <p className="mt-1 text-xs text-soul-muted">
            {me.scored_kpis ? `Across ${me.scored_kpis} running KPI${me.scored_kpis === 1 ? '' : 's'}, each counting the same` : 'No running KPIs'}
          </p>
        </section>
      </div>

      {me.kpis?.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {me.kpis.map((k) => (
            <KpiCard key={k.id} kpi={k} active={k.id === selected} onClick={() => setSelected(k.id === selected ? null : k.id)} />
          ))}
        </div>
      ) : (
        <EmptyState title="No KPIs for you yet" subtitle="Your manager sets your targets here." />
      )}
      {kpi ? (
        <KpiDetail key={kpi.id} kpi={withPeople(kpi)} staffId={me.id} today={today} canManage={canManage} onEdit={() => onEdit(withPeople(kpi))} onChecklist={() => onChecklist(withPeople(kpi))} />
      ) : null}
    </div>
  );
}

function TeamView({ staff, statuses, today, canManage, onEdit, onChecklist, grouped }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [personId, setPersonId] = useState(null);
  const [kpiId, setKpiId] = useState(null);

  const withKpis = staff.filter((p) => p.kpis.length);
  const scored = withKpis.filter((p) => p.score != null);
  const teamScore = scored.length ? scored.reduce((s, p) => s + p.score, 0) / scored.length : null;
  const counts = withKpis.reduce((acc, p) => {
    for (const [k, v] of Object.entries(p.status_counts || {})) acc[k] = (acc[k] || 0) + v;
    return acc;
  }, {});
  const list = withKpis
    .filter((p) => p.full_name.toLowerCase().includes(search.trim().toLowerCase()))
    .filter((p) => !statusFilter || (p.status_counts || {})[statusFilter])
    .sort((a, b) => (a.score ?? 999) - (b.score ?? 999));
  const person = list.find((p) => p.id === personId) || null;
  const kpi = person?.kpis.find((k) => k.id === kpiId) || person?.kpis[0] || null;
  const withPeople = (k) => grouped.find((g) => g.id === k.id) || k;

  if (!withKpis.length) {
    return <EmptyState title="No KPIs set yet" subtitle={canManage ? 'Create the first one with “New KPI”.' : 'Your manager sets targets here.'} />;
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-soul-muted">Team score</p>
          <p className="mt-1"><Score score={teamScore} /></p>
        </div>
        {['behind', 'at_risk', 'on_track', 'achieved'].map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatusFilter(statusFilter === key ? '' : key)}
            className={`card p-4 text-left transition ${statusFilter === key ? 'ring-2 ring-soul-blue' : 'hover:shadow-md'}`}
            aria-pressed={statusFilter === key}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-soul-muted">{statuses?.[key] || key}</p>
            <p className="mt-1 font-display text-xl tabular-nums text-soul-blue">{counts[key] || 0}</p>
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="space-y-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soul-muted" />
            <input className="input !ps-9" placeholder="Find a person…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <p className="px-1 text-[11px] text-soul-muted">Lowest score first{statusFilter ? ` · showing people with ${(statuses?.[statusFilter] || statusFilter).toLowerCase()} KPIs` : ''}</p>
          <ul className="space-y-2">
            {list.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPersonId(p.id);
                    setKpiId(null);
                  }}
                  className={`card w-full p-3.5 text-left transition ${person?.id === p.id ? 'ring-2 ring-[var(--pms-accent,#F28C28)]' : 'hover:shadow-md'}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-soul-blue">{p.full_name}</p>
                      <p className="text-xs text-soul-muted">{ROLE_LABELS[p.role] || p.role} · {p.kpis.length} KPI{p.kpis.length === 1 ? '' : 's'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Score score={p.score} size="text-lg" />
                      <ChevronRight className="h-4 w-4 text-soul-muted" />
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {STATUS_ORDER.filter((k) => (p.status_counts || {})[k]).map((k) => (
                      <span key={k} className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[k]}`}>
                        {p.status_counts[k]} {(statuses?.[k] || k).toLowerCase()}
                      </span>
                    ))}
                  </div>
                </button>
              </li>
            ))}
            {!list.length ? <li className="px-1 text-sm text-soul-muted">No one matches.</li> : null}
          </ul>
        </div>

        {person ? (
          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-soul-blue">{person.full_name}</h2>
                <p className="text-sm text-soul-muted">{ROLE_LABELS[person.role] || person.role}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-soul-muted">Current score</p>
                <Score score={person.score} size="text-2xl" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {person.kpis.map((k) => (
                <KpiCard key={k.id} kpi={k} active={kpi?.id === k.id} onClick={() => setKpiId(k.id)} />
              ))}
            </div>
            {kpi ? (
              <KpiDetail key={`${person.id}-${kpi.id}`} kpi={{ ...kpi, people: withPeople(kpi).people }} staffId={person.id} today={today} canManage={canManage} onEdit={() => onEdit(withPeople(kpi))} onChecklist={() => onChecklist(withPeople(kpi))} />
            ) : null}
          </section>
        ) : (
          <div className="card hidden place-items-center p-10 text-center text-sm text-soul-muted lg:grid">
            <div>
              <Users className="mx-auto mb-2 h-8 w-8 opacity-40" />
              Pick a person to see their KPIs and checklists.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ManageView({ grouped, today, canManage, onEdit, onChecklist }) {
  const [when, setWhen] = useState('running');
  const [open, setOpen] = useState(null);
  const buckets = {
    running: grouped.filter((k) => k.starts_on <= today && k.deadline >= today),
    upcoming: grouped.filter((k) => k.starts_on > today),
    ended: grouped.filter((k) => k.deadline < today),
  };
  const list = buckets[when].sort((a, b) => (a.deadline < b.deadline ? -1 : 1));
  return (
    <div className="space-y-4">
      <Segmented
        value={when}
        onChange={setWhen}
        options={[
          { value: 'running', label: `Running (${buckets.running.length})` },
          { value: 'upcoming', label: `Upcoming (${buckets.upcoming.length})` },
          { value: 'ended', label: `Ended (${buckets.ended.length})` },
        ]}
      />
      {!list.length ? (
        <EmptyState title={`No ${when} KPIs`} subtitle={canManage && when !== 'ended' ? 'Create one with “New KPI”.' : undefined} />
      ) : (
        <ul className="space-y-3">
          {list.map((k) => {
            const statusTally = k.people.reduce((acc, p) => {
              acc[p.kpi.status] = (acc[p.kpi.status] || 0) + 1;
              return acc;
            }, {});
            const avg = k.people.reduce((s, p) => s + Math.min(100, Number(p.kpi.percent) || 0), 0) / Math.max(1, k.people.length);
            const isOpen = open === k.id;
            return (
              <li key={k.id} className="card overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 p-4">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(isOpen ? null : k.id)} aria-expanded={isOpen}>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-soul-blue">{kpiName(k)}</p>
                      {k.checklists?.length ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-soul-muted">+ checklist</span> : null}
                    </div>
                    <p className="mt-0.5 text-xs text-soul-muted">
                      {k.metric_label} · {formatTarget(k)} each · {formatDay(k.starts_on, { day: 'numeric', month: 'short' })} – {formatDay(k.deadline, { day: 'numeric', month: 'short', year: 'numeric' })} · {k.people.length} {k.people.length === 1 ? 'person' : 'people'} · avg {Math.round(avg)}%
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {STATUS_ORDER.filter((s) => statusTally[s]).map((s) => (
                        <span key={s} className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[s]}`}>
                          {statusTally[s]} {(k.people.find((p) => p.kpi.status === s)?.kpi.status_label || s).toLowerCase()}
                        </span>
                      ))}
                    </div>
                  </button>
                  <KpiActions kpi={k} canManage={canManage} onEdit={() => onEdit(k)} onChecklist={() => onChecklist(k)} compact today={today} />
                </div>
                {isOpen ? (
                  <div className="overflow-x-auto border-t border-soul-line">
                    <table className="w-full min-w-[420px] text-sm">
                      <tbody>
                        {[...k.people].sort((a, b) => (Number(a.kpi.percent) || 0) - (Number(b.kpi.percent) || 0)).map((p) => (
                          <tr key={p.id} className="border-b border-soul-line/60 last:border-0">
                            <td className="px-4 py-2 font-medium text-soul-blue">{p.full_name}</td>
                            <td className="px-3 py-2 text-soul-muted">{formatActual(p.kpi)}</td>
                            <td className="w-40 px-3 py-2">
                              <PaceBar kpi={p.kpi} />
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold">{p.kpi.percent}%</td>
                            <td className="px-4 py-2 text-right"><StatusChip status={p.kpi.status} label={p.kpi.status_label} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ───────────────────────── page ───────────────────────── */

export default function Kpi() {
  const { user } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ['kpi'],
    queryFn: () => api.get('/kpi').then((r) => r.data),
  });
  const [tab, setTab] = useState(null);
  const [wizard, setWizard] = useState(false);
  const [editing, setEditing] = useState(null);
  const [checklistFor, setChecklistFor] = useState(null);

  const staff = data?.staff || [];
  const grouped = useMemo(() => groupKpis(staff), [staff]);
  if (isLoading) return <LoadingSpinner />;
  if (error) return <EmptyState title={error.response?.data?.error || 'Could not load KPIs'} />;

  const canManage = Boolean(data.can_manage);
  const me = staff.find((p) => Number(p.id) === Number(user?.id)) || null;
  const tabs = [
    me && me.kpis.length ? { id: 'mine', label: 'My day' } : null,
    canManage || staff.length > 1 ? { id: 'team', label: 'Team' } : null,
    canManage ? { id: 'manage', label: `Manage KPIs (${grouped.length})` } : null,
  ].filter(Boolean);
  const active = tabs.find((t) => t.id === tab)?.id || tabs[0]?.id || 'mine';

  return (
    <div className="space-y-5">
      <div className="page-header mb-0 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">KPI</h1>
          <p className="page-subtitle">
            Targets are measured automatically. Each KPI shows where it should be by today and where the current pace lands; a person’s
            score is the average of their running KPIs (all count the same), each counted up to 100%.
          </p>
        </div>
        {canManage ? (
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setWizard(true)}>
            <Plus className="h-4 w-4" /> New KPI
          </button>
        ) : null}
      </div>

      {tabs.length > 1 ? (
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 sm:w-fit">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition sm:flex-none ${active === t.id ? 'bg-white text-soul-blue shadow-sm' : 'text-slate-500 hover:text-soul-blue'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      {active === 'mine' ? (
        <MyDay me={me} today={data.today} canManage={canManage} onEdit={setEditing} onChecklist={setChecklistFor} grouped={grouped} />
      ) : null}
      {active === 'team' ? (
        <TeamView staff={staff} statuses={data.statuses} today={data.today} canManage={canManage} onEdit={setEditing} onChecklist={setChecklistFor} grouped={grouped} />
      ) : null}
      {active === 'manage' ? (
        <ManageView grouped={grouped} today={data.today} canManage={canManage} onEdit={setEditing} onChecklist={setChecklistFor} />
      ) : null}

      {wizard ? <NewKpiWizard data={data} onClose={() => setWizard(false)} /> : null}
      {editing ? <EditKpiModal kpi={editing} today={data.today} onClose={() => setEditing(null)} /> : null}
      {checklistFor ? <AddChecklistModal kpi={checklistFor} onClose={() => setChecklistFor(null)} /> : null}
    </div>
  );
}
