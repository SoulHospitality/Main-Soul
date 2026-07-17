import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BadgeDollarSign, Sparkles, Zap, TrendingUp, Users2, Wallet,
  Receipt, Landmark, Home, DollarSign, ChevronRight,
} from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { currency } from '../utils/formatters';

function MetricCard({ icon: Icon, label, value, href, tone = 'slate', sub, emphasize }) {
  const tones = {
    slate:   { wrap: 'border-slate-200 bg-white', icon: 'bg-slate-100 text-slate-600', val: 'text-slate-900' },
    emerald: { wrap: 'border-emerald-200 bg-emerald-50/60', icon: 'bg-emerald-100 text-emerald-700', val: 'text-emerald-800' },
    amber:   { wrap: 'border-amber-200 bg-amber-50/60', icon: 'bg-amber-100 text-amber-700', val: 'text-amber-800' },
    rose:    { wrap: 'border-rose-200 bg-rose-50/50', icon: 'bg-rose-100 text-rose-700', val: 'text-rose-800' },
    blue:    { wrap: 'border-blue-200 bg-blue-50/50', icon: 'bg-blue-100 text-blue-700', val: 'text-blue-800' },
    violet:  { wrap: 'border-violet-200 bg-violet-50/50', icon: 'bg-violet-100 text-violet-700', val: 'text-violet-800' },
  };
  const t = tones[tone] || tones.slate;
  const body = (
    <div className={`rounded-2xl border p-5 h-full transition-shadow hover:shadow-md ${t.wrap} ${emphasize ? 'ring-2 ring-emerald-300/60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${t.icon}`}>
          <Icon className="w-5 h-5" />
        </div>
        {href && <ChevronRight className="w-4 h-4 text-slate-300 mt-1" />}
      </div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold tabular-nums ${t.val}`}>{currency(value)}</p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
  if (href) {
    return (
      <Link to={href} className="block h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-2xl">
        {body}
      </Link>
    );
  }
  return body;
}

export default function Finance() {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['finance-summary', fromDate, toDate],
    queryFn: () =>
      api
        .get('/finance/summary', {
          params: {
            from_date: fromDate || undefined,
            to_date: toDate || undefined,
          },
        })
        .then((r) => r.data),
    refetchInterval: 60_000,
  });

  if (isLoading) return <LoadingSpinner />;
  if (error) {
    return (
      <div className="card p-8 text-center text-red-600">
        Failed to load finance summary.
      </div>
    );
  }

  const cash = data?.cashflow || {};

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="page-header mb-0">
          <h1 className="page-title">Finance</h1>
          <p className="page-subtitle">
            Company revenue overview — housekeeping, utilities, salaries, and petty cash are treated as expenses
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            className="input w-36 text-sm"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
          <span className="text-slate-400 text-sm">to</span>
          <input
            type="date"
            className="input w-36 text-sm"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
          <Link to="/admin/profit" className="btn-primary text-sm whitespace-nowrap">
            View Profit
          </Link>
        </div>
      </div>

      {/* Total Revenue hero */}
      <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700/80">Total Revenue</p>
        <p className="mt-2 text-4xl sm:text-5xl font-bold tabular-nums text-emerald-900">
          {currency(data?.totalRevenue)}
        </p>
        <p className="mt-2 text-sm text-emerald-800/70">
          Gross rental revenue from reservations
          {(fromDate || toDate) ? ' in the selected period' : ''}
        </p>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <span className="text-slate-600">
            Expenses deducted for profit:{' '}
            <strong className="text-rose-700">{currency(data?.totalExpenses)}</strong>
          </span>
          <span className="text-slate-600">
            Current profit:{' '}
            <strong className={(data?.profit || 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
              {currency(data?.profit)}
            </strong>
          </span>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Breakdown</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <MetricCard
            icon={Sparkles}
            label="Housekeeping Fees"
            value={data?.housekeeping}
            href="/admin/housekeeping"
            tone="rose"
            sub="Expense — deducted from revenue"
          />
          <MetricCard
            icon={Zap}
            label="Utilities"
            value={data?.utilities}
            href="/admin/utilities"
            tone="rose"
            sub="Expense — deducted from revenue"
          />
          <MetricCard
            icon={TrendingUp}
            label="Cashflow"
            value={cash.net}
            href="/admin/cashflow"
            tone="blue"
            sub={`In ${currency(cash.inflow)} · Out ${currency(cash.outflow)}`}
          />
          <MetricCard
            icon={Users2}
            label="Salaries"
            value={data?.salaries}
            href="/admin/hr"
            tone="rose"
            sub="Expense — active payroll total"
          />
          <MetricCard
            icon={BadgeDollarSign}
            label="Company Commission"
            value={data?.companyCommission}
            tone="amber"
            sub="Nightly rate × commission %"
          />
          <MetricCard
            icon={DollarSign}
            label="Tenant Commission"
            value={data?.tenantCommission}
            tone="violet"
            sub="Mode B / C tenant %"
          />
          <MetricCard
            icon={Home}
            label="Owed to Unit Owners"
            value={data?.ownerOwed}
            href="/admin/owner-statement"
            tone="slate"
            sub="Net amount due to owners"
          />
          <MetricCard
            icon={Receipt}
            label="Expenses"
            value={data?.expenses}
            href="/admin/expenses"
            tone="rose"
            sub="Expense — general expense ledger"
          />
          <MetricCard
            icon={Wallet}
            label="Petty Cash"
            value={data?.pettyCash}
            href="/admin/petty-cash"
            tone="rose"
            sub="Expense — cash outs"
          />
          <MetricCard
            icon={Landmark}
            label="Treasury"
            value={cash.outflow}
            href="/admin/treasury"
            tone="blue"
            sub="Ledger outflows (reference)"
          />
        </div>
      </div>
    </div>
  );
}
