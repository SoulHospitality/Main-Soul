import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  Activity,
  Building2,
  ChevronDown,
  ClipboardList,
  Download,
  History,
  Radio,
  Search,
  Users,
  X,
} from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { ROLE_LABELS } from '../utils/permissions';
import { currency } from '../utils/formatters';

const TZ = 'Africa/Cairo';

const CATEGORY_META = {
  reservations: { label: 'Reservations', tone: 'bg-sky-50 text-sky-800 ring-sky-200' },
  payments: { label: 'Payments', tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  finance: { label: 'Finance', tone: 'bg-teal-50 text-teal-800 ring-teal-200' },
  units: { label: 'Units', tone: 'bg-indigo-50 text-indigo-800 ring-indigo-200' },
  acquisition: { label: 'Owner leads', tone: 'bg-violet-50 text-violet-800 ring-violet-200' },
  owners: { label: 'Owners', tone: 'bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-200' },
  operations: { label: 'Operations', tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  housekeeping: { label: 'Housekeeping', tone: 'bg-orange-50 text-orange-800 ring-orange-200' },
  team: { label: 'Tasks & targets', tone: 'bg-slate-100 text-slate-700 ring-slate-200' },
  inbox: { label: 'Inbox', tone: 'bg-rose-50 text-rose-800 ring-rose-200' },
  other: { label: 'Other', tone: 'bg-gray-100 text-gray-700 ring-gray-200' },
};

const ACTION_LABELS = {
  CREATE_RESERVATION: 'created a reservation',
  UPDATE_RESERVATION: 'edited a reservation',
  CANCEL_RESERVATION: 'cancelled a reservation',
  DELETE_RESERVATION: 'deleted a reservation',
  TRANSFER_RESERVATION: 'moved a reservation to another unit',
  UPLOAD_RESERVATION_ID: 'uploaded guest ID documents',
  REMOVE_RESERVATION_ID: 'removed a guest ID document',
  ACCEPT_WEBSITE_BOOKING: 'accepted a website booking',
  REJECT_WEBSITE_BOOKING: 'rejected a website booking',
  ASSIGN_WEBSITE_BOOKING: 'assigned a website booking',
  UPDATE_WEBSITE_COLLECTED: 'updated the website collected amount',
  RECORD_PAYMENT: 'recorded a payment',
  CREATE_PAYMENT: 'recorded a payment',
  APPROVE_PAYMENT: 'approved a payment',
  FINANCE_REVIEW_PAYMENT: 'reviewed a cash payment',
  APPROVE_CANCEL_REFUND: 'approved a cancellation refund',
  CREATE_EXPENSE: 'added an expense',
  UPDATE_EXPENSE: 'edited an expense',
  DELETE_EXPENSE: 'deleted an expense',
  MANUAL_ENTRY: 'added a manual finance entry',
  EDIT_MANUAL_ENTRY: 'edited a manual finance entry',
  CLOSE_PERIOD: 'closed a financial month',
  REOPEN_PERIOD: 'reopened a financial month',
  HOLDBACK_CREATED: 'held back an owner amount',
  BANK_SNAPSHOT: 'saved a bank balance',
  GENERATE_OWNER_SETTLEMENT: 'generated an owner settlement',
  UPDATE_OWNER_SETTLEMENT: 'updated an owner settlement',
  REQUEST_OWNER_PAYOUT: 'requested an owner payout',
  REVIEW_OWNER_PAYOUT: 'reviewed an owner payout',
  CREATE_UNIT: 'added a unit',
  UPDATE_UNIT: 'edited a unit',
  DELETE_UNIT: 'deleted a unit',
  PUBLISH_UNIT: 'published a unit',
  UNPUBLISH_UNIT: 'unpublished a unit',
  UPDATE_DAILY_PRICES: 'changed daily prices',
  GENERATE_PRICING_RECOMMENDATION: 'generated a pricing recommendation',
  UPDATE_PRICING_RECOMMENDATION: 'updated a pricing recommendation',
  CREATE_ACQUISITION_LEAD: 'added an owner lead',
  UPDATE_ACQUISITION_LEAD: 'edited an owner lead',
  DELETE_ACQUISITION_LEAD: 'deleted an owner lead',
  CREATE_UNIT_FROM_LEAD: 'turned an owner lead into a unit',
  LOG_ACQUISITION_NEGOTIATION: 'logged an owner negotiation',
  CREATE_ACQUISITION_CONTRACT: 'created an owner contract',
  OWNER_BLOCK_DATES: 'blocked dates for the owner',
  OWNER_UNBLOCK_DATES: 'unblocked owner dates',
  OPS_ASSIGN_CHECKIN: 'assigned a check-in',
  OPS_ASSIGN_CHECKOUT: 'assigned a check-out',
  OPS_COLLECT_CHECKIN: 'collected money at check-in',
  OPS_HANDOVER_CHECKIN: 'handed over check-in cash',
  OPS_EDIT_CHECKIN_BILL: 'edited a check-in bill',
  OPS_CANCEL_CHECKIN: 'cancelled a check-in',
  OPS_CHANGE_STAY: 'changed a stay',
  OPS_CHECKIN_COMMENT: 'commented on a check-in',
  OPS_EDIT_INSURANCE: 'edited the insurance',
  OPS_REFUND_INSURANCE: 'refunded the insurance',
  OPS_DAMAGE_SHARE_REVIEW: 'reviewed a damage share',
  OPS_APPROVE_CUSTOM_BILL: 'approved a custom bill',
  OPS_REJECT_CUSTOM_BILL: 'rejected a custom bill',
  OPS_COMMENT_REVIEWED: 'marked a comment as reviewed',
  OPS_COMMENT_UNREVIEWED: 'marked a comment as not reviewed',
  OPS_CLOCK_IN: 'clocked in',
  OPS_CLOCK_OUT: 'clocked out',
  UNIT_INSPECTION_ASSIGN: 'assigned a unit inspection',
  UNIT_INSPECTION_VIDEO: 'uploaded an inspection video',
  UNIT_INSPECTION_CHECKLIST_SUBMIT: 'submitted an inspection checklist',
  UNIT_INSPECTION_CHECKLIST_APPROVE: 'approved an inspection checklist',
  UNIT_INSPECTION_COMPLETE: 'completed a unit inspection',
  CREATE_MAINTENANCE_TICKET: 'opened a maintenance ticket',
  CREATE_HOUSEKEEPING_TASK: 'created a housekeeping task',
  SUBMIT_HOUSEKEEPING_TASK: 'submitted a housekeeping task',
  INSPECT_HOUSEKEEPING_TASK: 'inspected a housekeeping task',
  CREATE_HK_SERVICE_ORDER: 'created a housekeeping service order',
  HK_ASSIGN_TODAY_CLEAN: 'assigned today’s cleaning',
  HK_START_CLEAN: 'started a cleaning',
  HK_MARK_CLEANED_TODAY: 'marked a unit as cleaned',
  HK_CHANGE_CLEAN_DATE: 'changed a cleaning date',
  HK_ADD_MANUAL_CLEAN: 'added a manual cleaning',
  CREATE_STAFF_TASK: 'created a task',
  UPDATE_STAFF_TASK: 'edited a task',
  DELETE_STAFF_TASK: 'deleted a task',
  COMPLETE_STAFF_TASK: 'completed a task',
  REPLY_STAFF_TASK: 'replied to a task',
  KPI_TARGET_CREATE: 'set a KPI target',
  UPSERT_RESERVATION_TARGET: 'set a reservations target',
  APPLY_RESERVATION_TARGETS: 'applied reservations targets',
  UPDATE_USER_ACCESS: 'changed a user’s page access',
  CHANGE_ROLE: 'changed a user’s role',
  CREATE_HR_RULE: 'added an HR rule',
  UPDATE_HR_RULE: 'edited an HR rule',
  DELETE_HR_RULE: 'deleted an HR rule',
  APPLY_HR_RULES: 'applied HR rules to payroll',
};

const RANGES = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom' },
];

const HIDDEN_DETAIL_KEYS = new Set(['changes', 'before', 'after', 'data']);
const MONEY_KEYS = /amount|total|price|balance|fees|insurance|payment$|collected|refund/i;

function cairoDay(value) {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: TZ });
}

