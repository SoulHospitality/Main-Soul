import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  AlertTriangle,
  Clock,
  CreditCard,
  Eye,
  Gauge,
  HeartPulse,
  Hourglass,
  Layers,
  Timer,
  Users,
  XCircle,
} from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import {
  DateRangePicker,
  StatCard,
  formatDay,
  formatMs,
  formatWhen,
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

const TYPE_LABELS = {
  js: 'Page crash',
  api: 'API',
  payment: 'Payment',
  checkout: 'Checkout',
  auth: 'Sign in / sign up',
  not_found: 'Missing page',
};

function moneyCents(cents) {
  const n = Number(cents || 0) / 100;
  return `EGP ${n.toLocaleString('en-US')}`;
}

function StatusTable({ rows, empty }) {
  if (!rows?.length) return <EmptyState title={empty} />;
  return (
    <ul className="divide-y divide-soul-line/70">
      {rows.map((row, i) => (
        <li
          key={`${row.status}-${row.payment_status || ''}-${row.payment_method || ''}-${i}`}
          className="px-5 py-2.5 flex justify-between gap-3 text-sm"
        >
          <span className="text-soul-blue">
            {row.status}
            {row.payment_status ? ` · ${row.payment_status}` : ''}
            {row.payment_method ? ` · ${row.payment_method}` : ''}
          </span>
          <span className="font-semibold text-soul-blue">{row.count}</span>
        </li>
      ))}
    </ul>
  );
}

function IssueList({ rows, empty, titleKey }) {
  if (!rows?.length) return <EmptyState title={empty} />;
  return (
    <ul className="divide-y divide-soul-line/70">
      {rows.map((row) => (
        <li key={row.id} className="px-5 py-3">
          <p className="text-sm font-semibold text-soul-blue">
            {row.listing_title || row.listing_slug || titleKey}
          </p>
          <p className="mt-0.5 text-xs text-soul-muted">
            {row.status}
            {row.payment_status ? ` · ${row.payment_status}` : ''}
            {row.payment_method ? ` · ${row.payment_method}` : ''}
            {row.amount_cents != null ? ` · ${moneyCents(row.amount_cents)}` : ''}
            {row.created_at ? ` · ${formatWhen(row.created_at)}` : ''}
          </p>
        </li>
      ))}
    </ul>
  );
}

function SectionTitle({ children, hint }) {
  return (
    <div className="pt-2">
      <h2 className="text-lg font-semibold text-soul-blue">{children}</h2>
      {hint ? <p className="text-xs text-soul-muted mt-0.5">{hint}</p> : null}
    </div>
  );
}

export default function SitePerformance() {
  const initial = useSiteHealthRange();
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const params = { from_date: fromDate || undefined, to_date: toDate || undefined };

  const [errorsQ, perfQ, bookingsQ] = useQueries({
    queries: [
      {
        queryKey: ['site-health-errors', fromDate, toDate],
        queryFn: () => api.get('/site-health/errors', { params }).then((r) => r.data),
      },
      {
        queryKey: ['site-health-performance', fromDate, toDate],
        queryFn: () => api.get('/site-health/performance', { params }).then((r) => r.data),
      },
      {
        queryKey: ['site-health-bookings', fromDate, toDate],
        queryFn: () => api.get('/site-health/bookings', { params }).then((r) => r.data),
      },
    ],
  });

  const errors = errorsQ.data;
  const perf = perfQ.data;
  const bookings = bookingsQ.data;

  const errorTotals = errors?.totals || { total: 0, today: 0 };
  const frequent = errors?.frequent || [];
  const recent = errors?.recent || [];
  const byType = errors?.by_type || [];

  const perfTotals = perf?.totals || { page_views: 0, sessions: 0, bookings: 0, payment_fails: 0 };
  const funnel = perf?.funnel || [];
  const pages = perf?.pages || [];
  const daily = perf?.daily || [];
  const maxFunnel = useMemo(
    () => Math.max(1, ...funnel.map((row) => Number(row.sessions || row.hits) || 0)),
    [funnel]
  );
  const maxDaily = useMemo(
    () => Math.max(1, ...daily.map((row) => Number(row.count) || 0)),
    [daily]
  );

  const bookingTotals = bookings?.totals || {
    website_bookings: 0,
    abandoned_checkouts: 0,
    stuck: 0,
    failed_cards: 0,
  };

  if (errorsQ.isLoading || perfQ.isLoading || bookingsQ.isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="page-header mb-0">
        <h1 className="page-title">Website Performance</h1>
        <p className="page-subtitle">
          Guest errors, traffic, and the booking path on the public site.
        </p>
      </div>

      <DateRangePicker
        fromDate={fromDate}
        toDate={toDate}
        setFromDate={setFromDate}
        setToDate={setToDate}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Eye} label="Page views" value={perfTotals.page_views} />
        <StatCard icon={Users} label="Sessions" value={perfTotals.sessions} />
        <StatCard icon={AlertTriangle} label="Guest errors" value={errorTotals.total} hint={`${errorTotals.today} today`} />
        <StatCard
          icon={Hourglass}
          label="Abandoned checkouts"
          value={bookingTotals.abandoned_checkouts}
        />
      </div>

      <SectionTitle hint="What customers hit, grouped by how often it happens.">Guest errors</SectionTitle>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={Clock} label="Today" value={errorTotals.today} hint="Cairo day so far" />
        <StatCard icon={Layers} label="Distinct issues" value={frequent.length} />
        <StatCard icon={Timer} label="Payment fails" value={perfTotals.payment_fails} />
      </div>

      {byType.length ? (
        <div className="flex flex-wrap gap-2">
          {byType.map((row) => (
            <span
              key={row.error_type}
              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-soul-blue"
            >
              {TYPE_LABELS[row.error_type] || row.error_type} · {row.count}
            </span>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-soul-line">
            <h3 className="font-semibold text-soul-blue">Most frequent</h3>
          </div>
          {!frequent.length ? (
            <EmptyState title="No guest errors yet" subtitle="Empty is good." />
          ) : (
            <ul className="divide-y divide-soul-line/70 max-h-[28rem] overflow-y-auto">
              {frequent.map((row) => (
                <li key={`${row.fingerprint}-${row.error_type}`} className="px-5 py-3.5 flex gap-4">
                  <div
                    className="min-w-[2.75rem] h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white"
                    style={{ background: 'var(--pms-accent)' }}
                  >
                    {row.count}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-soul-blue truncate">{row.message}</p>
                    <p className="mt-0.5 text-xs text-soul-muted">
                      {TYPE_LABELS[row.error_type] || row.error_type}
                      {row.path ? ` · ${row.path}` : ''}
                      {row.status_code ? ` · ${row.status_code}` : ''}
                      {row.last_seen ? ` · last ${formatWhen(row.last_seen)}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-soul-line">
            <h3 className="font-semibold text-soul-blue">Latest</h3>
          </div>
          {!recent.length ? (
            <EmptyState title="No recent errors" />
          ) : (
            <ul className="divide-y divide-soul-line/70 max-h-[28rem] overflow-y-auto">
              {recent.map((row) => (
                <li key={row.id} className="px-5 py-3">
                  <p className="text-sm text-soul-blue">{row.message}</p>
                  <p className="mt-0.5 text-xs text-soul-muted">
                    {TYPE_LABELS[row.error_type] || row.error_type}
                    {row.path ? ` · ${row.path}` : ''}
                    {row.status_code ? ` · ${row.status_code}` : ''}
                    {' · '}
                    {formatWhen(row.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <SectionTitle hint="How guests move through the site, and how long pages take.">Traffic</SectionTitle>

      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-soul-line">
          <h3 className="font-semibold text-soul-blue">Booking path</h3>
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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-soul-line">
            <h3 className="font-semibold text-soul-blue">Daily views</h3>
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
            <h3 className="font-semibold text-soul-blue">Page speed</h3>
            <p className="text-xs text-soul-muted mt-0.5">Time spent on each page, plus the slow 10%.</p>
          </div>
          {!pages.length ? (
            <EmptyState title="No timings yet" />
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

      <SectionTitle hint="Abandoned checkouts, failed cards, and requests that never moved.">
        Booking health
      </SectionTitle>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={HeartPulse} label="Website requests" value={bookingTotals.website_bookings} />
        <StatCard icon={Gauge} label="Requests sent" value={perfTotals.bookings} />
        <StatCard icon={XCircle} label="Failed cards" value={bookingTotals.failed_cards} />
        <StatCard icon={CreditCard} label="Stuck requests" value={bookingTotals.stuck} hint="Pending over 2 hours" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-soul-line">
            <h3 className="font-semibold text-soul-blue">Website requests</h3>
          </div>
          <StatusTable rows={bookings?.booking_status} empty="No website bookings in this range" />
        </section>
        <section className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-soul-line">
            <h3 className="font-semibold text-soul-blue">Card sessions</h3>
          </div>
          <StatusTable rows={bookings?.card_sessions} empty="No Paymob sessions in this range" />
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-soul-line">
          <h3 className="font-semibold text-soul-blue">Stuck website requests</h3>
          <p className="text-xs text-soul-muted mt-0.5">Still pending or held after two hours.</p>
        </div>
        <IssueList rows={bookings?.stuck_requests} empty="Nothing sitting in the queue" titleKey="Website request" />
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-soul-line">
            <h3 className="font-semibold text-soul-blue">Failed card checkouts</h3>
          </div>
          <IssueList rows={bookings?.failed_cards} empty="No failed card sessions" titleKey="Card checkout" />
        </section>
        <section className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-soul-line">
            <h3 className="font-semibold text-soul-blue">Abandoned card sessions</h3>
            <p className="text-xs text-soul-muted mt-0.5">Left Paymob pending for more than 30 minutes.</p>
          </div>
          <IssueList rows={bookings?.abandoned_cards} empty="No abandoned card sessions" titleKey="Card checkout" />
        </section>
      </div>
    </div>
  );
}
