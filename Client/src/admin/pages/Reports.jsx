import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Download,
  Users,
  Home,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  CalendarDays,
  Globe,
  FileBarChart2,
  Trophy,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import SearchableSelect from '../components/ui/SearchableSelect';
import { currency, unitDisplay } from '../utils/formatters';
import { FINANCIAL_EPOCH } from '../utils/financialEpoch';
import { ROLE_LABELS } from '../utils/permissions';

const COLORS = ['#283f5e', '#134e5e', '#F28C28', '#10b981', '#8b5cf6', '#ef4444'];

function SortIcon({ col, sortKey, sortDir }) {
  if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 text-gray-300 inline ml-1" />;
  return sortDir === 'asc' ? (
    <ChevronUp className="w-3 h-3 text-soul-blue inline ml-1" />
  ) : (
    <ChevronDown className="w-3 h-3 text-soul-blue inline ml-1" />
  );
}

function moneyShort(v) {
  return Number(v || 0).toLocaleString('en-EG', { maximumFractionDigits: 0 });
}

function currentMonthIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(ym) {
  const [y, m] = String(ym || '').split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
}

const PODIUM_STYLES = [
  { ring: 'ring-amber-300', bg: 'bg-gradient-to-b from-amber-50 to-white', badge: 'bg-amber-400 text-white', label: '1st' },
  { ring: 'ring-slate-300', bg: 'bg-gradient-to-b from-slate-50 to-white', badge: 'bg-slate-400 text-white', label: '2nd' },
  { ring: 'ring-orange-300', bg: 'bg-gradient-to-b from-orange-50 to-white', badge: 'bg-orange-400 text-white', label: '3rd' },
];