function cairoTime(value) {
  return new Date(value).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}

function shiftDay(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function rangeDates(range, from, to) {
  const today = cairoDay(Date.now());
  if (range === 'today') return { from: today, to: today };
  if (range === '7d') return { from: shiftDay(today, -6), to: today };
  if (range === '30d') return { from: shiftDay(today, -29), to: today };
  if (range === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  if (range === 'custom') return { from: from || '', to: to || '' };
  return { from: '', to: '' };
}

function dayHeading(iso) {
  const today = cairoDay(Date.now());
  if (iso === today) return 'Today';
  if (iso === shiftDay(today, -1)) return 'Yesterday';
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function humanize(key) {
  return String(key || '')
    .replace(/^INBOX_/, '')
    .replace(/_id$/, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

function actionText(action) {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  if (String(action).startsWith('INBOX_')) return `inbox · ${humanize(action).toLowerCase()}`;
  return humanize(action).toLowerCase();
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return (parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '');
}

const AVATAR_TONES = ['bg-sky-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600', 'bg-rose-600', 'bg-teal-600', 'bg-indigo-600'];
function avatarTone(id) {
  return AVATAR_TONES[Math.abs(Number(id) || 0) % AVATAR_TONES.length];
}

function formatValue(key, value, unitCodes) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (/unit_id$/.test(key) && unitCodes[value]) return unitCodes[value];
  if (typeof value === 'number' && MONEY_KEYS.test(key)) return currency(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** One short line under the action: guest + dates, amounts, reasons, transfer target. */
function summaryLine(event, unitCodes) {
  const d = event.details || {};
  const parts = [];
  const guest = d.guest_name || event.reservation?.guest_name;
  if (guest) parts.push(guest);
  const ci = d.check_in || event.reservation?.check_in;
  const co = d.check_out || event.reservation?.check_out;
  if (ci) parts.push(`${String(ci).slice(0, 10)}${co ? ` → ${String(co).slice(0, 10)}` : ''}`);
  if (d.from_unit_id || d.to_unit_id) {
    parts.push(`${unitCodes[d.from_unit_id] || 'unit'} → ${unitCodes[d.to_unit_id] || 'unit'}`);
  }
  const amount = d.amount ?? d.after?.amount ?? d.statement_balance ?? d.refunded_amount;
  if (amount != null && Number.isFinite(Number(amount))) parts.push(currency(Number(amount)));
  if (d.description) parts.push(d.description);
  if (d.reason) parts.push(d.reason);
  if (d.title && event.category === 'units') parts.push(d.title);
  if (d.assigned_agent_name) parts.push(`to ${d.assigned_agent_name}`);
  const changes = Object.keys(d.changes || {});
  if (changes.length) parts.push(`${changes.length} field${changes.length === 1 ? '' : 's'} changed`);
  return parts.join(' · ');
}

function changeRows(details) {
  if (details.changes && Object.keys(details.changes).length) {
    return Object.entries(details.changes).map(([field, c]) => ({ field, from: c?.from, to: c?.to }));
  }
  const before = details.before && typeof details.before === 'object' ? details.before : null;
  const after = details.after && typeof details.after === 'object' ? details.after : null;
  if (!before && !after) return [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys]
    .map((field) => ({ field, from: before?.[field], to: after?.[field] }))
    .filter((r) => JSON.stringify(r.from ?? null) !== JSON.stringify(r.to ?? null));
}

function useDebounced(value, ms = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function Chip({ children, onClear }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-soul-blue/10 px-3 py-1 text-xs font-medium text-soul-blue">
      {children}
      <button type="button" onClick={onClear} className="rounded-full p-0.5 hover:bg-soul-blue/15" aria-label="Remove filter">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function StatTile({ icon: Icon, label, value, hint }) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-soul-muted">
        <Icon className="h-4 w-4" style={{ color: 'var(--pms-accent)' }} />
        {label}
      </div>
      <p className="mt-2 font-display text-2xl tabular-nums text-soul-blue sm:text-3xl">{value}</p>
      {hint ? <p className="mt-1 text-xs text-soul-muted">{hint}</p> : null}
    </div>
  );
}

function EventRow({ event, unitCodes, onFilter }) {
  const [open, setOpen] = useState(false);
  const d = event.details || {};
  const meta = CATEGORY_META[event.category] || CATEGORY_META.other;
  const changes = changeRows(d);
  const extra = Object.entries(d).filter(
    ([k, v]) => !HIDDEN_DETAIL_KEYS.has(k) && v !== null && v !== '' && typeof v !== 'object'
  );
  const inboxData = d.data && typeof d.data === 'object' ? Object.entries(d.data).filter(([, v]) => typeof v !== 'object') : [];
  const expandable = changes.length || extra.length || inboxData.length || event.reservation_id || event.unit_id;
  const summary = summaryLine(event, unitCodes);
  const name = event.actor_name || (event.user_id ? `Staff #${event.user_id}` : 'System');

  return (
    <li className="px-3 py-3 sm:px-5">
      <div className="flex items-start gap-3">
        <span className="w-11 shrink-0 pt-1 text-xs tabular-nums text-soul-muted">{cairoTime(event.created_at)}</span>
        <span
          className={`hidden h-8 w-8 shrink-0 select-none place-items-center rounded-full text-[11px] font-semibold uppercase text-white sm:grid ${avatarTone(event.user_id)}`}
          aria-hidden="true"
        >
          {initials(name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug text-soul-blue">
            {event.user_id ? (
              <button type="button" className="font-semibold hover:underline" onClick={() => onFilter({ actor: String(event.user_id) })}>
                {name}
              </button>
            ) : (
              <span className="font-semibold">{name}</span>
            )}{' '}
            <span className="text-soul-blue/80">{actionText(event.action)}</span>
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${meta.tone}`}>{meta.label}</span>
            {event.unit_code ? (
              <button
                type="button"
                onClick={() => onFilter({ unit: event.unit_code })}
                className="inline-flex items-center gap-1 rounded-md bg-soul-blue px-2 py-0.5 font-mono text-[11px] font-semibold text-white hover:bg-soul-blue/85"
                title="Show everything on this unit"
              >
                <Building2 className="h-3 w-3" />
                {event.unit_code}
              </button>
            ) : null}
            {event.reservation_id ? (
              <button
                type="button"
                onClick={() => onFilter({ reservation_id: String(event.reservation_id) })}
                className="rounded-md border border-soul-line px-2 py-0.5 text-[11px] font-medium text-soul-blue hover:bg-soul-blue-50"
                title="Show this reservation's full history"
              >
                Res #{event.reservation_id}
              </button>
            ) : null}
            {event.actor_role ? (
              <span className="text-[11px] text-soul-muted">{ROLE_LABELS[event.actor_role] || event.actor_role}</span>
            ) : null}
          </div>
          {summary ? <p className="mt-1 break-words text-xs text-soul-muted">{summary}</p> : null}
        </div>
        {expandable ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 rounded-lg p-1.5 text-soul-muted hover:bg-soul-blue-50 hover:text-soul-blue"
            aria-expanded={open}
            aria-label={open ? 'Hide details' : 'Show details'}
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 space-y-3 rounded-xl border border-soul-line bg-soul-blue-50/40 p-3 text-xs sm:ms-[100px]">
          {changes.length ? (
            <div className="overflow-x-auto">
              <p className="mb-1.5 font-semibold text-soul-blue">What changed</p>
              <table className="w-full min-w-[320px] text-left">
                <thead>
                  <tr className="text-soul-muted">
                    <th className="py-1 pe-3 font-medium">Field</th>
                    <th className="py-1 pe-3 font-medium">Before</th>
                    <th className="py-1 font-medium">After</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((c) => (
                    <tr key={c.field} className="border-t border-soul-line/70 align-top">
                      <td className="py-1.5 pe-3 font-medium text-soul-blue">{humanize(c.field)}</td>
                      <td className="py-1.5 pe-3 text-rose-700 line-through decoration-rose-300">{formatValue(c.field, c.from, unitCodes)}</td>
                      <td className="py-1.5 text-emerald-700">{formatValue(c.field, c.to, unitCodes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {extra.length || inboxData.length ? (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {[...extra, ...inboxData].map(([k, v]) => (
                <div key={k} className="flex min-w-0 gap-2">
                  <dt className="shrink-0 text-soul-muted">{humanize(k)}</dt>
                  <dd className="min-w-0 break-words font-medium text-soul-blue">{formatValue(k, v, unitCodes)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div className="flex flex-wrap gap-2 border-t border-soul-line/70 pt-2">
            {event.reservation_id ? (
              <button type="button" className="text-soul-blue underline-offset-2 hover:underline" onClick={() => onFilter({ reservation_id: String(event.reservation_id) })}>
                Full history of reservation #{event.reservation_id}
              </button>
            ) : null}
            {event.unit_code ? (
              <button type="button" className="text-soul-blue underline-offset-2 hover:underline" onClick={() => onFilter({ unit: event.unit_code })}>
                Everything on unit {event.unit_code}
              </button>
            ) : null}
            {event.user_id ? (
              <button type="button" className="text-soul-blue underline-offset-2 hover:underline" onClick={() => onFilter({ actor: String(event.user_id) })}>
                Everything by {name}
              </button>
            ) : null}
            <span className="ms-auto text-soul-muted">
              {new Date(event.created_at).toLocaleString('en-GB', { timeZone: TZ })} · {event.action}
            </span>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export default function AuditLog() {
  const [params, setParams] = useSearchParams();
  const get = (k) => params.get(k) || '';
  const range = get('range') || 'all';
  const categories = useMemo(() => get('category').split(',').filter(Boolean), [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const actor = get('actor');
  const reservationId = get('reservation_id');
  const { from, to } = rangeDates(range, get('from'), get('to'));

  const [searchInput, setSearchInput] = useState(get('q'));
  const [unitInput, setUnitInput] = useState(get('unit'));
  const q = useDebounced(searchInput.trim());
  const unit = useDebounced(unitInput.trim());
  const [live, setLive] = useState(false);
  const [exporting, setExporting] = useState(false);

  const update = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v == null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  // Keep typed search and unit code in the URL so a filtered view can be shared.
  useEffect(() => {
    if (q !== get('q') || unit !== get('unit')) update({ q, unit });
  }, [q, unit]); // eslint-disable-line react-hooks/exhaustive-deps

  const apiParams = {
    q: q || undefined,
    unit: unit || undefined,
    category: categories.join(',') || undefined,
    actor: actor || undefined,
    reservation_id: reservationId || undefined,
    from: from || undefined,
    to: to || undefined,
  };

  const feed = useInfiniteQuery({
    queryKey: ['audit-log', apiParams],
    queryFn: ({ pageParam }) =>
      api.get('/audit-log', { params: { ...apiParams, cursor: pageParam || undefined } }).then((r) => r.data),
    initialPageParam: null,
    getNextPageParam: (last) => last.next_cursor || undefined,
    refetchInterval: live ? 30000 : false,
  });

  const first = feed.data?.pages?.[0];
  const events = useMemo(() => feed.data?.pages.flatMap((p) => p.events) || [], [feed.data]);
  const unitCodes = useMemo(
    () => Object.assign({}, ...(feed.data?.pages.map((p) => p.unit_codes || {}) || [])),
    [feed.data]
  );
  const groups = useMemo(() => {
    const out = [];
    for (const e of events) {
      const day = cairoDay(e.created_at);
      if (!out.length || out[out.length - 1].day !== day) out.push({ day, events: [] });
      out[out.length - 1].events.push(e);
    }
    return out;
  }, [events]);

  const totals = first?.totals || { events: 0, people: 0, units: 0 };
  const actors = first?.actors || [];
  const actorName = actors.find((a) => String(a.id) === actor)?.name;
  const hasFilters = Boolean(q || unit || categories.length || actor || reservationId || range !== 'all');

  const toggleCategory = (key) => {
    const next = categories.includes(key) ? categories.filter((c) => c !== key) : [...categories, key];
    update({ category: next.join(',') });
  };

  const applyFilter = (patch) => {
    if ('unit' in patch) setUnitInput(patch.unit);
    update(patch);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const clearAll = () => {
    setSearchInput('');
    setUnitInput('');
    setParams(new URLSearchParams(), { replace: true });
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await api.get('/audit-log/export', { params: apiParams, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${cairoDay(Date.now())}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="page-header mb-0 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Audit Log</h1>
          <p className="page-subtitle">
            {first?.scope && !first.scope.admin
              ? `Your team's activity: ${first.scope.categories.map((c) => CATEGORY_META[c]?.label || c).join(', ')}.`
              : 'Every change made by anyone on the team, from the first record until now.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setLive((v) => !v)}
            className={`btn-secondary inline-flex items-center gap-2 ${live ? '!border-emerald-300 !bg-emerald-50 !text-emerald-800' : ''}`}
            aria-pressed={live}
            title="Refresh every 30 seconds"
          >
            <Radio className={`h-4 w-4 ${live ? 'animate-pulse' : ''}`} />
            {live ? 'Live' : 'Go live'}
          </button>
          <button type="button" onClick={exportCsv} disabled={exporting} className="btn-secondary inline-flex items-center gap-2">
            <Download className="h-4 w-4" />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <StatTile icon={ClipboardList} label="Actions" value={totals.events.toLocaleString()} hint={hasFilters ? 'Matching filters' : 'All time'} />
        <StatTile icon={Users} label="People" value={totals.people.toLocaleString()} hint="Who made changes" />
        <StatTile icon={Building2} label="Units" value={totals.units.toLocaleString()} hint="Units touched" />
      </div>

      <div className="card space-y-3 p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <label className="relative block">
            <span className="sr-only">Search</span>
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soul-muted" />
            <input
              className="input w-full !ps-9"
              placeholder="Search guest, person, reservation #, amount, note…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </label>
          <label className="relative block">
            <span className="sr-only">Unit code</span>
            <Building2 className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soul-muted" />
            <input
              className="input w-full !ps-9 font-mono"
              placeholder="Unit code"
              value={unitInput}
              onChange={(e) => setUnitInput(e.target.value)}
            />
          </label>
          <select className="input w-full" value={actor} onChange={(e) => update({ actor: e.target.value })} aria-label="Person">
            <option value="">Everyone</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || `Staff #${a.id}`} ({a.count})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => update({ range: r.key === 'all' ? '' : r.key })}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                range === r.key ? 'bg-soul-blue text-white' : 'bg-soul-blue-50 text-soul-blue hover:bg-soul-blue/10'
              }`}
            >
              {r.label}
            </button>
          ))}
          {range === 'custom' ? (
            <span className="flex flex-wrap items-center gap-2">
              <input type="date" className="input !w-auto !py-1.5 text-xs" value={get('from')} onChange={(e) => update({ from: e.target.value })} aria-label="From" />
              <span className="text-xs text-soul-muted">to</span>
              <input type="date" className="input !w-auto !py-1.5 text-xs" value={get('to')} onChange={(e) => update({ to: e.target.value })} aria-label="To" />
            </span>
          ) : null}
        </div>

        {first?.categories?.length ? (
          <div className="flex flex-wrap gap-2 border-t border-soul-line/70 pt-3">
            {first.categories.map((c) => {
              const meta = CATEGORY_META[c.key] || CATEGORY_META.other;
              const on = categories.includes(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => toggleCategory(c.key)}
                  aria-pressed={on}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition ${
                    on ? `${meta.tone} ring-2` : 'bg-white text-soul-muted ring-soul-line hover:text-soul-blue'
                  } ${c.count ? '' : 'opacity-50'}`}
                >
                  {meta.label}
                  <span className="tabular-nums opacity-70">{c.count.toLocaleString()}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {hasFilters ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-soul-line/70 pt-3">
            {reservationId ? <Chip onClear={() => update({ reservation_id: '' })}>Reservation #{reservationId}</Chip> : null}
            {unit ? <Chip onClear={() => applyFilter({ unit: '' })}>Unit {unit}</Chip> : null}
            {actor ? <Chip onClear={() => update({ actor: '' })}>{actorName || `Staff #${actor}`}</Chip> : null}
            {q ? <Chip onClear={() => setSearchInput('')}>“{q}”</Chip> : null}
            <button type="button" onClick={clearAll} className="text-xs font-medium text-soul-blue underline-offset-2 hover:underline">
              Clear all filters
            </button>
          </div>
        ) : null}
      </div>

      {feed.isLoading ? (
        <LoadingSpinner />
      ) : feed.isError ? (
        <div className="card p-6 text-sm text-rose-700">
          Couldn’t load the audit log. {feed.error?.response?.data?.error || feed.error?.message}
        </div>
      ) : !events.length ? (
        <div className="card flex flex-col items-center px-6 py-14 text-center">
          <History className="mb-3 h-12 w-12 text-soul-muted/40" />
          <p className="font-semibold text-soul-blue">{hasFilters ? 'Nothing matches these filters' : 'Nothing logged yet'}</p>
          <p className="mt-1 max-w-sm text-sm text-soul-muted">
            {hasFilters
              ? 'Try a wider date range or remove a filter.'
              : 'Reservations, payments, unit edits, finance entries and team actions will appear here as people work.'}
          </p>
          {hasFilters ? (
            <button type="button" onClick={clearAll} className="btn-secondary mt-4">
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.day} className="card overflow-hidden">
              <header className="sticky top-0 z-[1] flex items-center justify-between border-b border-soul-line bg-white/95 px-3 py-2.5 backdrop-blur sm:px-5">
                <h2 className="text-sm font-semibold text-soul-blue">{dayHeading(g.day)}</h2>
                <span className="text-xs tabular-nums text-soul-muted">
                  {g.events.length} {g.events.length === 1 ? 'action' : 'actions'}
                </span>
              </header>
              <ul className="divide-y divide-soul-line/70">
                {g.events.map((e) => (
                  <EventRow key={e.id} event={e} unitCodes={unitCodes} onFilter={applyFilter} />
                ))}
              </ul>
            </section>
          ))}

          <div className="flex flex-col items-center gap-2 py-2 text-xs text-soul-muted">
            <span>
              Showing {events.length.toLocaleString()} of {totals.events.toLocaleString()}
            </span>
            {feed.hasNextPage ? (
              <button type="button" onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage} className="btn-secondary">
                {feed.isFetchingNextPage ? 'Loading…' : 'Load older activity'}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" />
                {hasFilters ? 'End of matching activity.' : 'You’ve reached the very first entry.'}
              </span>
            )}
          </div>
        </div>
      )}

      <p className="text-[11px] text-soul-muted">Times are shown in Cairo time. Click a unit code, reservation number or name to filter by it.</p>
    </div>
  );
}
