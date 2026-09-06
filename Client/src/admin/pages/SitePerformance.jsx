import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, Gauge, Timer, Users } from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import {
  DateRangePicker,
  StatCard,
  formatDay,
  formatMs,
  useSiteHealthRange,
} from '../components/SiteHealthChrome';

const FUNNEL_LABELS = {
  view_home: 'Home',
  view_search: 'Search',
  view_listing: 'Listing',
  view_checkout: 'Checkout',
  view_payment: 'Payment',
  booking_submitted: 'Request sent',
  payment_success: 'Card paid',
};

export default function SitePerformance() {
  const initial = useSiteHealthRange();
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);

  const { data, isLoading } = useQuery({
    queryKey: ['site-health-performance', fromDate, toDate],
    queryFn: () =>
      api
        .get('/site-health/performance', {
          params: { from_date: fromDate || undefined, to_date: toDate || undefined },
        })
        .then((r) => r.data),
  });

  const totals = data?.totals || { page_views: 0, sessions: 0, bookings: 0, payment_fails: 0 };
  const funnel = data?.funnel || [];
  const pages = data?.pages || [];
  const daily = data?.daily || [];
  const maxFunnel = useMemo(
    () => Math.max(1, ...funnel.map((row) => Number(row.sessions || row.hits) || 0)),
    [funnel]
  );
  const maxDaily = useMemo(
    () => Math.max(1, ...daily.map((row) => Number(row.count) || 0)),
    [daily]
  );

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="page-header mb-0">
        <h1 className="page-title">Site Performance</h1>
        <p className="page-subtitle">
          How the public website is used — page views, time on page, and where guests drop off.
        </p>
      </div>

      <DateRangePicker
        fromDate={fromDate}
        toDate={toDate}
        setFromDate={setFromDate}
        setToDate={setToDate}
      />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard icon={Eye} label="Page views" value={totals.page_views} />
        <StatCard icon={Users} label="Sessions" value={totals.sessions} />
        <StatCard icon={Gauge} label="Requests sent" value={totals.bookings} />
        <StatCard icon={Timer} label="Payment fails" value={totals.payment_fails} />
      </div>

      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-soul-line">
          <h2 className="font-semibold text-soul-blue">Booking path</h2>
          <p className="text-xs text-soul-muted mt-0.5">Unique sessions that reached each step.</p>
        </div>
        {!funnel.some((row) => row.sessions || row.hits) ? (
          <EmptyState title="No website traffic yet" subtitle="Views start counting as guests browse." />
        ) : (
          <ul className="divide-y divide-soul-line/70">
            {funnel.map((row) => (
              <li key={row.event} className="px-5 py-2.5 flex items-center gap-3">
                <span className="w-28 shrink-0 text-xs text-soul-muted">
                  {FUNNEL_LABELS[row.event] || row.event}
                </span>
                <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.round((Number(row.sessions || 0) / maxFunnel) * 100)}%`,
                      background: 'var(--pms-accent)',
                    }}
                  />
                </div>
                <span className="w-16 text-right text-sm font-semibold text-soul-blue">
                  {row.sessions}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-soul-line">
          <h2 className="font-semibold text-soul-blue">Daily views</h2>
        </div>
        {!daily.length ? (
          <EmptyState title="No daily views yet" />
        ) : (
          <ul className="max-h-[22rem] overflow-y-auto divide-y divide-soul-line/70">
            {daily.map((row) => (
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
                <span className="w-12 text-right text-sm font-semibold text-soul-blue">{row.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-soul-line">
          <h2 className="font-semibold text-soul-blue">Slowest / busiest pages</h2>
          <p className="text-xs text-soul-muted mt-0.5">Time spent on each page, plus the slow 10%.</p>
        </div>
        {!pages.length ? (
          <EmptyState title="No timings yet" subtitle="Timings appear after guests leave a page." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-soul-muted border-b border-soul-line">
                  <th className="px-5 py-3 font-semibold">Page</th>
                  <th className="px-5 py-3 font-semibold">Views</th>
                  <th className="px-5 py-3 font-semibold">Avg</th>
                  <th className="px-5 py-3 font-semibold">Slow 10%</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((row) => (
                  <tr key={row.path} className="border-b border-soul-line/70 last:border-0">
                    <td className="px-5 py-3 text-soul-blue font-medium">{row.path}</td>
                    <td className="px-5 py-3">{row.views}</td>
                    <td className="px-5 py-3">{formatMs(row.avg_ms)}</td>
                    <td className="px-5 py-3">{formatMs(row.p90_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