function LeaderboardPodiumCard({ entry, style, tall = false }) {
  if (!entry) {
    return (
      <div className={`rounded-2xl border border-dashed border-soul-line p-4 text-center text-sm text-soul-muted ${tall ? 'min-h-[220px]' : 'min-h-[190px]'}`}>
        —
      </div>
    );
  }
  return (
    <div className={`rounded-2xl border border-soul-line p-4 ring-2 ${style.ring} ${style.bg} ${tall ? 'min-h-[220px]' : 'min-h-[190px]'}`}>
      <div className="flex items-start justify-between gap-2">
        <span className={`inline-flex h-7 min-w-[2rem] items-center justify-center rounded-full px-2 text-xs font-bold ${style.badge}`}>
          {style.label}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-soul-muted">
          {ROLE_LABELS[entry.role] || entry.role}
        </span>
      </div>
      <p className="mt-3 font-display text-lg text-soul-blue leading-tight">{entry.full_name}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-sky-700">Website</div>
          <div className="text-sm font-bold text-sky-800">{entry.website_count}</div>
          <div className="text-[10px] text-sky-700/80">{moneyShort(entry.website_amount)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-soul-blue">Manual</div>
          <div className="text-sm font-bold text-soul-blue">{entry.manual_count}</div>
          <div className="text-[10px] text-soul-muted">{moneyShort(entry.manual_amount)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Total</div>
          <div className="text-sm font-bold text-gray-900">{entry.reservation_count}</div>
          <div className="text-[10px] text-gray-600">{moneyShort(entry.total_amount)}</div>
        </div>
      </div>
    </div>
  );
}

export default function Reports() {
  const [fromDate, setFromDate] = useState(FINANCIAL_EPOCH);
  const [toDate, setToDate] = useState('');
  const [project, setProject] = useState('');
  const [exporting, setExporting] = useState(false);

  const [unitSortKey, setUnitSortKey] = useState('total_gross');
  const [unitSortDir, setUnitSortDir] = useState('desc');
  const [empSortKey, setEmpSortKey] = useState('total_amount');
  const [empSortDir, setEmpSortDir] = useState('desc');
  const [dailySortKey, setDailySortKey] = useState('date');
  const [dailySortDir, setDailySortDir] = useState('desc');
  const [leaderboardMonth, setLeaderboardMonth] = useState(currentMonthIso);

  const rangeParams = {
    from_date: fromDate || undefined,
    to_date: toDate || undefined,
    project: project || undefined,
  };

  const { data: projects = [] } = useQuery({
    queryKey: ['unit-projects'],
    queryFn: () => api.get('/units/projects').then((r) => r.data),
  });

  const { data: revenueData, isLoading: revenueLoading } = useQuery({
    queryKey: ['revenue-report', fromDate, toDate, project],
    queryFn: () =>
      api
        .get('/reports/revenue', {
          params: { ...rangeParams, project: project || undefined },
        })
        .then((r) => r.data),
  });

  const { data: employeeData, isLoading: empLoading } = useQuery({
    queryKey: ['report-by-employee', fromDate, toDate, project],
    queryFn: () =>
      api.get('/reports/by-employee', { params: rangeParams }).then((r) => r.data),
  });

  const { data: unitData, isLoading: unitLoading } = useQuery({
    queryKey: ['report-by-unit', fromDate, toDate, project],
    queryFn: () => api.get('/reports/by-unit', { params: rangeParams }).then((r) => r.data),
  });

  const { data: dailyData, isLoading: dailyLoading } = useQuery({
    queryKey: ['report-daily-reservations', fromDate, toDate, project],
    queryFn: () =>
      api.get('/reports/daily-reservations', { params: rangeParams }).then((r) => r.data),
    refetchInterval: 60_000,
  });

  const { data: leaderboardData, isLoading: leaderboardLoading } = useQuery({
    queryKey: ['report-monthly-leaderboard', leaderboardMonth],
    queryFn: () =>
      api.get('/reports/monthly-leaderboard', { params: { month: leaderboardMonth } }).then((r) => r.data),
  });

  const leaderboard = leaderboardData?.leaderboard || [];
  const leaderboardTotals = leaderboardData?.totals;

  const dailyRows = dailyData?.daily || [];
  const dailyProjects = dailyData?.projects || [];
  const summary = revenueData?.summary;

  const sortedDaily = useMemo(() => {
    return [...dailyRows].sort((a, b) => {
      const av = a[dailySortKey] ?? 0;
      const bv = b[dailySortKey] ?? 0;
      const isNum = !Number.isNaN(parseFloat(av)) && !Number.isNaN(parseFloat(bv));
      const cmp = isNum
        ? parseFloat(av) - parseFloat(bv)
        : String(av).localeCompare(String(bv));
      return dailySortDir === 'asc' ? cmp : -cmp;
    });
  }, [dailyRows, dailySortKey, dailySortDir]);

  const employees = useMemo(() => {
    const rows = [...(employeeData?.employees || [])];
    rows.sort((a, b) => {
      if (empSortKey === 'full_name') {
        const cmp = String(a.full_name || '').localeCompare(String(b.full_name || ''));
        return empSortDir === 'asc' ? cmp : -cmp;
      }
      const av = parseFloat(a[empSortKey] || 0);
      const bv = parseFloat(b[empSortKey] || 0);
      return empSortDir === 'asc' ? av - bv : bv - av;
    });
    return rows;
  }, [employeeData, empSortKey, empSortDir]);

  const units = useMemo(() => {
    const rows = [...(unitData?.units || [])];
    rows.sort((a, b) => {
      if (typeof a[unitSortKey] === 'string' || typeof b[unitSortKey] === 'string') {
        const cmp = String(a[unitSortKey] || '').localeCompare(String(b[unitSortKey] || ''));
        return unitSortDir === 'asc' ? cmp : -cmp;
      }
      const an = parseFloat(a[unitSortKey] || 0);
      const bn = parseFloat(b[unitSortKey] || 0);
      return unitSortDir === 'asc' ? an - bn : bn - an;
    });
    return rows;
  }, [unitData, unitSortKey, unitSortDir]);

  const projectChartData = useMemo(() => {
    const map = {};
    for (const r of revenueData?.reservations || []) {
      const name = r.project || 'Unassigned';
      map[name] = (map[name] || 0) + (parseFloat(r.total_amount) || 0);
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [revenueData]);

  const channelChartData = useMemo(() => {
    const map = {};
    for (const r of revenueData?.reservations || []) {
      const name = r.booking_channel_label || 'Manual';
      map[name] = (map[name] || 0) + (parseFloat(r.total_amount) || 0);
    }
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [revenueData]);

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

  async function exportExcel() {
    try {
      setExporting(true);
      const res = await api.get('/reports/export/reservations/excel', {
        params: rangeParams,
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `soul-reservations-${fromDate || 'all'}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  function handleDailySort(key) {
    if (dailySortKey === key) setDailySortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setDailySortKey(key);
      setDailySortDir('desc');
    }
  }
  function handleUnitSort(key) {
    if (unitSortKey === key) setUnitSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setUnitSortKey(key);
      setUnitSortDir('desc');
    }
  }
  function handleEmpSort(key) {
    if (empSortKey === key) setEmpSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setEmpSortKey(key);
      setEmpSortDir('desc');
    }
  }

  const thClass = (key, activeKey) =>
    `cursor-pointer select-none hover:bg-gray-100 transition-colors ${
      activeKey === key ? 'text-soul-blue' : ''
    }`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="page-header mb-0">
          <h1 className="page-title flex items-center gap-2">
            <FileBarChart2 className="w-7 h-7 text-soul-blue" />
            Reports
          </h1>
          <p className="page-subtitle">
            Admin analytics — reservation totals by check-in date. Books from {FINANCIAL_EPOCH}.
          </p>
        </div>
        <button
          type="button"
          onClick={exportExcel}
          disabled={exporting}
          className="btn-secondary"
        >
          <Download className="w-4 h-4" />
          {exporting ? 'Exporting…' : 'Export Excel'}
        </button>
      </div>

      <div className="card p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">Check-in from</label>
          <input
            type="date"
            className="input w-40"
            min={FINANCIAL_EPOCH}
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Check-in to</label>
          <input
            type="date"
            className="input w-40"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Project</label>
          <SearchableSelect
            className="w-48"
            value={project}
            onChange={setProject}
            placeholder="All Projects"
            options={[
              { value: '', label: 'All Projects' },
              ...projects.map((p) => ({ value: p, label: p })),
            ]}
          />
        </div>
        {(fromDate !== FINANCIAL_EPOCH || toDate || project) && (
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => {
              setFromDate(FINANCIAL_EPOCH);
              setToDate('');
              setProject('');
            }}
          >
            Reset
          </button>
        )}
      </div>

      {revenueLoading ? (
        <LoadingSpinner />
      ) : summary ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="card p-4 border-l-4 border-soul-blue">
              <div className="text-xs text-gray-500 font-medium uppercase tracking-wider">
                Total revenue
              </div>
              <div className="text-2xl font-bold text-gray-900 mt-1">
                {currency(summary.totalRevenue)}
              </div>
            </div>
            <div className="card p-4 border-l-4 border-emerald-500">
              <div className="text-xs text-gray-500 font-medium uppercase tracking-wider">
                Collected
              </div>
              <div className="text-2xl font-bold text-emerald-700 mt-1">
                {currency(summary.totalPaid)}
              </div>
            </div>
            <div className="card p-4 border-l-4 border-amber-500">
              <div className="text-xs text-gray-500 font-medium uppercase tracking-wider">
                Outstanding
              </div>
              <div className="text-2xl font-bold text-amber-700 mt-1">
                {currency(summary.totalPending)}
              </div>
            </div>
            <div className="card p-4 border-l-4 border-violet-500">
              <div className="text-xs text-gray-500 font-medium uppercase tracking-wider">
                Reservations
              </div>
              <div className="text-2xl font-bold text-gray-900 mt-1">{summary.count}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-4 flex gap-3 items-start">
              <div className="rounded-xl bg-sky-50 p-2.5 text-sky-700">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-gray-500 font-medium">
                  Website channel
                </div>
                <div className="text-lg font-bold text-gray-900 mt-0.5">
                  {currency(summary.website_revenue)}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {summary.website_count} confirmed stay
                  {summary.website_count === 1 ? '' : 's'}
                </div>
              </div>
            </div>
            <div className="card p-4 flex gap-3 items-start">
              <div className="rounded-xl bg-soul-blue-50 p-2.5 text-soul-blue">
                <CalendarDays className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-gray-500 font-medium">
                  Manual channel
                </div>
                <div className="text-lg font-bold text-gray-900 mt-0.5">
                  {currency(summary.manual_revenue)}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {summary.manual_count} reservation
                  {summary.manual_count === 1 ? '' : 's'}
                </div>
              </div>
            </div>
            <div className="card p-4 flex gap-3 items-start border border-amber-100 bg-amber-50/40">
              <div className="rounded-xl bg-amber-100 p-2.5 text-amber-800">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-amber-800/80 font-medium">
                  Open website requests
                </div>
                <div className="text-lg font-bold text-amber-900 mt-0.5">
                  {summary.pending_website_requests}
                </div>
                <div className="text-xs text-amber-800/70 mt-0.5">
                  {currency(summary.pending_website_requests_value)} awaiting accept/reject
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {projectChartData.length > 0 && (
              <div className="card">
                <h3 className="font-semibold text-gray-900 mb-4">Revenue by project</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={projectChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip formatter={(v) => currency(v)} />
                    <Bar dataKey="value" fill="#283f5e" name="Revenue" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {channelChartData.length > 0 && (
              <div className="card">
                <h3 className="font-semibold text-gray-900 mb-4">Revenue by channel</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={channelChartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={85}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {channelChartData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => currency(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      ) : null}

      {/* Monthly reservations team leaderboard */}
      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-500" />
            <div>
              <h3 className="font-semibold text-gray-900">Monthly reservations leaderboard</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Website + manual reservations team · ranked by bookings created in{' '}
                {monthLabel(leaderboardMonth)} (Cairo time)
              </p>
            </div>
          </div>
          <div>
            <label className="label sr-only">Month</label>
            <input
              type="month"
              className="input w-44"
              min={FINANCIAL_EPOCH.slice(0, 7)}
              value={leaderboardMonth}
              onChange={(e) => setLeaderboardMonth(e.target.value)}
            />
          </div>
        </div>

        {leaderboardLoading ? (
          <div className="p-6">
            <LoadingSpinner />
          </div>
        ) : leaderboard.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            No reservations team bookings recorded for {monthLabel(leaderboardMonth)} yet.
          </div>
        ) : (
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <LeaderboardPodiumCard entry={leaderboard[1]} style={PODIUM_STYLES[1]} />
              <LeaderboardPodiumCard entry={leaderboard[0]} style={PODIUM_STYLES[0]} tall />
              <LeaderboardPodiumCard entry={leaderboard[2]} style={PODIUM_STYLES[2]} />
            </div>

            <div className="overflow-x-auto">
              <table className="table text-sm">
                <thead>
                  <tr>
                    <th className="w-12">#</th>
                    <th>Agent</th>
                    <th>Role</th>
                    <th className="text-center">Website</th>
                    <th className="text-center">Manual</th>
                    <th className="text-center">Total bookings</th>
                    <th className="text-right">Total amount</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry) => (
                    <tr key={entry.id} className={entry.rank <= 3 ? 'bg-amber-50/40' : ''}>
                      <td className="font-semibold text-gray-500">{entry.rank}</td>
                      <td className="font-medium text-gray-900">{entry.full_name}</td>
                      <td className="text-gray-500">{ROLE_LABELS[entry.role] || entry.role}</td>
                      <td className="text-center">
                        <div className="font-semibold text-sky-700">{entry.website_count}</div>
                        <div className="text-[11px] text-sky-700/80">{currency(entry.website_amount)}</div>
                      </td>
                      <td className="text-center">
                        <div className="font-semibold text-soul-blue">{entry.manual_count}</div>
                        <div className="text-[11px] text-soul-muted">{currency(entry.manual_amount)}</div>
                      </td>
                      <td className="text-center font-bold text-gray-900">{entry.reservation_count}</td>
                      <td className="text-right tabular-nums font-semibold">{currency(entry.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
                {leaderboardTotals && (
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                      <td colSpan={3} className="text-right text-gray-600 pr-4">
                        Team totals
                      </td>
                      <td className="text-center text-sky-700">
                        <div>{leaderboardTotals.website_count}</div>
                        <div className="text-[11px] font-medium">{currency(leaderboardTotals.website_amount)}</div>
                      </td>
                      <td className="text-center">
                        <div>{leaderboardTotals.manual_count}</div>
                        <div className="text-[11px] font-medium">{currency(leaderboardTotals.manual_amount)}</div>
                      </td>
                      <td className="text-center">{leaderboardTotals.reservation_count}</td>
                      <td className="text-right tabular-nums">{currency(leaderboardTotals.total_amount)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Daily pivot */}
      <div className="card p-0">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-soul-blue" />
            <h3 className="font-semibold text-gray-900">Daily reservations</h3>
            <span className="text-xs text-gray-400">
              — by check-in date and project
            </span>
          </div>
          <span className="text-xs text-gray-400">{dailyRows.length} days</span>
        </div>
        {dailyLoading ? (
          <div className="p-6">
            <LoadingSpinner />
          </div>
        ) : dailyRows.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">No data yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th onClick={() => handleDailySort('date')} className={thClass('date', dailySortKey)}>
                    Date <SortIcon col="date" sortKey={dailySortKey} sortDir={dailySortDir} />
                  </th>
                  <th
                    onClick={() => handleDailySort('total')}
                    className={`text-center ${thClass('total', dailySortKey)}`}
                  >
                    Total <SortIcon col="total" sortKey={dailySortKey} sortDir={dailySortDir} />
                  </th>
                  <th className="text-center">Website</th>
                  {dailyProjects.map((proj) => (
                    <th
                      key={proj}
                      onClick={() => handleDailySort(proj)}
                      className={`text-center whitespace-nowrap ${thClass(proj, dailySortKey)}`}
                    >
                      {proj} <SortIcon col={proj} sortKey={dailySortKey} sortDir={dailySortDir} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedDaily.map((row) => {
                  const isToday = row.date === today;
                  return (
                    <tr key={row.date} className={isToday ? 'bg-soul-blue-50 font-semibold' : ''}>
                      <td className="whitespace-nowrap">
                        <span className={isToday ? 'text-soul-blue font-bold' : 'text-gray-700'}>
                          {row.date}
                        </span>
                        {isToday ? (
                          <span className="ml-2 inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-soul-blue text-white">
                            Today
                          </span>
                        ) : null}
                      </td>
                      <td className="text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <span
                            className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                              row.total > 0 ? 'bg-soul-blue-50 text-soul-blue' : 'text-gray-300'
                            }`}
                          >
                            {row.total}
                          </span>
                          {row.total_amount > 0 ? (
                            <span className="text-xs text-soul-blue font-medium">
                              {moneyShort(row.total_amount)}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="text-center">
                        {row.website_total > 0 ? (
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold bg-sky-100 text-sky-800">
                            {row.website_total}
                          </span>
                        ) : (
                          <span className="text-gray-200">—</span>
                        )}
                      </td>
                      {dailyProjects.map((proj) => (
                        <td key={proj} className="text-center">
                          {row[proj] > 0 ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                                {row[proj]}
                              </span>
                              {row[`${proj}_amount`] > 0 ? (
                                <span className="text-xs text-emerald-600 font-medium">
                                  {moneyShort(row[`${proj}_amount`])}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-gray-200">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  <td className="text-gray-600">All days</td>
                  <td className="text-center text-soul-blue">
                    <div className="flex flex-col items-center gap-0.5">
                      <span>{dailyRows.reduce((s, r) => s + r.total, 0)}</span>
                      <span className="text-xs font-medium text-soul-blue/70">
                        {moneyShort(dailyRows.reduce((s, r) => s + (r.total_amount || 0), 0))}
                      </span>
                    </div>
                  </td>
                  <td className="text-center text-sky-800">
                    {dailyRows.reduce((s, r) => s + (r.website_total || 0), 0)}
                  </td>
                  {dailyProjects.map((proj) => (
                    <td key={proj} className="text-center text-gray-700">
                      <div className="flex flex-col items-center gap-0.5">
                        <span>{dailyRows.reduce((s, r) => s + (r[proj] || 0), 0)}</span>
                        <span className="text-xs font-medium text-gray-500">
                          {moneyShort(
                            dailyRows.reduce((s, r) => s + (r[`${proj}_amount`] || 0), 0)
                          )}
                        </span>
                      </div>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* By employee */}
      <div className="card p-0">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <Users className="w-5 h-5 text-soul-blue" />
          <h3 className="font-semibold text-gray-900">Reservations by agent</h3>
        </div>
        {empLoading ? (
          <div className="p-6">
            <LoadingSpinner />
          </div>
        ) : employees.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">No data for selected period</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>#</th>
                  <th onClick={() => handleEmpSort('full_name')} className={thClass('full_name', empSortKey)}>
                    Agent <SortIcon col="full_name" sortKey={empSortKey} sortDir={empSortDir} />
                  </th>
                  <th>Role</th>
                  <th
                    onClick={() => handleEmpSort('reservation_count')}
                    className={`text-center ${thClass('reservation_count', empSortKey)}`}
                  >
                    Total <SortIcon col="reservation_count" sortKey={empSortKey} sortDir={empSortDir} />
                  </th>
                  <th
                    onClick={() => handleEmpSort('website_count')}
                    className={`text-center ${thClass('website_count', empSortKey)}`}
                  >
                    Website <SortIcon col="website_count" sortKey={empSortKey} sortDir={empSortDir} />
                  </th>
                  <th
                    onClick={() => handleEmpSort('manual_count')}
                    className={`text-center ${thClass('manual_count', empSortKey)}`}
                  >
                    Manual <SortIcon col="manual_count" sortKey={empSortKey} sortDir={empSortDir} />
                  </th>
                  <th
                    onClick={() => handleEmpSort('total_amount')}
                    className={`text-right ${thClass('total_amount', empSortKey)}`}
                  >
                    Amount <SortIcon col="total_amount" sortKey={empSortKey} sortDir={empSortDir} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e, idx) => (
                  <tr key={e.id}>
                    <td className="text-gray-400">{idx + 1}</td>
                    <td className="font-medium text-gray-900">{e.full_name}</td>
                    <td className="text-gray-500 capitalize">{e.role?.replace(/_/g, ' ')}</td>
                    <td className="text-center font-semibold text-soul-blue">{e.reservation_count}</td>
                    <td className="text-center text-sky-700">{e.website_count || 0}</td>
                    <td className="text-center text-gray-600">{e.manual_count || 0}</td>
                    <td className="text-right tabular-nums font-semibold">
                      {currency(e.total_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  <td colSpan={3} className="text-right text-gray-600 pr-4">
                    Totals
                  </td>
                  <td className="text-center text-soul-blue">
                    {employees.reduce((s, e) => s + e.reservation_count, 0)}
                  </td>
                  <td className="text-center text-sky-700">
                    {employees.reduce((s, e) => s + (e.website_count || 0), 0)}
                  </td>
                  <td className="text-center">
                    {employees.reduce((s, e) => s + (e.manual_count || 0), 0)}
                  </td>
                  <td className="text-right tabular-nums">
                    {currency(employees.reduce((s, e) => s + parseFloat(e.total_amount || 0), 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* By unit */}
      <div className="card p-0">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <Home className="w-5 h-5 text-soul-blue" />
          <h3 className="font-semibold text-gray-900">Revenue by unit</h3>
        </div>
        {unitLoading ? (
          <div className="p-6">
            <LoadingSpinner />
          </div>
        ) : units.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">No data for selected period</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>#</th>
                  <th onClick={() => handleUnitSort('unit_name')} className={thClass('unit_name', unitSortKey)}>
                    Unit <SortIcon col="unit_name" sortKey={unitSortKey} sortDir={unitSortDir} />
                  </th>
                  <th onClick={() => handleUnitSort('project')} className={thClass('project', unitSortKey)}>
                    Project <SortIcon col="project" sortKey={unitSortKey} sortDir={unitSortDir} />
                  </th>
                  <th
                    onClick={() => handleUnitSort('reservation_count')}
                    className={`text-center ${thClass('reservation_count', unitSortKey)}`}
                  >
                    Res. <SortIcon col="reservation_count" sortKey={unitSortKey} sortDir={unitSortDir} />
                  </th>
                  <th
                    onClick={() => handleUnitSort('website_count')}
                    className={`text-center ${thClass('website_count', unitSortKey)}`}
                  >
                    Web <SortIcon col="website_count" sortKey={unitSortKey} sortDir={unitSortDir} />
                  </th>
                  <th
                    onClick={() => handleUnitSort('total_nights')}
                    className={`text-center ${thClass('total_nights', unitSortKey)}`}
                  >
                    Nights <SortIcon col="total_nights" sortKey={unitSortKey} sortDir={unitSortDir} />
                  </th>
                  <th
                    onClick={() => handleUnitSort('total_gross')}
                    className={`text-right ${thClass('total_gross', unitSortKey)}`}
                  >
                    Gross <SortIcon col="total_gross" sortKey={unitSortKey} sortDir={unitSortDir} />
                  </th>
                  <th
                    onClick={() => handleUnitSort('total_utilities')}
                    className={`text-right ${thClass('total_utilities', unitSortKey)}`}
                  >
                    Utilities <SortIcon col="total_utilities" sortKey={unitSortKey} sortDir={unitSortDir} />
                  </th>
                  <th
                    onClick={() => handleUnitSort('total_company_commission')}
                    className={`text-right ${thClass('total_company_commission', unitSortKey)}`}
                  >
                    Company comm. <SortIcon col="total_company_commission" sortKey={unitSortKey} sortDir={unitSortDir} />
                  </th>
                  <th
                    onClick={() => handleUnitSort('total_owner_net')}
                    className={`text-right ${thClass('total_owner_net', unitSortKey)}`}
                  >
                    Owner net <SortIcon col="total_owner_net" sortKey={unitSortKey} sortDir={unitSortDir} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {units.map((u, idx) => (
                  <tr key={u.unit_id}>
                    <td className="text-gray-400">{idx + 1}</td>
                    <td className="font-medium text-gray-900">{unitDisplay(u)}</td>
                    <td className="text-gray-500">{u.project || '—'}</td>
                    <td className="text-center text-gray-600">{u.reservation_count}</td>
                    <td className="text-center text-sky-700">{u.website_count || 0}</td>
                    <td className="text-center font-semibold text-gray-700">{u.total_nights}</td>
                    <td className="text-right tabular-nums font-semibold">{currency(u.total_gross)}</td>
                    <td className="text-right tabular-nums text-emerald-700">
                      {u.total_utilities > 0 ? currency(u.total_utilities) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="text-right tabular-nums text-amber-700 font-semibold">
                      {u.total_company_commission > 0 ? currency(u.total_company_commission) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="text-right tabular-nums text-soul-blue font-semibold">
                      {currency(u.total_owner_net)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  <td colSpan={5} className="text-right text-gray-600 pr-4">
                    Totals
                  </td>
                  <td className="text-center">{units.reduce((s, u) => s + u.total_nights, 0)}</td>
                  <td className="text-right tabular-nums">
                    {currency(units.reduce((s, u) => s + u.total_gross, 0))}
                  </td>
                  <td className="text-right tabular-nums text-emerald-700">
                    {currency(units.reduce((s, u) => s + u.total_utilities, 0))}
                  </td>
                  <td className="text-right tabular-nums text-amber-700">
                    {currency(units.reduce((s, u) => s + u.total_company_commission, 0))}
                  </td>
                  <td className="text-right tabular-nums text-soul-blue">
                    {currency(units.reduce((s, u) => s + u.total_owner_net, 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
