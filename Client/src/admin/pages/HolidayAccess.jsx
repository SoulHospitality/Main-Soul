import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Pencil, ShieldCheck, Users, Clock, Hourglass, SlidersHorizontal } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Modal from '../components/ui/Modal';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import { ROLE_LABELS, canEditStaffCompensation } from '../utils/permissions';
import { formatDate } from '../utils/formatters';
import { LEAVE_TYPE_LABELS } from '../utils/hrPolicy';
import { usePermissions } from '../hooks/usePermissions';

const ACCESS_LABELS = {
  auto: 'Auto (6 months)',
  granted: 'Allowed',
  denied: 'Blocked',
};

const BALANCE_TYPES = [
  { id: 'casual', label: 'Casual' },
  { id: 'annual', label: 'Annual' },
  { id: 'unpaid', label: 'Unpaid' },
];

function cairoToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

function daysUntil(iso, today) {
  if (!iso) return null;
  return Math.round((new Date(`${iso}T12:00:00Z`) - new Date(`${today}T12:00:00Z`)) / 86400000);
}

function shortDay(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** The day paid holidays open on their own (6 months after joining), and how far away it is. */
function AutoAccessDate({ row, today }) {
  if (!row.auto_access_on) return <span className="text-soul-muted">—</span>;
  const days = daysUntil(row.auto_access_on, today);
  const mode = row.holiday_access || 'auto';
  const note =
    mode === 'granted'
      ? 'granted early by HR'
      : mode === 'denied'
        ? 'blocked, won’t open on its own'
        : days > 0
          ? `opens in ${days} day${days === 1 ? '' : 's'}`
          : 'open';
  return (
    <span className={`text-[11px] ${mode === 'denied' ? 'text-rose-700' : days > 0 && mode === 'auto' ? 'text-amber-700' : 'text-soul-muted'}`}>
      {mode === 'auto' && days > 0 ? `${formatDate(row.auto_access_on)} · ` : ''}
      {note}
    </span>
  );
}

function AccessCell({ row, today, canEdit, onChange, pending }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <select
          className="input w-auto py-1 text-xs"
          value={row.holiday_access || 'auto'}
          disabled={pending || !canEdit}
          title={!canEdit ? 'Only HR, an HR Manager, or a CEO can change holiday access' : undefined}
          onChange={(e) => onChange(e.target.value)}
        >
          {Object.entries(ACCESS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${row.can_request_holidays ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}
        >
          {row.can_request_holidays ? 'Can request' : 'Not yet'}
        </span>
      </div>
      <AutoAccessDate row={row} today={today} />
    </div>
  );
}

/** "4 left of 6 · 2 pending" for one balance. */
function BalanceCell({ b, unlimitedLabel = 'Unlimited' }) {
  if (b.unlimited) {
    return (
      <div>
        <p className="font-semibold text-soul-blue">{unlimitedLabel}</p>
        <p className="text-[11px] text-soul-muted">{b.taken_this_year ? `${b.taken_this_year} taken this year` : '—'}</p>
      </div>
    );
  }
  const low = b.balance > 0 && b.available === 0;
  return (
    <div>
      <p className={`font-semibold tabular-nums ${b.balance === 0 ? 'text-slate-400' : low ? 'text-amber-700' : 'text-soul-blue'}`}>
        {b.available}
        <span className="text-[11px] font-normal text-soul-muted"> / {b.balance}</span>
      </p>
      <p className="text-[11px] text-soul-muted">
        {b.pending ? <span className="text-amber-700">{b.pending} pending · </span> : null}
        {b.taken_this_year} taken
      </p>
    </div>
  );
}

function ExcuseDots({ e }) {
  return (
    <div title={`${e.used} of ${e.max} excuses used this pay month`}>
      <div className="flex gap-1">
        {Array.from({ length: e.max }).map((_, i) => (
          <span key={i} className={`h-2.5 w-2.5 rounded-full ${i < e.used ? 'bg-amber-500' : 'bg-emerald-400'}`} />
        ))}
      </div>
      <p className={`mt-1 text-[11px] ${e.remaining ? 'text-soul-muted' : 'font-medium text-rose-700'}`}>{e.remaining ? `${e.remaining} left` : 'none left'}</p>
    </div>
  );
}

function NextLeave({ leave, today }) {
  if (!leave) return <span className="text-[11px] text-soul-muted">—</span>;
  const onNow = leave.start_date <= today;
  return (
    <div className="text-[11px]">
      <p className={onNow ? 'font-medium text-emerald-700' : 'text-soul-blue'}>{onNow ? 'On leave now' : `${shortDay(leave.start_date)}${leave.end_date !== leave.start_date ? ` – ${shortDay(leave.end_date)}` : ''}`}</p>
      <p className="text-soul-muted">{LEAVE_TYPE_LABELS[leave.leave_type] || leave.leave_type}{onNow ? ` · back after ${shortDay(leave.end_date)}` : ''}</p>
    </div>
  );
}

function EditBalancesModal({ row, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    casual: String(row.balances.casual.balance),
    annual: String(row.balances.annual.balance),
    unpaid: row.balances.unpaid.unlimited ? '' : String(row.balances.unpaid.balance ?? 0),
    note: '',
  });
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/hr/holiday-access/${row.id}/balances`, {
        casual: form.casual,
        annual: form.annual,
        ...(row.balances.unpaid.unlimited ? {} : { unpaid: form.unpaid }),
        note: form.note,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-holiday-access'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(`${row.full_name}’s balances saved`);
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not save the balances'),
  });
  const types = BALANCE_TYPES.filter((t) => !(t.id === 'unpaid' && row.balances.unpaid.unlimited));
  return (
    <Modal
      open
      onClose={onClose}
      title={`${row.full_name}’s balances`}
      size="md"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save balances'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-soul-muted">Set how many days are left in each balance. Pending requests are taken from these when approved.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {types.map((t) => {
            const b = row.balances[t.id];
            return (
              <div key={t.id} className="rounded-xl border border-soul-line p-3">
                <label className="label">{t.label} days</label>
                <div className="flex items-center gap-1">
                  <button type="button" className="btn-secondary !px-2.5 !py-1.5" onClick={() => setForm((f) => ({ ...f, [t.id]: String(Math.max(0, (Number(f[t.id]) || 0) - 1)) }))}>
                    −
                  </button>
                  <input
                    type="number"
                    min="0"
                    max="365"
                    step="1"
                    className="input text-center"
                    value={form[t.id]}
                    onChange={(e) => setForm((f) => ({ ...f, [t.id]: e.target.value }))}
                  />
                  <button type="button" className="btn-secondary !px-2.5 !py-1.5" onClick={() => setForm((f) => ({ ...f, [t.id]: String(Math.min(365, (Number(f[t.id]) || 0) + 1)) }))}>
                    +
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-soul-muted">
                  {b.pending ? `${b.pending} pending · ` : ''}
                  {b.taken_this_year} taken this year
                </p>
              </div>
            );
          })}
        </div>
        <div>
          <label className="label">Note (optional, saved in the audit log)</label>
          <input className="input" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="e.g. Yearly reset, 2027" />
        </div>
      </div>
    </Modal>
  );
}

function BulkBalancesModal({ staff, onClose }) {
  const qc = useQueryClient();
  const [type, setType] = useState('annual');
  const [mode, setMode] = useState('add');
  const [days, setDays] = useState('1');
  const [note, setNote] = useState('');
  const apply = useMutation({
    mutationFn: () => api.post('/hr/holiday-access/balances/bulk', { staff_ids: staff.map((s) => s.id), type, mode, days: Number(days), note }).then((r) => r.data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['hr-holiday-access'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(`Updated ${res.updated} ${res.updated === 1 ? 'person' : 'people'}`);
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not update the balances'),
  });
  const n = Number(days) || 0;
  const typeLabel = BALANCE_TYPES.find((t) => t.id === type)?.label.toLowerCase();
  const summary =
    mode === 'set'
      ? `Set ${typeLabel} to ${n} day${n === 1 ? '' : 's'}`
      : mode === 'add'
        ? `Add ${n} ${typeLabel} day${n === 1 ? '' : 's'}`
        : `Take away ${n} ${typeLabel} day${n === 1 ? '' : 's'} (never below 0)`;
  return (
    <Modal
      open
      onClose={onClose}
      title="Change balances"
      size="md"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={apply.isPending || !Number.isInteger(n) || n < 0} onClick={() => apply.mutate()}>
            {apply.isPending ? 'Applying…' : `Apply to ${staff.length}`}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label">Balance</label>
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
            {BALANCE_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setType(t.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${type === t.id ? 'bg-white text-soul-blue shadow-sm' : 'text-slate-500'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <div>
            <label className="label">Change</label>
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="add">Add days</option>
              <option value="subtract">Take away days</option>
              <option value="set">Set to exactly</option>
            </select>
          </div>
          <div>
            <label className="label">Days</label>
            <input type="number" min="0" max="365" step="1" className="input" value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Note (optional, saved in the audit log)</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Monthly annual accrual" />
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-soul-blue">
          <span className="font-semibold">{summary}</span> for {staff.length} {staff.length === 1 ? 'person' : 'people'}:
          <p className="mt-1 line-clamp-3 text-xs text-soul-muted">{staff.map((s) => s.full_name).join(', ')}</p>
        </div>
      </div>
    </Modal>
  );
}

function Tile({ icon: Icon, label, value, hint, onClick, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${active ? 'border-soul-blue bg-soul-blue-50/60' : 'border-soul-line bg-white hover:bg-slate-50'}`}
    >
      <span className="rounded-lg bg-slate-100 p-2 text-soul-blue">
        <Icon className="h-4 w-4" />
      </span>
      <span>
        <span className="block text-xl font-semibold tabular-nums text-soul-blue">{value}</span>
        <span className="block text-xs text-soul-muted">{label}</span>
        {hint ? <span className="block text-[11px] text-soul-muted">{hint}</span> : null}
      </span>
    </button>
  );
}

