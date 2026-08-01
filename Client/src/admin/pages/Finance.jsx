import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BadgeDollarSign, Sparkles, Zap, TrendingUp, Users2, Wallet,
  Receipt, Home, DollarSign, ChevronRight, Megaphone, CalendarDays,
  UserCheck, Percent,
} from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { currency } from '../utils/formatters';
import { FINANCIAL_EPOCH } from '../utils/financialEpoch';

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
  const [fromDate, setFromDate] = useState(FINANCIAL_EPOCH);
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

  const model = data?.model || {};

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="page-header mb-0">
          <h1 className="page-title">Finance</h1>
          <p className="page-subtitle">
            Revenue (reservations + housekeeping + utilities) → expenses → gross profit → {model.tax_pct || 14}% tax → net profit.
            Books from {FINANCIAL_EPOCH}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" className="input w-36 text-sm" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <span className="text-slate-400 text-sm">to</span>
          <input type="date" className="input w-36 text-sm" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          <Link to="/admin/profit" className="btn-primary text-sm whitespace-nowrap">
            View Profit
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700/80">Total Revenue</p>
        <p className="mt-2 text-4xl sm:text-5xl font-bold tabular-nums text-emerald-900">
          {currency(data?.totalRevenue)}
        </p>
        <p className="mt-2 text-sm text-emerald-800/70">
          Reservations {currency(data?.reservationRevenue)}
          {' · '}HK {currency(data?.housekeepingRevenue)}
          {' · '}Utilities {currency(data?.utilitiesRevenue)}
        </p>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <span className="text-slate-600">
            Expenses: <strong className="text-rose-700">{currency(data?.totalExpenses)}</strong>
          </span>
          <span className="text-slate-600">
            Gross: <strong className={(data?.grossProfit || 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{currency(data?.grossProfit)}</strong>
          </span>
          <span className="text-slate-600">
            Tax ({model.tax_pct || 14}%): <strong className="text-amber-800">{currency(data?.taxAmount)}</strong>
          </span>
          <span className="text-slate-600">
            Net: <strong className={(data?.netProfit || 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{currency(data?.netProfit)}</strong>
          </span>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Revenue sources</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            icon={CalendarDays}
            label="Reservations"
            value={data?.reservationRevenue}
            href="/admin/reservations"
            tone="emerald"
            sub="Accommodation gross"
          />
          <MetricCard
            icon={Sparkles}
            label="Housekeeping"
            value={data?.housekeepingRevenue}
            href="/admin/housekeeping"
            tone="emerald"
            sub="Collected guest HK fees"
          />
          <MetricCard
            icon={Zap}
            label="Utilities"
            value={data?.utilitiesRevenue}
            tone="emerald"
            sub="Collected on stays (not actual cost)"
          />
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Automatic expenses</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <MetricCard
            icon={Home}
            label="Owner %"
            value={data?.ownerOwed}
            tone="rose"
            sub="Owner share (auto)"
          />
          <MetricCard
            icon={Users2}
            label="Salaries"
            value={data?.salaries}
            href="/admin/expenses?category=salary"
            tone="rose"
            sub="Payroll + salary ledger"
          />
          <MetricCard
            icon={UserCheck}
            label={`Manual agents ${model.manual_agent_pct ?? 1.5}%`}
            value={data?.manualAgentCommission}
            href="/admin/commissions"
            tone="violet"
            sub="Of company commission"
          />
          <MetricCard
            icon={UserCheck}
            label={`Website agents ${model.website_agent_pct ?? 1}%`}
            value={data?.websiteAgentCommission}
            href="/admin/commissions"
            tone="violet"
            sub="Of company commission"
          />
          <MetricCard
            icon={Percent}
            label={`Website's commission ${model.website_maker_pct ?? 0.5}%`}
            value={data?.websiteMakerCommission}
            href="/admin/commissions"
            tone="amber"
            sub="Of website company commission"
          />
          <MetricCard
            icon={BadgeDollarSign}
            label="Company commission (base)"
            value={data?.companyCommission}
            href="/admin/commissions"
            tone="amber"
            sub="Base for agent / website %"
          />
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Manual expenses</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <MetricCard
            icon={Sparkles}
            label="Actual housekeeping"
            value={data?.actualHousekeeping}
            href="/admin/expenses?category=housekeeping_cost"
            tone="rose"
            sub="Enter on Expenses"
          />
          <MetricCard
            icon={Zap}
            label="Actual utilities"
            value={data?.actualUtilities}
            href="/admin/expenses?category=utilities_cost"
            tone="rose"
            sub="Enter on Expenses"
          />
          <MetricCard
            icon={Wallet}
            label="Petty cash"
            value={data?.pettyCash}
            href="/admin/petty-cash"
            tone="rose"
            sub="Cash outs"
          />
          <MetricCard
            icon={Megaphone}
            label="Marketing"
            value={data?.marketing}
            href="/admin/expenses?category=marketing"
            tone="rose"
            sub="Enter on Expenses"
          />
          <MetricCard
            icon={Receipt}
            label="Other expenses"
            value={data?.expenses}
            href="/admin/expenses?category=other"
            tone="rose"
            sub="Enter on Expenses"
          />
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Profit</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            icon={TrendingUp}
            label="Gross profit"
            value={data?.grossProfit}
            href="/admin/profit"
            tone={(data?.grossProfit || 0) >= 0 ? 'emerald' : 'rose'}
            sub="Revenue − expenses"
            emphasize
          />
          <MetricCard
            icon={DollarSign}
            label={`Tax ${model.tax_pct || 14}%`}
            value={data?.taxAmount}
            href="/admin/profit"
            tone="amber"
            sub="Of gross profit"
          />
          <MetricCard
            icon={TrendingUp}
            label="Net profit"
            value={data?.netProfit}
            href="/admin/profit"
            tone={(data?.netProfit || 0) >= 0 ? 'emerald' : 'rose'}
            sub="Gross − tax"
            emphasize
          />
        </div>
      </div>
    </div>
  );
}
