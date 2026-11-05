import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarRange, Download, LogIn, LogOut } from 'lucide-react';
import api from '../../api/axios';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import EmptyState from '../../components/ui/EmptyState';
import { ROLE_LABELS } from '../../utils/permissions';

function cairoToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

function shiftIso(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function timeOf(iso) {
  return iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' }) : '—';
}

function dayLabel(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function duration(minutes) {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function presets(today) {
  const day = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  const sinceSaturday = (day + 1) % 7;
  return [
    { id: 'today', label: 'Today', from: today, to: today },
    { id: 'yesterday', label: 'Yesterday', from: shiftIso(today, -1), to: shiftIso(today, -1) },
    { id: 'week', label: 'This week', from: shiftIso(today, -sinceSaturday), to: today },
    { id: 'month', label: 'This month', from: `${today.slice(0, 7)}-01`, to: today },
    { id: '30', label: 'Last 30 days', from: shiftIso(today, -29), to: today },
  ];
}

function downloadCsv(rows, from, to) {
  const head = ['Date', 'Name', 'Code', 'Role', 'First in', 'Last out', 'Time in (min)', 'Clock-ins', 'Left the area'];
  const lines = rows.map((r) =>
    [r.date, r.full_name, r.staff_code || '', ROLE_LABELS[r.role] || r.role, timeOf(r.first_in), r.still_in ? 'still in' : timeOf(r.last_out), r.minutes_in, r.sessions.length, r.auto_outs]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  );
  const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `clock-ins-${from}-to-${to}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Everyone's clock-ins and clock-outs, filtered by person and dates (CEO and HR). */
export default function ClockHistory() {
  const today = cairoToday();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [staffId, setStaffId] = useState('');
  const [name, setName] = useState('');
  const [open, setOpen] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['clock-history', from, to, staffId],
    queryFn: () => api.get('/clock/history', { params: { from, to, staff_id: staffId || undefined } }).then((r) => r.data),
    enabled: Boolean(from && to && from <= to),
    refetchInterval: from <= today && to >= today ? 60000 : false,
    placeholderData: (prev) => prev,
  });

  const q = name.trim().toLowerCase();
  const rows = useMemo(
    () => (data?.rows || []).filter((r) => !q || `${r.full_name} ${r.staff_code || ''}`.toLowerCase().includes(q)),
    [data, q]
  );
  const people = new Set(rows.map((r) => r.staff_user_id)).size;
  const totalMinutes = rows.reduce((s, r) => s + r.minutes_in, 0);
  const autoOuts = rows.reduce((s, r) => s + r.auto_outs, 0);
  const activePreset = presets(today).find((p) => p.from === from && p.to === to)?.id;

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-soul-blue">
          <CalendarRange className="h-4 w-4" /> Clock-in history
        </h2>
        {rows.length ? (
          <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => downloadCsv(rows, from, to)}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {presets(today).map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setFrom(p.from);
              setTo(p.to);
            }}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              activePreset === p.id ? 'border-soul-blue bg-soul-blue text-white' : 'border-soul-line bg-white text-soul-muted hover:text-soul-blue'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <div>
          <label className="label">From</label>
          <input type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" className="input" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label className="label">Person</label>
          <select className="input" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">Everyone</option>
            {(data?.staff || []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Search name</label>
          <input className="input" value={name} placeholder="Type a name or code" onChange={(e) => setName(e.target.value)} />
        </div>
      </div>

      {error ? (
        <p className="text-sm text-rose-700">{error.response?.data?.error || 'Could not load clock-ins'}</p>
      ) : isLoading ? (
        <LoadingSpinner />
      ) : !rows.length ? (
        <EmptyState icon={CalendarRange} title="No clock-ins in this range" />
      ) : (
        <>
          <p className="text-xs text-soul-muted">
            {rows.length} day{rows.length === 1 ? '' : 's'} · {people} {people === 1 ? 'person' : 'people'} · {duration(totalMinutes)} inside in total
            {autoOuts ? ` · left the area ${autoOuts}×` : ''}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-soul-muted">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Person</th>
                  <th className="py-2 pr-3 font-medium">First in</th>
                  <th className="py-2 pr-3 font-medium">Last out</th>
                  <th className="py-2 pr-3 font-medium">Time inside</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const key = `${r.staff_user_id}|${r.date}`;
                  const expanded = open === key;
                  return [
                    <tr key={key} className="cursor-pointer border-t border-soul-line/70 hover:bg-slate-50" onClick={() => setOpen(expanded ? null : key)}>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-soul-muted">{dayLabel(r.date)}</td>
                      <td className="py-2.5 pr-3">
                        <p className="font-medium text-soul-blue">{r.full_name}</p>
                        <p className="text-[11px] text-soul-muted">{ROLE_LABELS[r.role] || r.role}</p>
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums">{timeOf(r.first_in)}</td>
                      <td className="py-2.5 pr-3 tabular-nums">
                        {r.still_in ? <span className="font-medium text-emerald-700">Still in</span> : timeOf(r.last_out)}
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums">{duration(r.minutes_in)}</td>
                      <td className="py-2.5 text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          {r.sessions.length > 1 ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{r.sessions.length} clock-ins</span> : null}
                          {r.auto_outs ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">Left area {r.auto_outs}×</span> : null}
                          {r.forgot_out ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700">
                              <AlertTriangle className="h-3 w-3" /> No clock-out
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>,
                    expanded ? (
                      <tr key={`${key}-detail`} className="bg-slate-50/70">
                        <td colSpan={6} className="px-3 py-2">
                          <ol className="space-y-1">
                            {r.sessions.map((s, i) => (
                              <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
                                <LogIn className="h-3.5 w-3.5 text-emerald-600" />
                                <span className="tabular-nums">{timeOf(s.in)}</span>
                                <span className="text-slate-300">→</span>
                                <LogOut className="h-3.5 w-3.5 text-rose-600" />
                                <span className="tabular-nums">{s.out ? timeOf(s.out) : r.still_in ? 'still in' : 'no clock-out'}</span>
                                {s.out_source === 'left_area' ? <span className="text-amber-700">(automatic: left the area)</span> : null}
                              </li>
                            ))}
                          </ol>
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
