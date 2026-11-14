import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BedDouble, Building2, CalendarDays, CalendarRange, FileBarChart2, MessageSquareText, Receipt, Sparkles, Wallet } from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { formatDate, unitDisplay } from '../utils/formatters';
import { useAuth } from '../../context/AuthContext';
import { egp } from './owner/ownerMoney';

function Tile({ icon: Icon, label, value, sub }) {
  return (
    <div className="card flex items-start gap-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-soul-blue/5 text-soul-blue">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-soul-muted">{label}</p>
        <p className="text-lg font-semibold tabular-nums text-soul-blue">{value}</p>
        {sub ? <p className="text-xs text-soul-muted">{sub}</p> : null}
      </div>
    </div>
  );
}

function monthName(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
}

/** Owner share by check-out month: one bar per month, the current month highlighted. */
function EarningsTrend({ trend }) {
  const max = Math.max(1, ...trend.map((t) => t.owner_share));
  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-soul-blue">Your earnings, last 6 months</h2>
        <span className="text-xs text-soul-muted">Your share, by check-out month</span>
      </div>
      <div className="flex h-44 items-end gap-3">
        {trend.map((t, i) => {
          const h = Math.max(4, Math.round((t.owner_share / max) * 100));
          const current = i === trend.length - 1;
          return (
            <div key={t.month} className="group flex h-full flex-1 flex-col items-center gap-2">
              <span className="text-[11px] tabular-nums text-soul-muted">{t.owner_share > 0 ? egp(t.owner_share).replace('EGP ', '') : ''}</span>
              <div className="flex w-full flex-1 items-end justify-center">
                <div
                  className={`w-full max-w-[44px] rounded-t-md ${current ? 'bg-[#e8743b]' : 'bg-soul-blue/70'}`}
                  style={{ height: `${h}%` }}
                  title={`${monthName(t.month)}: ${egp(t.owner_share)} · ${t.nights} nights`}
                />
              </div>
              <span className={`text-xs ${current ? 'font-semibold text-soul-blue' : 'text-soul-muted'}`}>{monthName(t.month)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function OwnerDashboard() {
  const { user } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ['owner-dashboard'],
    queryFn: () => api.get('/owner/dashboard').then((r) => r.data),
  });

  if (isLoading) return <LoadingSpinner />;
  if (error) return <p className="text-sm text-red-600">Couldn’t load your dashboard. Pull to refresh or try again in a minute.</p>;

  const w = data?.wallet || {};
  const units = data?.units || [];
  const upcoming = data?.upcoming || [];
  const expenses = data?.expenses || [];
  const firstName = String(user?.full_name || '').split(' ')[0];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="text-sm text-soul-muted">Welcome back{firstName ? `, ${firstName}` : ''}</p>
        <h1 className="text-2xl font-bold text-soul-blue">Your homes at a glance</h1>
      </div>

      <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-2xl bg-gradient-to-br from-[#0b2f4a] to-[#0b4f73] p-6 text-white shadow-lg">
          <p className="text-xs uppercase tracking-[0.18em] text-white/70">Available to request</p>
          <p className="mt-2 text-4xl font-semibold tabular-nums">{egp(w.available)}</p>
          <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-white/60">This month</p>
              <p className="font-semibold tabular-nums">{egp(w.earned_this_month)}</p>
            </div>
            <div>
              <p className="text-white/60">Upcoming</p>
              <p className="font-semibold tabular-nums">{egp(w.upcoming)}</p>
            </div>
            <div>
              <p className="text-white/60">Paid to you</p>
              <p className="font-semibold tabular-nums">{egp(w.paid_out)}</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link to="/admin/owner/payouts" className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#0b2f4a]">
              <Wallet className="h-4 w-4" /> Request payout
            </Link>
            <Link to="/admin/owner/statement" className="inline-flex items-center gap-2 rounded-full border border-white/30 px-4 py-2 text-sm text-white">
              <FileBarChart2 className="h-4 w-4" /> Statement
            </Link>
          </div>
          {w.in_progress > 0 ? <p className="mt-3 text-xs text-white/70">{egp(w.in_progress)} is already on its way to you.</p> : null}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Tile icon={Building2} label="Homes" value={units.length} sub={units.length ? units.map((u) => u.unit_number || u.title).slice(0, 3).join(', ') : 'None linked yet'} />
          <Tile icon={CalendarDays} label="Booked this month" value={`${data?.month_occupancy_pct ?? 0}%`} sub={`${data?.month_nights ?? 0} of ${data?.month_available_nights ?? 0} nights`} />
          <Tile icon={BedDouble} label="Upcoming nights" value={w.upcoming_nights || 0} sub={`${w.upcoming_stays || 0} stay${w.upcoming_stays === 1 ? '' : 's'} booked`} />
          <Tile icon={Receipt} label="Expenses charged" value={egp(w.expenses)} sub="Deducted from your balance" />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <EarningsTrend trend={data?.trend || []} />

        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-soul-blue">Next stays</h2>
            <Link to="/admin/owner/reservations" className="inline-flex items-center gap-1 text-xs text-soul-blue">
              All <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="py-6 text-center text-sm text-soul-muted">No upcoming stays yet.</p>
          ) : (
            <ul className="divide-y divide-soul-line">
              {upcoming.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-soul-blue">
                      {formatDate(s.check_in)} → {formatDate(s.check_out)}
                      {s.in_house ? <span className="ms-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">Staying now</span> : null}
                      {s.owner_stay ? <span className="ms-2 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">Your stay</span> : null}
                    </p>
                    <p className="text-xs text-soul-muted">{s.unit_name} · {s.nights} night{s.nights === 1 ? '' : 's'}</p>
                  </div>
                  {!s.owner_stay ? <span className="shrink-0 tabular-nums text-soul-blue">{egp(s.owner_share)}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ['/admin/owner/blocks', CalendarRange, 'Block dates', 'Keep your home free for yourself'],
          ['/admin/owner/inspections', Sparkles, 'Inspections', 'Photos and reports from your home'],
          ['/admin/owner/comments', MessageSquareText, 'Talk to us', 'Questions or requests for the team'],
        ].map(([to, Icon, title, sub]) => (
          <Link key={to} to={to} className="card flex items-center gap-3 transition hover:border-soul-blue/40">
            <Icon className="h-5 w-5 text-soul-blue" />
            <div>
              <p className="font-medium text-soul-blue">{title}</p>
              <p className="text-xs text-soul-muted">{sub}</p>
            </div>
          </Link>
        ))}
      </section>

      <section className="card overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-soul-line px-5 py-4">
          <h2 className="font-semibold text-soul-blue">Expenses charged to you</h2>
          <Link to="/admin/owner/statement" className="text-xs text-soul-blue">Full statement</Link>
        </div>
        {expenses.length === 0 ? (
          <p className="p-6 text-sm text-soul-muted">No expenses charged to you in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-soul-muted">
                <tr>
                  <th className="px-5 py-3 text-left">Date</th>
                  <th className="px-5 py-3 text-left">Home</th>
                  <th className="px-5 py-3 text-left">What</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-soul-line">
                {expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-5 py-3">{formatDate(e.expense_date)}</td>
                    <td className="px-5 py-3">{unitDisplay(e)}</td>
                    <td className="px-5 py-3">{e.description}</td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums text-rose-700">− {egp(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {units.length === 0 ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          No homes are linked to your account yet. Message the team from “Talk to us” and they’ll link them.
        </p>
      ) : null}
    </div>
  );
}
