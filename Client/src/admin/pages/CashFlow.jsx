import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePermissions } from '../hooks/usePermissions';
import { useSortableTable } from '../hooks/useSortableTable';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import {
  TrendingUp, TrendingDown, DollarSign, AlertCircle,
  Download, Filter, ArrowUpCircle, ArrowDownCircle,
} from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SortTh from '../components/ui/SortTh';
import { currency, formatDate } from '../utils/formatters';
import { FINANCIAL_EPOCH } from '../utils/financialEpoch';
import * as XLSX from 'xlsx';
import SearchableSelect from '../components/ui/SearchableSelect';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const normDate = d => String(d).split('T')[0];

/** Format x-axis labels nicely per period mode */
function fmtXAxis(dateStr, period) {
  if (!dateStr) return '';
  if (period === 'monthly') {
    const [y, m] = dateStr.split('-');
    return new Date(+y, +m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
  }
  if (period === 'weekly') {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }
  // daily
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/** Aggregate daily chart data into weekly or monthly buckets */
function aggregateChart(dailyData, period) {
  if (period === 'daily') return dailyData;

  const buckets = {};
  dailyData.forEach(d => {
    let key;
    const dt = new Date(d.date + 'T00:00:00');
    if (period === 'weekly') {
      const day  = dt.getDay();
      const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
      const mon  = new Date(dt.getFullYear(), dt.getMonth(), diff);
      key = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;
    } else {
      key = d.date.substring(0, 7); // YYYY-MM
    }
    if (!buckets[key]) buckets[key] = { date: key, inflow: 0, outflow: 0 };
    buckets[key].inflow  += d.inflow;
    buckets[key].outflow += d.outflow;
  });

  let running = 0;
  return Object.values(buckets).map(d => {
    running += d.inflow - d.outflow;
    return {
      date:    d.date,
      inflow:  parseFloat(d.inflow.toFixed(2)),
      outflow: parseFloat(d.outflow.toFixed(2)),
      net:     parseFloat((d.inflow - d.outflow).toFixed(2)),
      balance: parseFloat(running.toFixed(2)),
    };
  });
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, period }) {
  if (!active || !payload?.length) return null;
  const inflowEntry  = payload.find(p => p.dataKey === 'inflow');
  const outflowEntry = payload.find(p => p.dataKey === 'outflow');
  const balanceEntry = payload.find(p => p.dataKey === 'balance');

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-xl p-3 text-sm min-w-[200px]">
      <p className="font-semibold text-gray-700 mb-2">{fmtXAxis(label, period)}</p>
      {inflowEntry && (
        <div className="flex justify-between gap-4 text-emerald-600">
          <span>Inflow</span>
          <span className="font-semibold">{currency(inflowEntry.value)}</span>
        </div>
      )}
      {outflowEntry && (
        <div className="flex justify-between gap-4 text-red-500">
          <span>Outflow</span>
          <span className="font-semibold">{currency(outflowEntry.value)}</span>
        </div>
      )}
      {balanceEntry && (
        <div className={`flex justify-between gap-4 mt-1 pt-1 border-t border-gray-100 font-bold ${balanceEntry.value >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
          <span>Balance</span>
          <span>{currency(balanceEntry.value)}</span>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CashFlow() {
  const { isAdmin } = usePermissions();
  // ── Filters
  const today     = new Date();
  const thirtyAgo = new Date(today);
  thirtyAgo.setDate(today.getDate() - 30);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const [fromDate,  setFromDate]  = useState(
    fmt(thirtyAgo) < FINANCIAL_EPOCH ? FINANCIAL_EPOCH : fmt(thirtyAgo)
  );
  const [toDate,    setToDate]    = useState(fmt(today));
  const [unitId,    setUnitId]    = useState('');
  const [flowType,  setFlowType]  = useState('');   // '' | 'inflow' | 'outflow'
  const [period,    setPeriod]    = useState('daily'); // 'daily' | 'weekly' | 'monthly'
  const [showPetty, setShowPetty] = useState(false);

  // ── Data fetch
  const { data, isLoading, isError } = useQuery({
    queryKey: ['cashflow', fromDate, toDate, unitId, flowType],
    queryFn: () => api.get('/cashflow', {
      params: {
        from_date: fromDate || undefined,
        to_date:   toDate   || undefined,
        unit_id:   unitId   || undefined,
        flow_type: flowType || undefined,
      },
    }).then(r => r.data),
    staleTime: 30_000,
  });

  const { data: units = [] } = useQuery({
    queryKey: ['units'],
    queryFn: () => api.get('/units').then(r => r.data),
  });

  const summary      = data?.summary      || {};
  const rawChart     = data?.chart        || [];
  const transactions = data?.transactions || [];
  const byUnit       = data?.by_unit      || [];

  // Aggregate chart for selected period
  const chartData = useMemo(() => aggregateChart(rawChart, period), [rawChart, period]);

  const { sorted: sortedByUnit, sortKey: sortKeyUnit, sortDir: sortDirUnit, handleSort: handleSortUnit } = useSortableTable(byUnit, 'unit', 'asc');
  const { sorted: sortedTxns, sortKey: sortKeyTxn, sortDir: sortDirTxn, handleSort: handleSortTxn } = useSortableTable(transactions, 'date', 'desc');

  // ── Export Excel
  const exportExcel = () => {
    if (!transactions.length) return;
    const rows = transactions.map(t => ({
      Date:           normDate(t.date),
      Type:           t.flow_type === 'inflow' ? 'Inflow' : 'Outflow',
      Source:         t.source,
      Unit:           t.unit_name || '—',
      Project:        t.project   || '—',
      Guest:          t.guest_name || '—',
      Description:    t.description || '—',
      Method:         t.payment_method || '—',
      Amount:         parseFloat(t.amount),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Cash Flow');
    XLSX.writeFile(wb, `CashFlow_${fromDate}_to_${toDate}.xlsx`);
  };

  // ── Summary card config
  const netPositive = (summary.net || 0) >= 0;
  const summaryCards = [
    {
      label:   'Total Inflow',
      value:   summary.inflow   || 0,
      icon:    ArrowUpCircle,
      bg:      'bg-emerald-50',
      border:  'border-emerald-200',
      iconBg:  'bg-emerald-100',
      iconClr: 'text-emerald-600',
      valClr:  'text-emerald-700',
      lblClr:  'text-emerald-600',
    },
    {
      label:   'Total Outflow',
      value:   summary.outflow  || 0,
      icon:    ArrowDownCircle,
      bg:      'bg-red-50',
      border:  'border-red-200',
      iconBg:  'bg-red-100',
      iconClr: 'text-red-500',
      valClr:  'text-red-600',
      lblClr:  'text-red-500',
    },
    {
      label:   'Net Cash Flow',
      value:   summary.net      || 0,
      icon:    netPositive ? TrendingUp : TrendingDown,
      bg:      netPositive ? 'bg-blue-50'   : 'bg-orange-50',
      border:  netPositive ? 'border-blue-200' : 'border-orange-200',
      iconBg:  netPositive ? 'bg-blue-100'  : 'bg-orange-100',
      iconClr: netPositive ? 'text-blue-600' : 'text-orange-600',
      valClr:  netPositive ? 'text-blue-700' : 'text-orange-700',
      lblClr:  netPositive ? 'text-blue-600' : 'text-orange-600',
    },
    {
      label:   'Pending Petty Cash',
      value:   summary.pending_petty_cash || 0,
      icon:    AlertCircle,
      bg:      'bg-amber-50',
      border:  'border-amber-200',
      iconBg:  'bg-amber-100',
      iconClr: 'text-amber-500',
      valClr:  'text-amber-700',
      lblClr:  'text-amber-600',
    },
  ];

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="page-header mb-0">
          <h1 className="page-title flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary-600" />
            Cash Flow Dashboard
          </h1>
          <p className="page-subtitle">Real-time view of all company inflows and outflows</p>
        </div>
        {(isAdmin) && (
          <button onClick={exportExcel} className="btn-secondary">
            <Download className="w-4 h-4" />Export Excel
          </button>
        )}
      </div>

      {/* ── Filters ── */}
      <div className="card p-3 flex flex-wrap items-end gap-3">
        <Filter className="w-4 h-4 text-gray-400 self-center" />
        <div>
          <label className="label text-xs">From</label>
          <input type="date" className="input w-38" value={fromDate}
            onChange={e => setFromDate(e.target.value)} />
        </div>
        <div>
          <label className="label text-xs">To</label>
          <input type="date" className="input w-38" value={toDate}
            onChange={e => setToDate(e.target.value)} />
        </div>
        <div>
          <label className="label text-xs">Unit</label>
          <SearchableSelect className="w-48" value={unitId} onChange={setUnitId}
            placeholder="All Units"
            options={[{ value: '', label: 'All Units' }, ...units.map(u => ({ value: String(u.id), label: `${u.name} — ${u.project}` }))]}
          />
        </div>
        <div>
          <label className="label text-xs">Type</label>
          <SearchableSelect className="w-36" value={flowType} onChange={setFlowType}
            placeholder="All Flows"
            options={[{ value: '', label: 'All Flows' }, { value: 'inflow', label: 'Inflow Only' }, { value: 'outflow', label: 'Outflow Only' }]}
          />
        </div>
        {(fromDate || toDate || unitId || flowType) && (
          <button className="btn-secondary text-sm self-end"
            onClick={() => { setFromDate(fmt(thirtyAgo)); setToDate(fmt(today)); setUnitId(''); setFlowType(''); }}>
            Reset
          </button>
        )}
      </div>

      {isLoading ? <LoadingSpinner /> : isError ? (
        <div className="card p-8 text-center text-red-500">Failed to load cash flow data. Please try again.</div>
      ) : (
        <>
          {/* ── Summary Cards ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {summaryCards.map(({ label, value, icon: Icon, bg, border, iconBg, iconClr, valClr, lblClr }) => (
              <div key={label} className={`card p-5 ${bg} ${border}`}>
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0`}>
                    <Icon className={`w-5 h-5 ${iconClr}`} />
                  </div>
                  <p className={`text-sm font-medium ${lblClr}`}>{label}</p>
                </div>
                <p className={`text-2xl font-bold tabular-nums ${valClr}`}>{currency(value)}</p>
                {label === 'Pending Petty Cash' && value > 0 && (
                  <p className="text-xs text-amber-500 mt-1">Not yet moved to expenses</p>
                )}
              </div>
            ))}
          </div>

          {/* ── Chart ── */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <h2 className="text-base font-semibold text-gray-800">Cash Flow Over Time</h2>
              {/* Period toggle */}
              <div className="flex bg-gray-100 rounded-lg p-1">
                {['daily', 'weekly', 'monthly'].map(p => (
                  <button key={p} onClick={() => setPeriod(p)}
                    className={`px-3 py-1.5 rounded text-xs font-medium capitalize transition-colors ${period === p ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {chartData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
                No data for selected range
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={d => fmtXAxis(d, period)}
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    tickLine={false}
                    axisLine={{ stroke: '#e5e7eb' }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tickFormatter={v => `${(v / 1000).toFixed(0)}k`}
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    tickLine={false}
                    axisLine={false}
                    width={52}
                  />
                  <Tooltip content={<ChartTooltip period={period} />} />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    formatter={(value) => ({
                      inflow:  <span className="text-emerald-600 text-xs font-medium">Inflow</span>,
                      outflow: <span className="text-red-500 text-xs font-medium">Outflow</span>,
                      balance: <span className="text-blue-600 text-xs font-medium">Running Balance</span>,
                    }[value] || value)}
                  />
                  <ReferenceLine y={0} stroke="#e5e7eb" />
                  <Bar dataKey="inflow"  name="inflow"  fill="#10b981" radius={[3,3,0,0]} maxBarSize={40} opacity={0.85} />
                  <Bar dataKey="outflow" name="outflow" fill="#ef4444" radius={[3,3,0,0]} maxBarSize={40} opacity={0.85} />
                  <Line
                    type="monotone"
                    dataKey="balance"
                    name="balance"
                    stroke="#3b82f6"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4, fill: '#3b82f6' }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* ── Two-column: Unit Breakdown + Quick Stats ── */}
          {byUnit.length > 0 && (
            <div className="card p-0 overflow-x-auto">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-800">Breakdown by Unit</h2>
              </div>
              <table className="table text-sm">
                <thead>
                  <tr>
                    <SortTh col="unit" sortKey={sortKeyUnit} sortDir={sortDirUnit} onSort={handleSortUnit}>Unit</SortTh>
                    <SortTh col="project" sortKey={sortKeyUnit} sortDir={sortDirUnit} onSort={handleSortUnit}>Project</SortTh>
                    <SortTh col="inflow" sortKey={sortKeyUnit} sortDir={sortDirUnit} onSort={handleSortUnit} className="text-right text-emerald-600">Inflow</SortTh>
                    <SortTh col="outflow" sortKey={sortKeyUnit} sortDir={sortDirUnit} onSort={handleSortUnit} className="text-right text-red-500">Outflow</SortTh>
                    <SortTh col="net" sortKey={sortKeyUnit} sortDir={sortDirUnit} onSort={handleSortUnit} className="text-right">Net</SortTh>
                  </tr>
                </thead>
                <tbody>
                  {sortedByUnit.map((u, i) => (
                    <tr key={i}>
                      <td className="font-medium text-gray-900">{u.unit}</td>
                      <td className="text-gray-500 text-xs">{u.project || '—'}</td>
                      <td className="text-right tabular-nums text-emerald-700">{currency(u.inflow)}</td>
                      <td className="text-right tabular-nums text-red-600">{currency(u.outflow)}</td>
                      <td className={`text-right tabular-nums font-semibold ${u.net >= 0 ? 'text-blue-700' : 'text-orange-600'}`}>
                        {currency(u.net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Transactions Table ── */}
          <div className="card p-0">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-800">
                Transactions
                <span className="ml-2 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-normal">
                  {transactions.length}
                </span>
              </h2>
            </div>

            {transactions.length === 0 ? (
              <EmptyState
                icon={DollarSign}
                title="No transactions"
                subtitle="No cash movements match the selected filters"
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="table text-sm">
                  <thead>
                    <tr>
                      <SortTh col="date" sortKey={sortKeyTxn} sortDir={sortDirTxn} onSort={handleSortTxn}>Date</SortTh>
                      <SortTh col="flow_type" sortKey={sortKeyTxn} sortDir={sortDirTxn} onSort={handleSortTxn} className="text-center">Type</SortTh>
                      <SortTh col="source" sortKey={sortKeyTxn} sortDir={sortDirTxn} onSort={handleSortTxn}>Source</SortTh>
                      <SortTh col="unit_name" sortKey={sortKeyTxn} sortDir={sortDirTxn} onSort={handleSortTxn}>Unit</SortTh>
                      <SortTh col="description" sortKey={sortKeyTxn} sortDir={sortDirTxn} onSort={handleSortTxn}>Description</SortTh>
                      <SortTh col="payment_method" sortKey={sortKeyTxn} sortDir={sortDirTxn} onSort={handleSortTxn}>Method</SortTh>
                      <SortTh col="amount" sortKey={sortKeyTxn} sortDir={sortDirTxn} onSort={handleSortTxn} className="text-right">Amount</SortTh>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTxns.map((t, i) => {
                      const isIn = t.flow_type === 'inflow';
                      return (
                        <tr key={i}>
                          <td className="whitespace-nowrap text-gray-500 text-xs">
                            {formatDate(t.date)}
                          </td>
                          <td className="text-center">
                            {isIn ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                                <ArrowUpCircle className="w-3 h-3" />IN
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">
                                <ArrowDownCircle className="w-3 h-3" />OUT
                              </span>
                            )}
                          </td>
                          <td>
                            <span className="text-xs px-2 py-0.5 rounded-md bg-gray-100 text-gray-600">
                              {t.source}
                            </span>
                          </td>
                          <td>
                            <div className="text-gray-800 font-medium">{t.unit_name || '—'}</div>
                            {t.project && <div className="text-xs text-gray-400">{t.project}</div>}
                          </td>
                          <td>
                            <div className="max-w-[200px] truncate text-gray-700">
                              {t.guest_name && t.description !== t.guest_name
                                ? <><span className="font-medium">{t.guest_name}</span> · <span className="text-gray-400">{t.description}</span></>
                                : t.description || t.guest_name || '—'
                              }
                            </div>
                          </td>
                          <td>
                            {t.payment_method ? (
                              <span className="text-xs capitalize text-gray-500">
                                {t.payment_method.replace(/_/g, ' ')}
                              </span>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className={`text-right tabular-nums font-semibold ${isIn ? 'text-emerald-700' : 'text-red-600'}`}>
                            {isIn ? '+' : '-'}{currency(t.amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                      <td colSpan={6} className="text-right text-gray-600 pr-4">Net</td>
                      <td className={`text-right tabular-nums text-base ${netPositive ? 'text-emerald-700' : 'text-red-600'}`}>
                        {currency(summary.net || 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
