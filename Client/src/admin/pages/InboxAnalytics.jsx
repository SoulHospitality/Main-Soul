import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, RefreshCw } from 'lucide-react';
import { inboxApi, errorMessage } from '../inbox/api';
import { useInbox } from '../inbox/InboxContext';
import { CHANNELS, CONVERSATION_TYPES, fmtMoney, fmtSeconds, pct } from '../inbox/utils';
import { PresenceDot } from '../inbox/ui';

const PERIODS = [
  { days: 1, label: 'Today' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

function startOfCairoDay(ts) {
  const day = new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  // Cairo midnight in UTC, using the offset at that moment.
  const guess = Date.parse(`${day}T00:00:00Z`);
  const offset = new Date(guess).toLocaleString('en-US', { timeZone: 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23' });
  return guess - Number(offset) * 3600000;
}

function Card({ title, hint, children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}>
      {title ? (
        <header className="mb-3">
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          {hint ? <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

function Stat({ label, value, sub, tone = 'text-slate-900' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className={`mt-0.5 text-xl font-bold tabular-nums ${tone}`}>{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p> : null}
    </div>
  );
}

/** Horizontal bars, one hue; the number sits in ink beside each bar. */
function Bars({ rows, format = (v) => v, empty = 'Nothing yet' }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length || rows.every((r) => !r.value)) return <p className="py-3 text-center text-xs text-slate-400">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(6rem,9rem)_1fr_auto] items-center gap-2 text-xs" title={`${r.label}: ${format(r.value)}`}>
          <span className="truncate text-slate-600">{r.label}</span>
          <span className="h-2.5 rounded-full bg-slate-100">
            <span className="block h-2.5 rounded-full bg-soul-blue" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </span>
          <span className="min-w-[2.5rem] text-right font-semibold tabular-nums text-slate-800">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Vertical columns (hours of the day, days of the period). */
function Columns({ rows, height = 96 }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {rows.map((r) => (
        <div key={r.key} className="group relative flex h-full flex-1 flex-col justify-end" title={`${r.label}: ${r.value}`}>
          <span className="block w-full rounded-t-[3px] bg-soul-blue/80 group-hover:bg-soul-blue" style={{ height: `${r.value ? Math.max(3, (r.value / max) * 100) : 0}%` }} />
        </div>
      ))}
    </div>
  );
}

export default function InboxAnalyticsPage() {
  const { me, can, stageByKey } = useInbox();
  const team = can('analytics.team');
  const [days, setDays] = useState(7);
  const [user, setUser] = useState('');

  const range = useMemo(() => {
    const to = Date.now();
    const from = days === 1 ? startOfCairoDay(to) : to - days * 86400000;
    return { from, to };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['inbox-analytics', days, user],
    queryFn: () => inboxApi.get('/analytics', { from: range.from, to: range.to, user: user || undefined }),
    refetchInterval: 60000,
  });

  const o = data?.overview || {};
  const live = data?.live || {};
  const all = data?.allChats || {};
  const agents = data?.agents || [];

  return (
    <div className="min-w-0 space-y-4 font-sans sm:space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900">
            <BarChart3 className="h-6 w-6 text-soul-blue" />
            Inbox analytics
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Response times count working hours only ({me?.rules?.business_start || '11:00'}–{me?.rules?.business_end || '22:00'} Cairo), so nights don’t count against anyone.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="inline-flex rounded-xl bg-slate-100 p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => setDays(p.days)}
                className={`rounded-lg px-3 py-1.5 font-semibold ${days === p.days ? 'bg-white text-soul-blue shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {team ? (
            <select value={user} onChange={(e) => setUser(e.target.value)} className="h-9 rounded-xl border border-slate-200 bg-white px-2 font-semibold text-slate-700">
              <option value="">Whole team</option>
              {(me?.users || []).filter((u) => u.active).map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          ) : null}
          <button type="button" onClick={() => refetch()} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" aria-label="Refresh">
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error ? (
        <Card><p className="text-sm text-rose-700">{errorMessage(error, 'Could not load analytics')}</p></Card>
      ) : isLoading ? (
        <Card><p className="py-10 text-center text-xs text-slate-400">Loading analytics…</p></Card>
      ) : (
        <>
          <Card title="Right now" hint={data?.scope === 'user' ? 'Chats on this person' : 'Every open chat on the inbox'}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Open chats" value={live.open ?? 0} />
              <Stat label="Unread" value={live.unread ?? 0} tone={live.unread ? 'text-amber-700' : 'text-slate-900'} />
              <Stat label="Overdue" value={live.overdue ?? 0} tone={live.overdue ? 'text-rose-700' : 'text-slate-900'} sub={live.at_risk ? `${live.at_risk} about to be` : null} />
              <Stat label="Snoozed" value={live.snoozed ?? 0} />
              <Stat label="Unassigned" value={live.unassigned ?? 0} />
              <Stat label="Not classified" value={live.unclassified ?? 0} />
            </div>
          </Card>

          <Card title="All chats" hint="Every chat on the inbox, whatever the period">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="Total chats" value={all.total ?? 0} />
              <Stat label="Open" value={all.open ?? 0} />
              <Stat label="Closed" value={all.closed ?? 0} sub={`${all.closed_in_period ?? 0} in this period`} />
              <Stat label="With a lead" value={all.with_lead ?? 0} sub={all.total ? `${Math.round(((all.with_lead || 0) / all.total) * 100)}% of chats` : null} />
              <Stat label="Unassigned (open)" value={all.unassigned ?? 0} />
            </div>
            <div className="mt-4 grid gap-5 lg:grid-cols-3">
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">By channel</p>
                <Bars rows={(all.by_channel || []).map((r) => ({ key: r.key, label: CHANNELS[r.key]?.label || r.key, value: r.count }))} />
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Who they are</p>
                <Bars rows={(all.by_type || []).map((r) => ({ key: r.key, label: CONVERSATION_TYPES[r.key] || r.key, value: r.count }))} />
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Lead status</p>
                <Bars rows={(all.by_stage || []).map((r) => ({ key: r.key, label: stageByKey(r.key)?.name_en || r.name_en, value: r.count }))} empty="No leads yet" />
              </div>
            </div>
          </Card>

          <Card title="This period">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Avg response" value={fmtSeconds(o.response?.avg)} sub={o.response?.count ? `median ${fmtSeconds(o.response?.median)} · ${o.response.count} replies` : 'No replies yet'} />
              <Stat label="First response" value={fmtSeconds(o.first_response?.avg)} sub="Average time to the first reply in a chat" />
              <Stat
                label={`Answered within ${o.sla_target_min || 15} min`}
                value={pct(o.sla_compliance)}
                tone={o.sla_compliance == null ? 'text-slate-900' : o.sla_compliance >= 90 ? 'text-emerald-700' : o.sla_compliance >= 70 ? 'text-amber-700' : 'text-rose-700'}
                sub={`${o.sla_breaches || 0} late`}
              />
              <Stat label="New chats" value={o.conversations ?? 0} sub={`${o.inbound_messages || 0} guest messages`} />
              <Stat label="New leads" value={o.leads ?? 0} />
              <Stat label="Done (booked)" value={o.bookings ?? 0} tone="text-emerald-700" sub={o.bookings ? `${o.bookings_linked || 0} linked to a reservation` : null} />
              <Stat label="Lead → booking" value={pct(o.conversion_lead)} sub={`${o.won_cohort || 0} of ${o.leads || 0} leads`} />
              <Stat label="Booking value" value={fmtMoney(o.booking_value || 0)} />
            </div>
          </Card>

          {team || data?.scope === 'user' ? (
            <Card
              title="Team"
              hint={`Rotations = chats the inbox handed to them in turn${data?.rotation_after_hours ? `; “returning” = a guest back after ${data.rotation_after_hours}h of silence` : ''}.`}
            >
              <div className="-mx-4 overflow-x-auto sm:-mx-5">
                <table className="w-full min-w-[900px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      <th className="px-4 py-2 sm:px-5">Staff</th>
                      <th className="px-2 py-2 text-right">Rotations</th>
                      <th className="px-2 py-2 text-right">Returning</th>
                      <th className="px-2 py-2 text-right">Taken</th>
                      <th className="px-2 py-2 text-right">Moved to them</th>
                      <th className="px-2 py-2 text-right">Replies</th>
                      <th className="px-2 py-2 text-right">Avg response</th>
                      <th className="px-2 py-2 text-right">On time</th>
                      <th className="px-2 py-2 text-right">Late</th>
                      <th className="px-2 py-2 text-right">Leads</th>
                      <th className="px-2 py-2 text-right">Done</th>
                      <th className="px-2 py-2 text-right">Value</th>
                      <th className="px-4 py-2 text-right sm:px-5">Waiting now</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {agents.map((a) => (
                      <tr key={a.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2 font-semibold text-slate-800 sm:px-5">
                          <span className="inline-flex items-center gap-1.5"><PresenceDot presence={a.presence} />{a.name}</span>
                        </td>
                        <td className="px-2 py-2 text-right font-bold tabular-nums">{a.rotations}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{a.rotations_returning}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{a.taken}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{a.reassigned_to}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{a.replies}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{fmtSeconds(a.avg_response)}</td>
                        <td className={`px-2 py-2 text-right tabular-nums ${a.sla_compliance != null && a.sla_compliance < 70 ? 'text-rose-700' : ''}`}>{pct(a.sla_compliance)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{a.breaches}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{a.leads}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-emerald-700">{a.bookings}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{a.booking_value ? fmtMoney(a.booking_value) : '—'}</td>
                        <td className={`px-4 py-2 text-right tabular-nums sm:px-5 ${a.overdue_now ? 'font-bold text-rose-700' : ''}`}>
                          {a.waiting_now}{a.overdue_now ? ` (${a.overdue_now} late)` : ''}
                        </td>
                      </tr>
                    ))}
                    {!agents.length ? (
                      <tr><td colSpan={13} className="px-5 py-6 text-center text-slate-400">No activity in this period.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="How fast replies were" hint="Working-hours time from the guest’s message to the reply">
              <Bars rows={(data?.responseBuckets || []).map((b) => ({ key: b.label, label: b.label, value: b.count }))} empty="No replies in this period" />
            </Card>
            <Card title="When guests write" hint="Guest messages by hour (Cairo)">
              <Columns rows={(data?.hourly || []).map((h) => ({ key: h.hour, label: `${String(h.hour).padStart(2, '0')}:00`, value: h.messages }))} />
              <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
              </div>
            </Card>
          </div>

          {days > 1 ? (
            <Card title="Day by day" hint="New chats per day">
              <Columns rows={(data?.daily || []).map((d) => ({ key: d.day, label: `${d.day}: ${d.conversations} chats, ${d.leads} leads, ${d.bookings} booked`, value: d.conversations }))} height={80} />
              <div className="mt-3 -mx-4 overflow-x-auto sm:-mx-5">
                <table className="w-full min-w-[420px] text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      <th className="px-4 py-1.5 text-left sm:px-5">Day</th>
                      <th className="px-2 py-1.5 text-right">Chats</th>
                      <th className="px-2 py-1.5 text-right">Leads</th>
                      <th className="px-4 py-1.5 text-right sm:px-5">Booked</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...(data?.daily || [])].reverse().slice(0, 31).map((d) => (
                      <tr key={d.day}>
                        <td className="px-4 py-1.5 text-slate-600 sm:px-5">{new Date(`${d.day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{d.conversations}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{d.leads}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums sm:px-5">{d.bookings}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Channels">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    <th className="py-1.5 text-left">Channel</th>
                    <th className="py-1.5 text-right">Chats</th>
                    <th className="py-1.5 text-right">Leads</th>
                    <th className="py-1.5 text-right">Done</th>
                    <th className="py-1.5 text-right">Avg reply</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(data?.channels || []).map((c) => (
                    <tr key={c.kind}>
                      <td className="py-1.5 font-medium text-slate-700">{CHANNELS[c.kind]?.label || c.kind}</td>
                      <td className="py-1.5 text-right tabular-nums">{c.conversations}</td>
                      <td className="py-1.5 text-right tabular-nums">{c.leads}</td>
                      <td className="py-1.5 text-right tabular-nums">{c.won}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtSeconds(c.avg_response)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="Leads by project">
              <Bars rows={(data?.byProject || []).slice(0, 8).map((p) => ({ key: p.key, label: p.key === 'unknown' ? 'Not set' : p.key, value: p.leads }))} empty="No leads in this period" />
            </Card>
            <Card title="Why leads were lost">
              <Bars rows={(data?.lostReasons || []).map((r) => ({ key: r.key, label: r.name_en, value: r.count }))} empty="No lost leads in this period" />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
