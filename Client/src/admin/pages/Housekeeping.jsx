import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { Home, DollarSign, ClipboardList, Download, Sparkles, CheckCircle2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import SearchableSelect from '../components/ui/SearchableSelect';
import { usePermissions } from '../hooks/usePermissions';
import { useSortableTable } from '../hooks/useSortableTable';
import SortTh from '../components/ui/SortTh';
import { FINANCIAL_EPOCH } from '../utils/financialEpoch';

const fmt = (n) =>
  Number(n || 0).toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const normDate = (d) => (d ? String(d).split('T')[0] : '');

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function booksFrom() {
  const d = new Date();
  const monthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  return monthStart < FINANCIAL_EPOCH ? FINANCIAL_EPOCH : monthStart;
}

function StatusBadge({ status }) {
  const map = {
    confirmed: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
    cancelled: 'bg-red-100 text-red-800',
    checked_in: 'bg-blue-100 text-blue-800',
    checked_out: 'bg-gray-100 text-gray-700',
    accepted: 'bg-blue-100 text-blue-800',
    in_progress: 'bg-amber-100 text-amber-800',
    submitted: 'bg-indigo-100 text-indigo-800',
    needs_reclean: 'bg-red-100 text-red-800',
    ready: 'bg-emerald-100 text-emerald-800',
  };
  const label = status
    ? status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : '-';
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {label}
    </span>
  );
}

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

