import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Users, Home, ChevronUp, ChevronDown, ChevronsUpDown, CalendarDays } from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { currency } from '../utils/formatters';
import SearchableSelect from '../components/ui/SearchableSelect';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899'];

function SortIcon({ col, sortKey, sortDir }) {
  if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 text-gray-300 inline ml-1" />;
  return sortDir === 'asc'
    ? <ChevronUp   className="w-3 h-3 text-primary-600 inline ml-1" />
    : <ChevronDown className="w-3 h-3 text-primary-600 inline ml-1" />;
}

export default function Reports() {
  const { isAdmin } = usePermissions();
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate]     = useState('');
  const [project, setProject]   = useState('');

  // Unit table sort
  const [unitSortKey, setUnitSortKey] = useState('total_gross');
  const [unitSortDir, setUnitSortDir] = useState('desc');

  // Employee table sort
  const [empSortKey, setEmpSortKey] = useState('total_amount');
  const [empSortDir, setEmpSortDir] = useState('desc');

  const { data: projects = [] } = useQuery({
    queryKey: ['unit-projects'],
    queryFn: () => api.get('/units/projects').then(r => r.data),
  });

  const { data: revenueData } = useQuery({
    queryKey: ['revenue-report', fromDate, toDate, project],
    queryFn: () => api.get('/reports/revenue', {
      params: { from_date: fromDate || undefined, to_date: toDate || undefined, project: project || undefined },
    }).then(r => r.data),
  });

  const { data: employeeData, isLoading: empLoading } = useQuery({
    queryKey: ['report-by-employee', fromDate, toDate],
    queryFn: () => api.get('/reports/by-employee', {
      params: { from_date: fromDate || undefined, to_date: toDate || undefined },
    }).then(r => r.data),
  });

  const { data: unitData, isLoading: unitLoading } = useQuery({
    queryKey: ['report-by-unit', fromDate, toDate],
    queryFn: () => api.get('/reports/by-unit', {
      params: { from_date: fromDate || undefined, to_date: toDate || undefined },
    }).then(r => r.data),
  });

  const { data: dailyData, isLoading: dailyLoading } = useQuery({
    queryKey: ['report-daily-reservations'],
    queryFn: () => api.get('/reports/daily-reservations').then(r => r.data),
    refetchInterval: 60_000, // auto-refresh every minute
  });

  const dailyRows     = dailyData?.daily    || [];
  const dailyProjects = dailyData?.projects || [];

  // Sorted daily table
  const [dailySortKey, setDailySortKey] = useState('date');
  const [dailySortDir, setDailySortDir] = useState('desc');
  const sortedDaily = useMemo(() => {
    return [...dailyRows].sort((a, b) => {
      const av = a[dailySortKey] ?? 0;
      const bv = b[dailySortKey] ?? 0;
      const isNum = !isNaN(parseFloat(av)) && !isNaN(parseFloat(bv));
      const cmp = isNum ? parseFloat(av) - parseFloat(bv) : String(av).localeCompare(String(bv));
      return dailySortDir === 'asc' ? cmp : -cmp;
    });
  }, [dailyRows, dailySortKey, dailySortDir]);

  function handleDailySort(key) {
    if (dailySortKey === key) setDailySortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setDailySortKey(key); setDailySortDir('desc'); }
  }

  const today = new Date().toISOString().split('T')[0];

  const exportExcel = () => {
    window.open(`/api/reports/export/reservations/excel?from_date=${fromDate}&to_date=${toDate}`, '_blank');
  };

  // Chart data
  const projectRevenue = {};
  (revenueData?.reservations || []).forEach(r => {
    if (!projectRevenue[r.project]) projectRevenue[r.project] = 0;
    projectRevenue[r.project] += parseFloat(r.total_amount || 0);
  });
  const projectChartData = Object.entries(projectRevenue).map(([name, value]) => ({ name, value }));

  const sourceRevenue = {};
  (revenueData?.reservations || []).forEach(r => {
    const src = r.booking_source || 'Unknown';
    if (!sourceRevenue[src]) sourceRevenue[src] = 0;
    sourceRevenue[src] += parseFloat(r.total_amount || 0);
  });
  const sourceChartData = Object.entries(sourceRevenue).map(([name, value]) => ({ name, value }));

  // Sorted employees
  const employees = useMemo(() => {
    const rows = [...(employeeData?.employees || [])];
    rows.sort((a, b) => {
      const av = parseFloat(a[empSortKey] || 0);
      const bv = parseFloat(b[empSortKey] || 0);
      return empSortDir === 'asc' ? av - bv : bv - av;
    });
    return rows;
  }, [employeeData, empSortKey, empSortDir]);

  // Sorted units
  const units = useMemo(() => {
    const rows = [...(unitData?.units || [])];
    rows.sort((a, b) => {
      const av = typeof a[unitSortKey] === 'string' ? a[unitSortKey].localeCompare(b[unitSortKey]) : parseFloat(a[unitSortKey] || 0) - parseFloat(b[unitSortKey] || 0);
      const bv = typeof b[unitSortKey] === 'string' ? 0 : 0;
      if (typeof a[unitSortKey] === 'string') {
        const cmp = a[unitSortKey].localeCompare(b[unitSortKey]);
        return unitSortDir === 'asc' ? cmp : -cmp;
      }
      const an = parseFloat(a[unitSortKey] || 0);
      const bn = parseFloat(b[unitSortKey] || 0);
      return unitSortDir === 'asc' ? an - bn : bn - an;
    });
    return rows;
  }, [unitData, unitSortKey, unitSortDir]);

  function handleUnitSort(key) {
    if (unitSortKey === key) setUnitSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setUnitSortKey(key); setUnitSortDir('desc'); }
  }

  function handleEmpSort(key) {
    if (empSortKey === key) setEmpSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setEmpSortKey(key); setEmpSortDir('desc'); }
  }

  const thClass = (key, sortKey) =>
    `cursor-pointer select-none hover:bg-gray-100 transition-colors ${sortKey === key ? 'text-primary-700' : ''}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="page-header mb-0">
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">Analytics and financial reports</p>
        </div>
        {(isAdmin) && (
          <button onClick={exportExcel} className="btn-secondary">
            <Download className="w-4 h-4" />Export Excel
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-3">
        <input type="date" className="input w-40" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        <input type="date" className="input w-40" value={toDate}   onChange={e => setToDate(e.target.value)} />
        <SearchableSelect className="w-48" value={project} onChange={setProject}
          placeholder="All Projects"
          options={[{ value: '', label: 'All Projects' }, ...projects.map(p => ({ value: p, label: p }))]}
        />
        {(fromDate || toDate || project) && (
          <button className="btn-secondary text-sm" onClick={() => { setFromDate(''); setToDate(''); setProject(''); }}>
            Clear
          </button>
        )}
      </div>

      {/* ── Daily Reservations Pivot Table ── */}
      <div className="card p-0">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-primary-500" />
            <h3 className="font-semibold text-gray-900">Daily Reservations</h3>
            <span className="text-xs text-gray-400 ml-1">— reservations added per day, per project</span>
          </div>
          <span className="text-xs text-gray-400">{dailyRows.length} days</span>
        </div>

        {dailyLoading ? (
          <div className="p-6"><LoadingSpinner /></div>
        ) : dailyRows.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">No data yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table text-sm">
              <thead>
                <tr>
                  {/* Date */}
                  <th
                    onClick={() => handleDailySort('date')}
                    className={`cursor-pointer select-none hover:bg-gray-100 whitespace-nowrap ${dailySortKey === 'date' ? 'text-primary-700' : ''}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      Date
                      {dailySortKey === 'date'
                        ? dailySortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-primary-600" /> : <ChevronDown className="w-3 h-3 text-primary-600" />
                        : <ChevronsUpDown className="w-3 h-3 text-gray-300" />}
                    </span>
                  </th>
                  {/* Total */}
                  <th
                    onClick={() => handleDailySort('total')}
                    className={`cursor-pointer select-none hover:bg-gray-100 text-center ${dailySortKey === 'total' ? 'text-primary-700' : ''}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      Total
                      {dailySortKey === 'total'
                        ? dailySortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-primary-600" /> : <ChevronDown className="w-3 h-3 text-primary-600" />
                        : <ChevronsUpDown className="w-3 h-3 text-gray-300" />}
                    </span>
                  </th>
                  {/* One column per project */}
                  {dailyProjects.map(proj => (
                    <th
                      key={proj}
                      onClick={() => handleDailySort(proj)}
                      className={`cursor-pointer select-none hover:bg-gray-100 text-center whitespace-nowrap ${dailySortKey === proj ? 'text-primary-700' : ''}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {proj}
                        {dailySortKey === proj
                          ? dailySortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-primary-600" /> : <ChevronDown className="w-3 h-3 text-primary-600" />
                          : <ChevronsUpDown className="w-3 h-3 text-gray-300" />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedDaily.map(row => {
                  const isToday = row.date === today;
                  return (
                    <tr key={row.date} className={isToday ? 'bg-primary-50 font-semibold' : ''}>
                      <td className="whitespace-nowrap">
                        <span className={isToday ? 'text-primary-700 font-bold' : 'text-gray-700'}>
                          {row.date}
                        </span>
                        {isToday && (
                          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-primary-100 text-primary-700">
                            Today
                          </span>
                        )}
                      </td>
                      <td className="text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold
                            ${row.total > 0 ? 'bg-primary-100 text-primary-700' : 'text-gray-300'}`}>
                            {row.total}
                          </span>
                          {row.total_amount > 0 && (
                            <span className="text-xs text-primary-600 font-medium whitespace-nowrap">
                              {Number(row.total_amount).toLocaleString('en-EG', { maximumFractionDigits: 0 })}
                            </span>
                          )}
                        </div>
                      </td>
                      {dailyProjects.map(proj => (
                        <td key={proj} className="text-center">
                          {row[proj] > 0 ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                                {row[proj]}
                              </span>
                              {row[proj + '_amount'] > 0 && (
                                <span className="text-xs text-green-600 font-medium whitespace-nowrap">
                                  {Number(row[proj + '_amount']).toLocaleString('en-EG', { maximumFractionDigits: 0 })}
                                </span>
                              )}
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
                  <td className="text-gray-600 pr-4">All Days</td>
                  <td className="text-center text-primary-700">
                    <div className="flex flex-col items-center gap-0.5">
                      <span>{dailyRows.reduce((s, r) => s + r.total, 0)}</span>
                      <span className="text-xs font-medium text-primary-500">
                        {Number(dailyRows.reduce((s, r) => s + (r.total_amount || 0), 0)).toLocaleString('en-EG', { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  </td>
                  {dailyProjects.map(proj => (
                    <td key={proj} className="text-center text-gray-700">
                      <div className="flex flex-col items-center gap-0.5">
                        <span>{dailyRows.reduce((s, r) => s + (r[proj] || 0), 0)}</span>
                        <span className="text-xs font-medium text-gray-500">
                          {Number(dailyRows.reduce((s, r) => s + (r[proj + '_amount'] || 0), 0)).toLocaleString('en-EG', { maximumFractionDigits: 0 })}
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

      {/* Summary Cards */}
      {revenueData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card p-4 border-l-4 border-primary-500">
            <div className="text-xs text-gray-500 font-medium uppercase tracking-wider">Total Revenue</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{currency(revenueData.summary?.totalRevenue)}</div>
          </div>
          <div className="card p-4 border-l-4 border-green-500">
            <div className="text-xs text-gray-500 font-medium uppercase tracking-wider">Collected</div>
            <div className="text-2xl font-bold text-green-700 mt-1">{currency(revenueData.summary?.totalPaid)}</div>
          </div>
          <div className="card p-4 border-l-4 border-yellow-500">
            <div className="text-xs text-gray-500 font-medium uppercase tracking-wider">Pending</div>
            <div className="text-2xl font-bold text-yellow-700 mt-1">{currency(revenueData.summary?.totalPending)}</div>
          </div>
          <div className="card p-4 border-l-4 border-purple-500">
            <div className="text-xs text-gray-500 font-medium uppercase tracking-wider">Reservations</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{revenueData.summary?.count}</div>
          </div>
        </div>
      )}

      {/* Charts */}
      {revenueData && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {projectChartData.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-gray-900 mb-4">Revenue by Project</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={projectChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={v => currency(v)} />
                  <Bar dataKey="value" fill="#3b82f6" name="Revenue" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {sourceChartData.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-gray-900 mb-4">Revenue by Source</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={sourceChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {sourceChartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={v => currency(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ── Reservations by Employee ── */}
      <div className="card p-0">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <Users className="w-5 h-5 text-primary-500" />
          <h3 className="font-semibold text-gray-900">Reservations by Employee</h3>
        </div>
        {empLoading ? (
          <div className="p-6"><LoadingSpinner /></div>
        ) : employees.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">No data for selected period</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>#</th>
                  <th onClick={() => handleEmpSort('full_name')} className={thClass('full_name', empSortKey)}>
                    Employee <SortIcon col="full_name" sortKey={empSortKey} sortDir={empSortDir} />
                  </th>
                  <th>Role</th>
                  <th onClick={() => handleEmpSort('reservation_count')} className={`text-center ${thClass('reservation_count', empSortKey)}`}>
                    Reservations <SortIcon col="reservation_count" sortKey={empSortKey} sortDir={empSortDir} />
                  </th>
                  <th onClick={() => handleEmpSort('total_amount')} className={`text-right ${thClass('total_amount', empSortKey)}`}>
                    Total Amount <SortIcon col="total_amount" sortKey={empSortKey} sortDir={empSortDir} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e, idx) => (
                  <tr key={e.id}>
                    <td className="text-gray-400">{idx + 1}</td>
                    <td className="font-medium text-gray-900">{e.full_name}</td>
                    <td className="text-gray-500 capitalize">{e.role?.replace(/_/g, ' ')}</td>
                    <td className="text-center font-semibold text-primary-700">{e.reservation_count}</td>
                    <td className="text-right tabular-nums font-semibold text-gray-900">{currency(e.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  <td colSpan={3} className="text-right text-gray-600 pr-4">Totals</td>
                  <td className="text-center text-primary-700">
                    {employees.reduce((s, e) => s + e.reservation_count, 0)}
                  </td>
                  <td className="text-right tabular-nums text-gray-900">
                    {currency(employees.reduce((s, e) => s + parseFloat(e.total_amount || 0), 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ── Revenue by Unit ── */}
      <div className="card p-0">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <Home className="w-5 h-5 text-primary-500" />
          <h3 className="font-semibold text-gray-900">Revenue by Unit</h3>
        </div>
        {unitLoading ? (
          <div className="p-6"><LoadingSpinner /></div>
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
                  <th onClick={() => handleUnitSort('reservation_count')} className={`text-center ${thClass('reservation_count', unitSortKey)}`}>
                    Res. <SortIcon col="reservation_count" sortKey={unitSortKey} sortDir={unitSortDir} />
                  </th>
                  <th onClick={() => handleUnitSort('total_nights')} className={`text-center ${thClass('total_nights', unitSortKey)}`}>
                    Nights <SortIcon col="total_nights" sortKey={unitSortKey} sortDir={unitSortDir} />
                  </th>
                  <th onClick={() => handleUnitSort('total_gross')} className={`text-right ${thClass('total_gross', unitSortKey)}`}>
                    Gross Revenue <SortIcon col="total_gross" sortKey={unitSortKey} sortDir={unitSortDir} />
                  </th>
                  <th onClick={() => handleUnitSort('total_utilities')} className={`text-right ${thClass('total_utilities', unitSortKey)}`}>
                    Utilities <SortIcon col="total_utilities" sortKey={unitSortKey} sortDir={unitSortDir} />
                  </th>
                  <th onClick={() => handleUnitSort('total_company_commission')} className={`text-right ${thClass('total_company_commission', unitSortKey)}`}>
                    Company Comm. <SortIcon col="total_company_commission" sortKey={unitSortKey} sortDir={unitSortDir} />
                  </th>
                  <th onClick={() => handleUnitSort('total_owner_net')} className={`text-right ${thClass('total_owner_net', unitSortKey)}`}>
                    Owner Net <SortIcon col="total_owner_net" sortKey={unitSortKey} sortDir={unitSortDir} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {units.map((u, idx) => (
                  <tr key={u.unit_id}>
                    <td className="text-gray-400">{idx + 1}</td>
                    <td className="font-medium text-gray-900">{u.unit_name}</td>
                    <td className="text-gray-500">{u.project || '—'}</td>
                    <td className="text-center text-gray-600">{u.reservation_count}</td>
                    <td className="text-center font-semibold text-gray-700">{u.total_nights}</td>
                    <td className="text-right tabular-nums font-semibold text-gray-900">{currency(u.total_gross)}</td>
                    <td className="text-right tabular-nums text-green-700">
                      {u.total_utilities > 0 ? currency(u.total_utilities) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="text-right tabular-nums text-yellow-700 font-semibold">
                      {u.total_company_commission > 0 ? currency(u.total_company_commission) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="text-right tabular-nums text-primary-700 font-semibold">{currency(u.total_owner_net)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  <td colSpan={4} className="text-right text-gray-600 pr-4">Totals</td>
                  <td className="text-center text-gray-700">{units.reduce((s, u) => s + u.total_nights, 0)}</td>
                  <td className="text-right tabular-nums text-gray-900">{currency(units.reduce((s, u) => s + u.total_gross, 0))}</td>
                  <td className="text-right tabular-nums text-green-700">{currency(units.reduce((s, u) => s + u.total_utilities, 0))}</td>
                  <td className="text-right tabular-nums text-yellow-700">{currency(units.reduce((s, u) => s + u.total_company_commission, 0))}</td>
                  <td className="text-right tabular-nums text-primary-700">{currency(units.reduce((s, u) => s + u.total_owner_net, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
