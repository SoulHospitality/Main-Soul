import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp, TrendingDown, ArrowRight, Sparkles, Zap, Users2, Wallet, Receipt,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { currency } from '../utils/formatters';
import { FINANCIAL_EPOCH } from '../utils/financialEpoch';

function Row({ label, value, href, negative, hint }) {
  const inner = (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
      <div>
        <span className="text-sm text-slate-600">{label}</span>
        {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
      </div>
      <span className={`text-sm font-semibold tabular-nums ${negative ? 'text-rose-600' : 'text-slate-800'}`}>
        {negative ? '− ' : ''}{currency(Math.abs(value || 0))}
      </span>
    </div>
  );
  if (href) {
    return (
      <Link to={href} className="block hover:bg-slate-50/80 -mx-2 px-2 rounded-lg transition-colors">
        {inner}
      </Link>
    );
  }
  return inner;
}

export default function Profit() {
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
    refetchInterval: 30_000,
  });

  if (isLoading) return <LoadingSpinner />;
  if (error) {
    return (
      <div className="card p-8 text-center text-red-600">
        Failed to load profit data.
      </div>
    );
  }

  const revenue = data?.totalRevenue || 0;
  const expenses = data?.totalExpenses || 0;
  const gross = data?.grossProfit ?? 0;
  const tax = data?.taxAmount || 0;
  const taxPct = data?.taxPct || data?.model?.tax_pct || 14;
  const profit = data?.netProfit ?? data?.profit ?? 0;
  const profitPositive = profit >= 0;
  const expenseShare = revenue > 0 ? Math.min(100, Math.round((expenses / revenue) * 100)) : 0;
  const profitShare = revenue > 0 ? Math.max(0, 100 - expenseShare) : 0;
  const model = data?.model || {};
  const breakdown = data?.expenseBreakdown || {};

  const chartData = [
    { name: 'Revenue', amount: revenue },
    { name: 'Expenses', amount: expenses },
    { name: 'Gross', amount: Math.max(0, gross) },
    { name: 'Net', amount: Math.max(0, profit) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="page-header mb-0">
          <h1 className="page-title">Profit</h1>
          <p className="page-subtitle">
            Gross = revenue − expenses · Tax {taxPct}% of gross · Net = gross − tax
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" className="input w-36 text-sm" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          <span className="text-slate-400 text-sm">to</span>
          <input type="date" className="input w-36 text-sm" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          <Link to="/admin/finance" className="btn-secondary text-sm whitespace-nowrap">
            Finance overview
          </Link>
        </div>
      </div>

      <div
        className={`rounded-2xl border p-6 sm:p-8 ${
          profitPositive
            ? 'border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50'
            : 'border-rose-200 bg-gradient-to-br from-rose-50 via-white to-orange-50'
        }`}
      >
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em]">
          {profitPositive ? (
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          ) : (
            <TrendingDown className="w-4 h-4 text-rose-600" />
          )}
          <span className={profitPositive ? 'text-emerald-700/80' : 'text-rose-700/80'}>
            Net Profit
          </span>
        </div>
        <p className={`mt-2 text-4xl sm:text-5xl font-bold tabular-nums ${profitPositive ? 'text-emerald-900' : 'text-rose-900'}`}>
          {currency(profit)}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span>{currency(revenue)} revenue</span>
          <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
          <span>{currency(expenses)} expenses</span>
          <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
          <span>{currency(gross)} gross</span>
          <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
          <span>{currency(tax)} tax</span>
          <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
          <span className="font-semibold">{currency(profit)} net</span>
        </div>
        <div className="mt-6">
          <div className="flex justify-between text-xs text-slate-500 mb-1.5">
            <span>Expenses take {expenseShare}% of revenue</span>
            <span>Left for profit {profitShare}%</span>
          </div>
          <div className="h-3 rounded-full bg-emerald-200 overflow-hidden flex">
            <div className="h-full bg-rose-500 transition-all duration-500" style={{ width: `${expenseShare}%` }} />
            <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${profitShare}%` }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h2 className="font-semibold text-slate-900 mb-1">P&amp;L flow</h2>
          <p className="text-xs text-slate-400 mb-4">Revenue → expenses → gross → tax → net</p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => [currency(v), 'Amount']} />
              <Area type="monotone" dataKey="amount" stroke="#059669" strokeWidth={2} fill="url(#profitGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-slate-900 mb-1">Expense breakdown</h2>
          <p className="text-xs text-slate-400 mb-2">Auto + manual costs</p>
          <Row label="Owner %" value={breakdown.ownerShare} negative hint="Automatic" />
          <Row label="Salaries" value={breakdown.salaries} href="/admin/salaries" negative hint="Automatic" />
          <Row
            label={`Manual agents ${model.manual_agent_pct ?? 1.5}%`}
            value={breakdown.manualAgentCommission}
            href="/admin/commissions"
            negative
            hint="Of company commission"
          />
          <Row
            label={`Website agents ${model.website_agent_pct ?? 1}%`}
            value={breakdown.websiteAgentCommission}
            href="/admin/commissions"
            negative
            hint="Of company commission"
          />
          <Row
            label={`Website's commission ${model.website_maker_pct ?? 0.5}%`}
            value={breakdown.websiteMakerCommission}
            href="/admin/commissions"
            negative
            hint="Of website company commission"
          />
          <Row label="Actual housekeeping" value={breakdown.actualHousekeeping ?? breakdown.housekeeping} href="/admin/housekeeping" negative hint="Manual" />
          <Row label="Actual utilities" value={breakdown.actualUtilities ?? breakdown.utilities} href="/admin/utilities" negative hint="Manual" />
          <Row label="Petty cash" value={breakdown.pettyCash} href="/admin/petty-cash" negative hint="Manual" />
          <Row label="Marketing" value={breakdown.marketing} href="/admin/marketing" negative />
          <Row label="Other expenses" value={breakdown.expenses} href="/admin/expenses" negative />
          <div className="flex items-center justify-between pt-3 mt-1">
            <span className="text-sm font-semibold text-slate-800">Total expenses</span>
            <span className="text-sm font-bold tabular-nums text-rose-700">{currency(expenses)}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">Revenue</p>
          <p className="text-xl font-bold text-slate-900 tabular-nums">{currency(revenue)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">Gross profit</p>
          <p className="text-xl font-bold text-slate-900 tabular-nums">{currency(gross)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">Tax {taxPct}%</p>
          <p className="text-xl font-bold text-amber-800 tabular-nums">{currency(tax)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">Net profit</p>
          <p className={`text-xl font-bold tabular-nums ${profitPositive ? 'text-emerald-800' : 'text-rose-800'}`}>
            {currency(profit)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100"><Sparkles className="w-3 h-3" /> HK collected → revenue</span>
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100"><Zap className="w-3 h-3" /> Utilities collected → revenue</span>
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100"><Users2 className="w-3 h-3" /> Agent % auto</span>
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100"><Wallet className="w-3 h-3" /> Actual costs manual</span>
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100"><Receipt className="w-3 h-3" /> Tax {taxPct}%</span>
      </div>
    </div>
  );
}
