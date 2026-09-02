import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, CalendarDays, Handshake, Trophy, Users, ClipboardList } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS, isResaleManager } from '../utils/permissions';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';

function defaultRange() {
  const to = new Date().toISOString().slice(0, 10);
  const fromDt = new Date(`${to}T12:00:00Z`);
  fromDt.setUTCDate(fromDt.getUTCDate() - 29);
  return { from: fromDt.toISOString().slice(0, 10), to };
}

function formatDay(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function medal(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `${rank}`;
}

function DateRangePicker({ fromDate, toDate, setFromDate, setToDate }) {
  return (
    <div className="card p-3 flex flex-wrap items-end gap-3">
      <div>
        <label className="label text-xs">From</label>
        <input
          type="date"
          className="input w-40"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
        />
      </div>
      <div>
        <label className="label text-xs">To</label>
        <input
          type="date"
          className="input w-40"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
        />
      </div>
    </div>
  );
}

function DailyBars({ rows, title, subtitle, emptyTitle }) {
  const maxDaily = useMemo(
    () => Math.max(1, ...rows.map((row) => Number(row.count) || 0)),
    [rows]
  );

  return (
    <section className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-soul-line">
        <h2 className="font-semibold text-soul-blue">{title}</h2>
        {subtitle ? <p className="text-xs text-soul-muted mt-0.5">{subtitle}</p> : null}
      </div>
      {!rows.length ? (
        <EmptyState title={emptyTitle} />
      ) : (
        <ul className="max-h-[28rem] overflow-y-auto divide-y divide-soul-line/70">
          {rows.map((row) => (
            <li key={row.date} className="px-5 py-2.5 flex items-center gap-3">
              <span className="w-28 shrink-0 text-xs text-soul-muted">{formatDay(row.date)}</span>
              <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round((Number(row.count) / maxDaily) * 100)}%`,
                    background: 'var(--pms-accent)',
                  }}
                />
              </div>
              <span className="w-8 text-right text-sm font-semibold tabular-nums text-soul-blue">
                {row.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReservationsPerformance() {
  const { user } = useAuth();
  const initial = defaultRange();
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);

  const { data, isLoading } = useQuery({
    queryKey: ['reservations-performance', fromDate, toDate],
    queryFn: () =>
      api
        .get('/reservations-performance', {
          params: { from_date: fromDate || undefined, to_date: toDate || undefined },
        })
        .then((r) => r.data),
  });

  const totals = data?.totals || { total: 0, today: 0, team_size: 0 };
  const daily = data?.daily || [];
  const leaderboard = data?.leaderboard || [];

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="page-header mb-0">
        <h1 className="page-title">Performance</h1>
        <p className="page-subtitle">
          {user?.role === 'admin'
            ? 'Reservation counts for every reservations agent.'
            : 'How your team is booking — totals, daily pace, and the leaderboard.'}
        </p>
      </div>

      <DateRangePicker
        fromDate={fromDate}
        toDate={toDate}
        setFromDate={setFromDate}
        setToDate={setToDate}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="flex items-center gap-3 text-soul-muted text-xs font-semibold uppercase tracking-wide">
            <ClipboardList className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
            Reservations in range
          </div>
          <p className="mt-2 font-display text-3xl text-soul-blue">{totals.total}</p>
          <p className="mt-1 text-xs text-soul-muted">
            Created {fromDate} – {toDate}
          </p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 text-soul-muted text-xs font-semibold uppercase tracking-wide">
            <CalendarDays className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
            Done today
          </div>
          <p className="mt-2 font-display text-3xl text-soul-blue">{totals.today}</p>
          <p className="mt-1 text-xs text-soul-muted">Cairo calendar day</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 text-soul-muted text-xs font-semibold uppercase tracking-wide">
            <Users className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
            Team
          </div>
          <p className="mt-2 font-display text-3xl text-soul-blue">{totals.team_size}</p>
          <p className="mt-1 text-xs text-soul-muted">Agents you manage, including you</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-soul-line flex items-center gap-2">
            <Trophy className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
            <h2 className="font-semibold text-soul-blue">Leaderboard</h2>
          </div>
          {!leaderboard.length ? (
            <EmptyState
              title="No team members yet"
              subtitle="Assign agents to this reservations manager in Users."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-soul-muted border-b border-soul-line">
                    <th className="px-5 py-2.5 font-semibold">Rank</th>
                    <th className="px-3 py-2.5 font-semibold">Agent</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Today</th>
                    <th className="px-5 py-2.5 font-semibold text-right">In range</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row, idx) => (
                    <tr key={row.staff_id} className="border-b border-soul-line/70 last:border-0">
                      <td className="px-5 py-3 font-semibold text-soul-blue">{medal(idx + 1)}</td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-soul-blue">{row.full_name}</div>
                        <div className="text-[11px] text-soul-muted">
                          {ROLE_LABELS[row.role] || row.role}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.today}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-semibold">{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <DailyBars
          rows={daily}
          title="Daily reservations"
          subtitle="Bookings created each day in the selected range"
          emptyTitle="No days in range"
        />
      </div>
    </div>
  );
}

function ResalePerformance() {
  const initial = defaultRange();
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);

  const { data, isLoading } = useQuery({
    queryKey: ['resale-performance', fromDate, toDate],
    queryFn: () =>
      api
        .get('/resale-performance', {
          params: { from_date: fromDate || undefined, to_date: toDate || undefined },
        })
        .then((r) => r.data),
  });

  const totals = data?.totals || {
    units_total: 0,
    units_today: 0,
    sales_total: 0,
    sales_today: 0,
    team_size: 0,
  };
  const dailyUnits = data?.daily_units || [];
  const dailySales = data?.daily_sales || [];
  const leaderboard = data?.leaderboard || [];

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="page-header mb-0">
        <h1 className="page-title">Performance</h1>
        <p className="page-subtitle">
          Track resale agents — units listed for sale and signed owner requests.
        </p>
      </div>

      <DateRangePicker
        fromDate={fromDate}
        toDate={toDate}
        setFromDate={setFromDate}
        setToDate={setToDate}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="card p-5">
          <div className="flex items-center gap-3 text-soul-muted text-xs font-semibold uppercase tracking-wide">
            <Building2 className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
            Units added
          </div>
          <p className="mt-2 font-display text-3xl text-soul-blue">{totals.units_total}</p>
          <p className="mt-1 text-xs text-soul-muted">{fromDate} – {toDate}</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 text-soul-muted text-xs font-semibold uppercase tracking-wide">
            <CalendarDays className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
            Units today
          </div>
          <p className="mt-2 font-display text-3xl text-soul-blue">{totals.units_today}</p>
          <p className="mt-1 text-xs text-soul-muted">Sale listings created today</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 text-soul-muted text-xs font-semibold uppercase tracking-wide">
            <Handshake className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
            Sales signed
          </div>
          <p className="mt-2 font-display text-3xl text-soul-blue">{totals.sales_total}</p>
          <p className="mt-1 text-xs text-soul-muted">Owner requests marked signed</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 text-soul-muted text-xs font-semibold uppercase tracking-wide">
            <Users className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
            Team
          </div>
          <p className="mt-2 font-display text-3xl text-soul-blue">{totals.team_size}</p>
          <p className="mt-1 text-xs text-soul-muted">Resale agents you manage</p>
        </div>
      </div>

      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-soul-line flex items-center gap-2">
          <Trophy className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
          <h2 className="font-semibold text-soul-blue">Leaderboard</h2>
        </div>
        {!leaderboard.length ? (
          <EmptyState
            title="No resale agents yet"
            subtitle="Assign resale agents to this manager in User Management."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-soul-muted border-b border-soul-line">
                  <th className="px-5 py-2.5 font-semibold">Rank</th>
                  <th className="px-3 py-2.5 font-semibold">Agent</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Units today</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Units</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Sales today</th>
                  <th className="px-5 py-2.5 font-semibold text-right">Sales</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((row, idx) => (
                  <tr key={row.staff_id} className="border-b border-soul-line/70 last:border-0">
                    <td className="px-5 py-3 font-semibold text-soul-blue">{medal(idx + 1)}</td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-soul-blue">{row.full_name}</div>
                      <div className="text-[11px] text-soul-muted">
                        {ROLE_LABELS[row.role] || row.role}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.units_today}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium">{row.units_total}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.sales_today}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold">
                      {row.sales_total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <DailyBars
          rows={dailyUnits}
          title="Units added daily"
          subtitle="Sale units created each day"
          emptyTitle="No unit activity in range"
        />
        <DailyBars
          rows={dailySales}
          title="Sales signed daily"
          subtitle="Owner requests marked signed each day"
          emptyTitle="No signed sales in range"
        />
      </div>
    </div>
  );
}

export default function Performance() {
  const { user } = useAuth();
  if (isResaleManager(user)) return <ResalePerformance />;
  return <ReservationsPerformance />;
}