function TasksTab() {
  const qc = useQueryClient();
  const { isAdmin } = usePermissions();
  const [statusFilter, setStatusFilter] = useState('');

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['housekeeping-tasks', statusFilter],
    queryFn: () =>
      api
        .get('/housekeeping-tasks', { params: statusFilter ? { status: statusFilter } : {} })
        .then((r) => r.data),
  });

  const patch = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/housekeeping-tasks/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['housekeeping-tasks'] });
      toast.success('Task updated');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Update failed'),
  });

  const submit = useMutation({
    mutationFn: (id) => api.post(`/housekeeping-tasks/${id}/submit`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['housekeeping-tasks'] });
      toast.success('Submitted for inspection');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Submit failed'),
  });

  const inspect = useMutation({
    mutationFn: ({ id, result }) => api.post(`/housekeeping-tasks/${id}/inspect`, { result }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['housekeeping-tasks'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Inspection recorded');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Inspection failed'),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {['pending', 'accepted', 'in_progress', 'submitted', 'needs_reclean', 'ready', 'cancelled'].map(
            (s) => (
              <option key={s} value={s}>
                {s}
              </option>
            )
          )}
        </select>
        <p className="text-sm text-gray-500">{tasks.length} tasks</p>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 py-12 text-center">Loading tasks…</p>
      ) : tasks.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-xl p-10 text-center text-gray-400 text-sm">
          No housekeeping tasks yet. Tasks auto-create ~24h before check-in.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tasks.map((t) => (
            <div key={t.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">{t.unit_name}</p>
                  <p className="text-xs text-gray-500">
                    {t.project || '—'} · Check-in {normDate(t.check_in) || '—'}
                  </p>
                </div>
                <StatusBadge status={t.status} />
              </div>
              {t.guest_name_internal && (
                <p className="text-sm text-gray-600">Guest: {t.guest_name_internal}</p>
              )}
              <ul className="text-xs text-gray-600 space-y-1">
                {(Array.isArray(t.checklist) ? t.checklist : []).slice(0, 6).map((c) => (
                  <li key={c.key || c.label} className="flex items-center gap-2">
                    <CheckCircle2 className={`w-3.5 h-3.5 ${c.done ? 'text-emerald-500' : 'text-gray-300'}`} />
                    {c.label}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2 pt-1">
                {t.status === 'pending' && (
                  <button
                    className="btn-secondary text-xs"
                    onClick={() => patch.mutate({ id: t.id, body: { status: 'accepted' } })}
                  >
                    Accept
                  </button>
                )}
                {['accepted', 'needs_reclean'].includes(t.status) && (
                  <button
                    className="btn-secondary text-xs"
                    onClick={() => patch.mutate({ id: t.id, body: { status: 'in_progress' } })}
                  >
                    Start
                  </button>
                )}
                {t.status === 'in_progress' && (
                  <button className="btn-primary text-xs" onClick={() => submit.mutate(t.id)}>
                    Submit for inspection
                  </button>
                )}
                {t.status === 'submitted' && isAdmin && (
                  <>
                    <button
                      className="btn-primary text-xs"
                      onClick={() => inspect.mutate({ id: t.id, result: 'pass' })}
                    >
                      Pass
                    </button>
                    <button
                      className="btn-secondary text-xs text-red-600"
                      onClick={() => inspect.mutate({ id: t.id, result: 'fail' })}
                    >
                      Fail / re-clean
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FeesTab() {
  const { isAdmin } = usePermissions();
  const [fromDate, setFromDate] = useState(booksFrom());
  const [toDate, setToDate] = useState(todayStr());
  const [unitId, setUnitId] = useState('');
  const [project, setProject] = useState('');
  const [search, setSearch] = useState('');

  const { data: unitsData } = useQuery({
    queryKey: ['units-list'],
    queryFn: () => api.get('/units').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const params = {};
  if (fromDate) params.from_date = fromDate;
  if (toDate) params.to_date = toDate;
  if (unitId) params.unit_id = unitId;
  if (project) params.project = project;

  const { data, isLoading, error } = useQuery({
    queryKey: ['housekeeping', fromDate, toDate, unitId, project],
    queryFn: () => api.get('/housekeeping', { params }).then((r) => r.data),
    staleTime: 60 * 1000,
  });

  const rows = useMemo(() => {
    const all = data?.rows || [];
    if (!search.trim()) return all;
    const q = search.trim().toLowerCase();
    return all.filter(
      (r) =>
        (r.guest_name || '').toLowerCase().includes(q) ||
        (r.unit_name || '').toLowerCase().includes(q)
    );
  }, [data, search]);

  const projects = useMemo(() => {
    if (data?.projects?.length) return data.projects;
    if (unitsData) return [...new Set(unitsData.map((u) => u.project).filter(Boolean))].sort();
    return [];
  }, [data, unitsData]);

  const units = useMemo(() => {
    if (!unitsData) return [];
    if (!project) return unitsData;
    return unitsData.filter((u) => u.project === project);
  }, [unitsData, project]);

  const { sorted, sortKey, sortDir, handleSort } = useSortableTable(rows, 'check_in', 'desc');
  const visibleTotal = useMemo(
    () => rows.reduce((s, r) => s + parseFloat(r.housekeeping_fees || 0), 0),
    [rows]
  );

  function handleExport() {
    const exportRows = rows.map((r) => ({
      'Reservation ID': r.id,
      Unit: r.unit_name,
      Project: r.project || '',
      Guest: r.guest_name,
      'Check-in': normDate(r.check_in),
      'Check-out': normDate(r.check_out),
      Nights: r.nights,
      Status: r.status,
      'Housekeeping Fee': parseFloat(r.housekeeping_fees || 0),
    }));
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Housekeeping Fees');
    XLSX.writeFile(wb, `housekeeping_fees_${fromDate}_${toDate}.xlsx`);
  }

  return (
    <div className="space-y-6">
      {isAdmin && (
        <div className="flex justify-end">
          <button
            onClick={handleExport}
            disabled={!rows.length}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
          >
            <Download className="w-4 h-4" />
            Export Excel
          </button>
        </div>
      )}

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

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">Project</label>
            <SearchableSelect
              value={project}
              onChange={(v) => {
                setProject(v);
                setUnitId('');
              }}
              placeholder="All Projects"
              options={[{ value: '', label: 'All Projects' }, ...projects.map((p) => ({ value: p, label: p }))]}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">Unit</label>
            <SearchableSelect
              value={unitId}
              onChange={setUnitId}
              placeholder="All Units"
              options={[
                { value: '', label: 'All Units' },
                ...units.map((u) => ({ value: String(u.id), label: u.name || u.title })),
              ]}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">Search Guest / Unit</label>
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

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
                  <SortTh col="unit_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-4 py-3 text-left">
                    Unit
                  </SortTh>
                  <SortTh col="guest_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-4 py-3 text-left">
                    Guest
                  </SortTh>
                  <SortTh col="check_in" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-4 py-3 text-left">
                    Check-in
                  </SortTh>
                  <SortTh col="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-4 py-3 text-left">
                    Status
                  </SortTh>
                  <SortTh
                    col="housekeeping_fees"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className="px-4 py-3 text-right"
                  >
                    Fee
                  </SortTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map((r, idx) => (
                  <tr key={r.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-3 text-gray-400 text-xs">{r.id}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{r.unit_name}</td>
                    <td className="px-4 py-3 text-gray-700">{r.guest_name}</td>
                    <td className="px-4 py-3 text-gray-600">{normDate(r.check_in)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                      EGP {fmt(r.housekeeping_fees)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Housekeeping() {
  const [tab, setTab] = useState('tasks');

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Housekeeping &amp; Ops</h1>
          <p className="text-gray-500 text-sm mt-0.5">Task readiness workflow and fee ledger</p>
        </div>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setTab('tasks')}
            className={`px-4 py-2 text-sm font-medium flex items-center gap-2 ${
              tab === 'tasks' ? 'bg-soul-blue text-white' : 'bg-white text-gray-600'
            }`}
          >
            <Sparkles className="w-4 h-4" /> Tasks
          </button>
          <button
            type="button"
            onClick={() => setTab('fees')}
            className={`px-4 py-2 text-sm font-medium flex items-center gap-2 ${
              tab === 'fees' ? 'bg-soul-blue text-white' : 'bg-white text-gray-600'
            }`}
          >
            <DollarSign className="w-4 h-4" /> Fees
          </button>
        </div>
      </div>
      {tab === 'tasks' ? <TasksTab /> : <FeesTab />}
    </div>
  );
}
