import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bug, Clock, Layers } from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import {
  DateRangePicker,
  StatCard,
  formatWhen,
  useSiteHealthRange,
} from '../components/SiteHealthChrome';

const TYPE_LABELS = {
  js: 'Page crash',
  api: 'API',
  payment: 'Payment',
  checkout: 'Checkout',
  auth: 'Sign in / sign up',
  not_found: 'Missing page',
};

export default function GuestErrors() {
  const initial = useSiteHealthRange();
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);

  const { data, isLoading } = useQuery({
    queryKey: ['site-health-errors', fromDate, toDate],
    queryFn: () =>
      api
        .get('/site-health/errors', {
          params: { from_date: fromDate || undefined, to_date: toDate || undefined },
        })
        .then((r) => r.data),
  });

  const totals = data?.totals || { total: 0, today: 0 };
  const frequent = data?.frequent || [];
  const recent = data?.recent || [];
  const byType = data?.by_type || [];

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="page-header mb-0">
        <h1 className="page-title">Guest Errors</h1>
        <p className="page-subtitle">
          What customers hit on the public site — grouped by how often it happens.
        </p>
      </div>

      <DateRangePicker
        fromDate={fromDate}
        toDate={toDate}
        setFromDate={setFromDate}
        setToDate={setToDate}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={AlertTriangle} label="Errors in range" value={totals.total} hint="All guest-site failures" />
        <StatCard icon={Clock} label="Today" value={totals.today} hint="Cairo day so far" />
        <StatCard icon={Layers} label="Distinct issues" value={frequent.length} hint="Grouped by fingerprint" />
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

      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-soul-line">
          <h2 className="font-semibold text-soul-blue">Most frequent</h2>
          <p className="text-xs text-soul-muted mt-0.5">Same customer problem, counted together.</p>
        </div>
        {!frequent.length ? (
          <EmptyState
            icon={Bug}
            title="No guest errors yet"
            subtitle="This fills as people use the website. Empty is good."
          />
        ) : (
          <ul className="divide-y divide-soul-line/70">
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
          <h2 className="font-semibold text-soul-blue">Latest</h2>
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
  );
}
