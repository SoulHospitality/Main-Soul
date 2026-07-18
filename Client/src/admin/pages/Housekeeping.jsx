import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/axios';
import { Home, DollarSign, ClipboardList, Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import SearchableSelect from '../components/ui/SearchableSelect';
import { usePermissions } from '../hooks/usePermissions';
import { useSortableTable } from '../hooks/useSortableTable';
import SortTh from '../components/ui/SortTh';
import { FINANCIAL_EPOCH } from '../utils/financialEpoch';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = n => Number(n || 0).toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const normDate = d => d ? String(d).split('T')[0] : '';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function booksFrom() {
  const d = new Date();
  const monthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  return monthStart < FINANCIAL_EPOCH ? FINANCIAL_EPOCH : monthStart;
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    confirmed:  'bg-green-100 text-green-800',
    pending:    'bg-yellow-100 text-yellow-800',
    cancelled:  'bg-red-100 text-red-800',
    checked_in: 'bg-blue-100 text-blue-800',
    checked_out:'bg-gray-100 text-gray-700',
  };
  const label = status ? status.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase()) : '-';
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {label}
    </span>
  );
}

// ─── Summary card ─────────────────────────────────────────────────────────────
function SummaryCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">{label}</p>
        <p className="text-xl font-bold text-gray-800 mt-0.5">{value}</p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function Housekeeping() {
  const { isAdmin } = usePermissions();
  const [fromDate, setFromDate] = useState(booksFrom());
  const [toDate,   setToDate]   = useState(todayStr());
  const [unitId,   setUnitId]   = useState('');
  const [project,  setProject]  = useState('');
  const [search,   setSearch]   = useState('');

  // Fetch units for filter dropdown
  const { data: unitsData } = useQuery({
    queryKey: ['units-list'],
    queryFn: () => api.get('/units').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });

  // Fetch housekeeping data
  const params = {};
  if (fromDate) params.from_date = fromDate;
  if (toDate)   params.to_date   = toDate;
  if (unitId)   params.unit_id   = unitId;
  if (project)  params.project   = project;

  const { data, isLoading, error } = useQuery({
    queryKey: ['housekeeping', fromDate, toDate, unitId, project],
    queryFn: () => api.get('/housekeeping', { params }).then(r => r.data),
    staleTime: 60 * 1000,
  });

  // Client-side search filter on guest name
  const rows = useMemo(() => {
    const all = data?.rows || [];
    if (!search.trim()) return all;
    const q = search.trim().toLowerCase();
    return all.filter(r =>
      (r.guest_name  || '').toLowerCase().includes(q) ||
      (r.unit_name   || '').toLowerCase().includes(q)
    );
  }, [data, search]);

  // Projects list — from API or derive from units
  const projects = useMemo(() => {
    if (data?.projects?.length) return data.projects;
    if (unitsData) return [...new Set(unitsData.map(u => u.project).filter(Boolean))].sort();
    return [];
  }, [data, unitsData]);

  const units = useMemo(() => {
    if (!unitsData) return [];
    if (!project) return unitsData;
    return unitsData.filter(u => u.project === project);
  }, [unitsData, project]);

  const { sorted, sortKey, sortDir, handleSort } = useSortableTable(rows, 'check_in', 'desc');

  // Recalculate total from visible rows (after client search)
  const visibleTotal = useMemo(
    () => rows.reduce((s, r) => s + parseFloat(r.housekeeping_fees || 0), 0),
    [rows]
  );

  // Excel export
  function handleExport() {
    const exportRows = rows.map(r => ({
      'Reservation ID':   r.id,
      'Unit':             r.unit_name,
      'Project':          r.project || '',
      'Guest':            r.guest_name,
      'Check-in':         normDate(r.check_in),
      'Check-out':        normDate(r.check_out),
      'Nights':           r.nights,
      'Status':           r.status,
      'Housekeeping Fee': parseFloat(r.housekeeping_fees || 0),
    }));
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Housekeeping Fees');
    XLSX.writeFile(wb, `housekeeping_fees_${fromDate}_${toDate}.xlsx`);
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Housekeeping Fees</h1>
          <p className="text-gray-500 text-sm mt-0.5">Collected housekeeping fees per reservation</p>
        </div>
        {(isAdmin) && (
          <button
            onClick={handleExport}
            disabled={!rows.length}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            Export Excel
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          icon={DollarSign}
          label="Total Housekeeping Fees"
          value={`EGP ${fmt(data?.summary?.total ?? 0)}`}
          color="bg-emerald-500"
        />
        <SummaryCard
          icon={ClipboardList}
          label="Reservations (filtered)"
          value={(data?.summary?.count ?? 0).toLocaleString()}
          color="bg-blue-500"
        />
        <SummaryCard
          icon={Home}
          label="Shown (after search)"
          value={`EGP ${fmt(visibleTotal)}`}
          color="bg-indigo-500"
        />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* From date */}
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* To date */}
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">To</label>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Project */}
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">Project</label>
            <SearchableSelect value={project} onChange={v => { setProject(v); setUnitId(''); }}
              placeholder="All Projects"
              options={[{ value: '', label: 'All Projects' }, ...projects.map(p => ({ value: p, label: p }))]}
            />
          </div>

          {/* Unit */}
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">Unit</label>
            <SearchableSelect value={unitId} onChange={setUnitId}
              placeholder="All Units"
              options={[{ value: '', label: 'All Units' }, ...units.map(u => ({ value: String(u.id), label: u.name }))]}
            />
          </div>

          {/* Guest search */}
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">Search Guest / Unit</label>
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading…</div>
        ) : error ? (
          <div className="flex items-center justify-center h-48 text-red-500 text-sm">Failed to load data</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 text-sm gap-2">
            <Home className="w-8 h-8 opacity-30" />
            <span>No housekeeping fees found for the selected filters</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800 text-white text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">#</th>
                  <SortTh col="unit_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-4 py-3 text-left">Unit</SortTh>
                  <SortTh col="project" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-4 py-3 text-left">Project</SortTh>
                  <SortTh col="guest_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-4 py-3 text-left">Guest</SortTh>
                  <SortTh col="check_in" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-4 py-3 text-left">Check-in</SortTh>
                  <SortTh col="check_out" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-4 py-3 text-left">Check-out</SortTh>
                  <SortTh col="nights" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-4 py-3 text-center">Nights</SortTh>
                  <SortTh col="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-4 py-3 text-left">Status</SortTh>
                  <SortTh col="housekeeping_fees" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-4 py-3 text-right">Housekeeping Fee</SortTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map((r, idx) => (
                  <tr key={r.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-3 text-gray-400 text-xs">{r.id}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{r.unit_name}</td>
                    <td className="px-4 py-3 text-gray-500">{r.project || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{r.guest_name}</td>
                    <td className="px-4 py-3 text-gray-600">{normDate(r.check_in)}</td>
                    <td className="px-4 py-3 text-gray-600">{normDate(r.check_out)}</td>
                    <td className="px-4 py-3 text-center text-gray-600">{r.nights}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                      EGP {fmt(r.housekeeping_fees)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Footer total row */}
              <tfoot>
                <tr className="bg-gray-100 border-t-2 border-gray-300">
                  <td colSpan={8} className="px-4 py-3 text-right font-bold text-gray-700 text-sm uppercase tracking-wide">
                    Total ({rows.length} reservations)
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-emerald-700 text-base">
                    EGP {fmt(visibleTotal)}
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
