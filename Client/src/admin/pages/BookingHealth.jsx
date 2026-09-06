import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, HeartPulse, Hourglass, XCircle } from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import {
  DateRangePicker,
  StatCard,
  formatWhen,
  useSiteHealthRange,
} from '../components/SiteHealthChrome';

function moneyCents(cents) {
  const n = Number(cents || 0) / 100;
  return `EGP ${n.toLocaleString('en-US')}`;
}

function StatusTable({ rows, empty }) {
  if (!rows?.length) return <EmptyState title={empty} />;
  return (
    <ul className="divide-y divide-soul-line/70">
      {rows.map((row, i) => (
        <li key={`${row.status}-${row.payment_status || ''}-${row.payment_method || ''}-${i}`} className="px-5 py-2.5 flex justify-between gap-3 text-sm">
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

export default function BookingHealth() {
  const initial = useSiteHealthRange();
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);

  const { data, isLoading } = useQuery({
    queryKey: ['site-health-bookings', fromDate, toDate],
    queryFn: () =>
      api
        .get('/site-health/bookings', {
          params: { from_date: fromDate || undefined, to_date: toDate || undefined },
        })
        .then((r) => r.data),
  });

  const totals = data?.totals || {
    website_bookings: 0,
    abandoned_checkouts: 0,
    stuck: 0,
    failed_cards: 0,
    abandoned_cards: 0,
    payment_fails: 0,
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="page-header mb-0">
        <h1 className="page-title">Booking Health</h1>
        <p className="page-subtitle">
          The money path — abandoned checkouts, failed card sessions, and website requests that never moved.
        </p>
      </div>

      <DateRangePicker
        fromDate={fromDate}
        toDate={toDate}
        setFromDate={setFromDate}
        setToDate={setToDate}
      />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatCard icon={HeartPulse} label="Website requests" value={totals.website_bookings} />
        <StatCard icon={Hourglass} label="Abandoned checkouts" value={totals.abandoned_checkouts} hint="Started payment, never finished" />
        <StatCard icon={XCircle} label="Failed cards" value={totals.failed_cards} />
        <StatCard icon={CreditCard} label="Stuck requests" value={totals.stuck} hint="Pending over 2 hours" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-soul-line">
            <h2 className="font-semibold text-soul-blue">Website requests</h2>
          </div>
          <StatusTable rows={data?.booking_status} empty="No website bookings in this range" />
        </section>
        <section className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-soul-line">
            <h2 className="font-semibold text-soul-blue">Card sessions</h2>
          </div>
          <StatusTable rows={data?.card_sessions} empty="No Paymob sessions in this range" />
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-soul-line">
          <h2 className="font-semibold text-soul-blue">Stuck website requests</h2>
          <p className="text-xs text-soul-muted mt-0.5">Still pending or held after two hours.</p>
        </div>
        <IssueList rows={data?.stuck_requests} empty="Nothing sitting in the queue" titleKey="Website request" />
      </section>

      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-soul-line">
          <h2 className="font-semibold text-soul-blue">Failed card checkouts</h2>
        </div>
        <IssueList rows={data?.failed_cards} empty="No failed card sessions" titleKey="Card checkout" />
      </section>

      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-soul-line">
          <h2 className="font-semibold text-soul-blue">Abandoned card sessions</h2>
          <p className="text-xs text-soul-muted mt-0.5">Left Paymob pending for more than 30 minutes.</p>
        </div>
        <IssueList rows={data?.abandoned_cards} empty="No abandoned card sessions" titleKey="Card checkout" />
      </section>
    </div>
  );
}