const FILTERS = [
  { id: 'all', label: 'Everyone' },
  { id: 'can', label: 'Can request' },
  { id: 'soon', label: 'Opening in 30 days' },
  { id: 'not_yet', label: 'Not yet' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'no_excuses', label: 'No excuses left' },
  { id: 'pending', label: 'Has pending requests' },
];

export default function HolidayAccess() {
  const qc = useQueryClient();
  const { user } = usePermissions();
  const today = cairoToday();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [role, setRole] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [bulk, setBulk] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['hr-holiday-access', 'full'],
    queryFn: () => api.get('/hr/holiday-access', { params: { full: 1 } }).then((r) => r.data),
  });
  const rows = data?.rows || [];

  const access = useMutation({
    mutationFn: ({ id, holiday_access }) => api.patch(`/hr/holiday-access/${id}`, { holiday_access }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-holiday-access'] });
      toast.success('Holiday access updated');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not update access'),
  });

  const matches = (r, f) => {
    if (f === 'can') return r.can_request_holidays;
    if (f === 'not_yet') return !r.can_request_holidays && r.holiday_access !== 'denied';
    if (f === 'blocked') return r.holiday_access === 'denied';
    if (f === 'soon') {
      const d = daysUntil(r.auto_access_on, today);
      return r.holiday_access === 'auto' && d > 0 && d <= 30;
    }
    if (f === 'no_excuses') return r.excuses.remaining === 0;
    if (f === 'pending') return r.pending_requests > 0;
    return true;
  };

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (!matches(r, filter)) return false;
        if (role && r.role !== role) return false;
        if (!q) return true;
        return [r.full_name, r.staff_code, ROLE_LABELS[r.role]].filter(Boolean).join(' ').toLowerCase().includes(q);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, filter, role, q, today]
  );
  const roles = [...new Set(rows.map((r) => r.role))].sort((a, b) => (ROLE_LABELS[a] || a).localeCompare(ROLE_LABELS[b] || b));
  const count = (f) => rows.filter((r) => matches(r, f)).length;
  const editable = (r) => canEditStaffCompensation(user, r.id);
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const allShownSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allShownSelected) filtered.forEach((r) => next.delete(r.id));
      else filtered.forEach((r) => next.add(r.id));
      return next;
    });
  const canBulk = rows.some(editable);

  return (
    <div className="space-y-5">
      <div className="page-header mb-0 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-soul-muted">HR</p>
          <h1 className="page-title mt-1">Holidays access & balances</h1>
          <p className="page-subtitle">
            Who can request paid holidays, when it opens automatically (6 months after joining), and everyone’s casual, annual, unpaid
            and excuse balances. Casual, annual, unpaid leave and excuses all need the manager then the HR Manager.
            {data?.cycle ? ` Excuses count for this pay month (${shortDay(data.cycle.from)} – ${shortDay(data.cycle.through)}), up to 2 each.` : ''}
          </p>
        </div>
        {canBulk ? (
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2"
            onClick={() => setBulk(selectedRows.length ? selectedRows.filter(editable) : filtered.filter(editable))}
            disabled={!filtered.length}
          >
            <SlidersHorizontal className="h-4 w-4" />
            {selectedRows.length ? `Change balances (${selectedRows.length} selected)` : `Change balances (${filtered.length} shown)`}
          </button>
        ) : null}
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Tile icon={ShieldCheck} label="Can request paid holidays" value={count('can')} hint={`of ${rows.length} staff`} onClick={() => setFilter(filter === 'can' ? 'all' : 'can')} active={filter === 'can'} />
            <Tile icon={CalendarClock} label="Opening in the next 30 days" value={count('soon')} onClick={() => setFilter(filter === 'soon' ? 'all' : 'soon')} active={filter === 'soon'} />
            <Tile icon={Clock} label="No excuses left this month" value={count('no_excuses')} onClick={() => setFilter(filter === 'no_excuses' ? 'all' : 'no_excuses')} active={filter === 'no_excuses'} />
            <Tile icon={Hourglass} label="With pending requests" value={count('pending')} onClick={() => setFilter(filter === 'pending' ? 'all' : 'pending')} active={filter === 'pending'} />
          </div>

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <SearchFilter value={search} onChange={setSearch} placeholder="Search staff…" />
            <select className="input w-full lg:w-48" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">All roles</option>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r] || r}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === f.id ? 'border-soul-blue bg-soul-blue text-white' : 'border-soul-line bg-white text-soul-muted hover:text-soul-blue'}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {!filtered.length ? (
            <EmptyState icon={Users} title="No staff match" />
          ) : (
            <>
              {/* Desktop: one table with every balance side by side. */}
              <div className="card hidden p-0 lg:block">
                <div className="table-wrapper">
                  <table className="table text-sm">
                    <thead>
                      <tr>
                        {canBulk ? (
                          <th className="w-8">
                            <input type="checkbox" checked={allShownSelected} onChange={toggleAll} aria-label="Select all shown" />
                          </th>
                        ) : null}
                        <th>Staff</th>
                        <th>Joined</th>
                        <th>Paid holidays</th>
                        <th>Casual</th>
                        <th>Annual</th>
                        <th>Unpaid</th>
                        <th>Excuses</th>
                        <th>Next leave</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => (
                        <tr key={r.id} className={selected.has(r.id) ? 'bg-soul-blue-50/40' : ''}>
                          {canBulk ? (
                            <td>
                              <input type="checkbox" checked={selected.has(r.id)} disabled={!editable(r)} onChange={() => toggle(r.id)} aria-label={`Select ${r.full_name}`} />
                            </td>
                          ) : null}
                          <td>
                            <div className="font-semibold text-soul-blue">{r.full_name}</div>
                            <div className="text-[11px] text-soul-muted">
                              {r.staff_code ? `${r.staff_code} · ` : ''}
                              {ROLE_LABELS[r.role] || r.role}
                              {r.is_active === 0 ? ' · inactive' : ''}
                            </div>
                          </td>
                          <td className="whitespace-nowrap">
                            <div>{formatDate(r.created_at)}</div>
                            <div className="text-[11px] text-soul-muted">{r.tenure_months} months</div>
                          </td>
                          <td>
                            <AccessCell row={r} today={today} canEdit={editable(r)} pending={access.isPending} onChange={(v) => access.mutate({ id: r.id, holiday_access: v })} />
                          </td>
                          <td>
                            <BalanceCell b={r.balances.casual} />
                          </td>
                          <td>
                            <BalanceCell b={r.balances.annual} />
                          </td>
                          <td>
                            <BalanceCell b={r.balances.unpaid} />
                          </td>
                          <td>
                            <ExcuseDots e={r.excuses} />
                          </td>
                          <td>
                            <NextLeave leave={r.next_leave} today={today} />
                          </td>
                          <td className="text-right">
                            {editable(r) ? (
                              <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={() => setEditing(r)}>
                                <Pencil className="h-3.5 w-3.5" /> Balances
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Phones and tablets: one card per person. */}
              <div className="space-y-2 lg:hidden">
                {filtered.map((r) => (
                  <div key={r.id} className={`rounded-xl border bg-white p-3 ${selected.has(r.id) ? 'border-soul-blue' : 'border-soul-line'}`}>
                    <div className="flex items-start gap-2">
                      {canBulk ? <input type="checkbox" className="mt-1" checked={selected.has(r.id)} disabled={!editable(r)} onChange={() => toggle(r.id)} aria-label={`Select ${r.full_name}`} /> : null}
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-soul-blue">{r.full_name}</p>
                        <p className="text-[11px] text-soul-muted">
                          {ROLE_LABELS[r.role] || r.role} · joined {formatDate(r.created_at)} ({r.tenure_months} mo)
                        </p>
                      </div>
                      {editable(r) ? (
                        <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={() => setEditing(r)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-2">
                      <AccessCell row={r} today={today} canEdit={editable(r)} pending={access.isPending} onChange={(v) => access.mutate({ id: r.id, holiday_access: v })} />
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-2 rounded-lg bg-slate-50 p-2">
                      {BALANCE_TYPES.map((t) => (
                        <div key={t.id}>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-soul-muted">{t.label}</p>
                          <BalanceCell b={r.balances[t.id]} unlimitedLabel="∞" />
                        </div>
                      ))}
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-soul-muted">Excuses</p>
                        <ExcuseDots e={r.excuses} />
                      </div>
                    </div>
                    {r.next_leave ? (
                      <div className="mt-2">
                        <NextLeave leave={r.next_leave} today={today} />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {editing ? <EditBalancesModal row={editing} onClose={() => setEditing(null)} /> : null}
      {bulk ? (
        <BulkBalancesModal
          staff={bulk}
          onClose={() => {
            setBulk(null);
            setSelected(new Set());
          }}
        />
      ) : null}
    </div>
  );
}
