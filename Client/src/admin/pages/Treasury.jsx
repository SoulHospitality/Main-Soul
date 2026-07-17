/**
 * Treasury — Cash Ledger
 * Spreadsheet-style safe sheet with running balance.
 */
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Edit2, Trash2, Download, Filter, X,
  ArrowUpCircle, ArrowDownCircle, Wallet, TrendingUp, TrendingDown,
  Lock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { useSortableTable } from '../hooks/useSortableTable';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SortTh from '../components/ui/SortTh';
import { currency, formatDate } from '../utils/formatters';
import * as XLSX from 'xlsx';
import { usePermissions } from '../hooks/usePermissions';
import SearchableSelect from '../components/ui/SearchableSelect';

// ─── Constants ─────────────────────────────────────────────────────────────

const CATEGORIES_IN  = ['Reservation Payment', 'Owner Payment', 'Rental Income', 'Other Income'];
const CATEGORIES_OUT = ['Expense', 'Maintenance', 'Housekeeping', 'Insurance', 'Petty Cash', 'Salary', 'Other'];
const ALL_CATEGORIES = [...new Set([...CATEGORIES_IN, ...CATEGORIES_OUT])];

const PAYMENT_METHODS = [
  { value: 'cash',          label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'instapay',      label: 'InstaPay' },
  { value: 'credit_card',   label: 'Credit Card' },
  { value: 'check',         label: 'Check' },
];

const METHOD_LABELS = Object.fromEntries(PAYMENT_METHODS.map(m => [m.value, m.label]));

const EMPTY_FORM = {
  date: '', type: 'in', category: '', description: '',
  unit_id: '', reservation_id: '', payment_method: 'cash', amount: '',
};

// ─── Helpers ───────────────────────────────────────────────────────────────

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

// ─── Sub-components ────────────────────────────────────────────────────────

function TypeToggle({ value, onChange }) {
  return (
    <div className="flex rounded-xl overflow-hidden border border-gray-200 h-11">
      <button
        type="button"
        onClick={() => onChange('in')}
        className={`flex-1 flex items-center justify-center gap-2 text-sm font-semibold transition-colors ${
          value === 'in' ? 'bg-emerald-500 text-white' : 'bg-white text-gray-500 hover:bg-emerald-50'
        }`}
      >
        <ArrowUpCircle className="w-4 h-4" /> IN
      </button>
      <button
        type="button"
        onClick={() => onChange('out')}
        className={`flex-1 flex items-center justify-center gap-2 text-sm font-semibold transition-colors ${
          value === 'out' ? 'bg-red-500 text-white' : 'bg-white text-gray-500 hover:bg-red-50'
        }`}
      >
        <ArrowDownCircle className="w-4 h-4" /> OUT
      </button>
    </div>
  );
}

function SourceBadge({ source }) {
  if (source === 'payment')
    return <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-600">Auto·Payment</span>;
  if (source === 'expense')
    return <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-600">Auto·Expense</span>;
  return <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Manual</span>;
}

// ─── Entry Form ────────────────────────────────────────────────────────────
function EntryForm({ form, setForm, units, reservations }) {
  const categories = form.type === 'in' ? CATEGORIES_IN : CATEGORIES_OUT;

  return (
    <div className="space-y-4">
      {/* Type Toggle */}
      <div>
        <label className="label">Transaction Type *</label>
        <TypeToggle value={form.type} onChange={v => setForm(f => ({ ...f, type: v, category: '' }))} />
      </div>

      {/* Category + Amount side by side */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Category *</label>
          <SearchableSelect value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))}
            placeholder="Select…"
            options={[{ value: '', label: 'Select…' }, ...categories.map(c => ({ value: c, label: c }))]}
          />
        </div>
        <div>
          <label className="label">Amount (EGP) *</label>
          <input type="number" min="0.01" step="0.01" className="input"
            value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            placeholder="0.00" />
        </div>
      </div>

      {/* Date + Method */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Date *</label>
          <input type="date" className="input" value={form.date}
            onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
        </div>
        <div>
          <label className="label">Payment Method</label>
          <SearchableSelect value={form.payment_method} onChange={v => setForm(f => ({ ...f, payment_method: v }))}
            placeholder="Select…"
            options={PAYMENT_METHODS.map(m => ({ value: m.value, label: m.label }))}
          />
        </div>
      </div>

      {/* Unit (optional) */}
      <div>
        <label className="label">Unit <span className="text-gray-400 font-normal">(optional)</span></label>
        <SearchableSelect value={form.unit_id} onChange={v => setForm(f => ({ ...f, unit_id: v }))}
          placeholder="No unit"
          options={[{ value: '', label: 'No unit' }, ...units.map(u => ({ value: String(u.id), label: `${u.name} — ${u.project}` }))]}
        />
      </div>

      {/* Description */}
      <div>
        <label className="label">Description</label>
        <textarea className="input resize-none" rows={2} value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder="Notes, reference, guest name…" />
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────
export default function Treasury() {
  const { isAdmin } = usePermissions();
  const qc = useQueryClient();

  // ── Filter states
  const [fromDate,    setFromDate]    = useState('');
  const [toDate,      setToDate]      = useState('');
  const [typeFilter,  setTypeFilter]  = useState('');
  const [catFilter,   setCatFilter]   = useState('');
  const [unitFilter,  setUnitFilter]  = useState('');
  const [methFilter,  setMethFilter]  = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const hasFilters = fromDate || toDate || typeFilter || catFilter || unitFilter || methFilter;

  const clearFilters = () => {
    setFromDate(''); setToDate(''); setTypeFilter('');
    setCatFilter(''); setUnitFilter(''); setMethFilter('');
  };

  // ── Modal states
  const [addModal,   setAddModal]   = useState(false);
  const [editEntry,  setEditEntry]  = useState(null);
  const [deleteEntry, setDeleteEntry] = useState(null);
  const [form,       setForm]       = useState({ ...EMPTY_FORM, date: todayStr() });

  // ── Queries
  const { data, isLoading } = useQuery({
    queryKey: ['treasury', fromDate, toDate, typeFilter, catFilter, unitFilter, methFilter],
    queryFn: () => api.get('/treasury', {
      params: {
        from_date:      fromDate    || undefined,
        to_date:        toDate      || undefined,
        type:           typeFilter  || undefined,
        category:       catFilter   || undefined,
        unit_id:        unitFilter  || undefined,
        payment_method: methFilter  || undefined,
      },
    }).then(r => r.data),
    staleTime: 15_000,
  });

  const { data: units = [] } = useQuery({
    queryKey: ['units'],
    queryFn: () => api.get('/units').then(r => r.data),
  });

  const entries = data?.entries || [];
  const summary = data?.summary || {};

  const { sorted: sortedEntries, sortKey, sortDir, handleSort } = useSortableTable(entries, 'date', 'desc');

  // ── Mutations
  const addMutation = useMutation({
    mutationFn: d => api.post('/treasury', d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['treasury'] });
      toast.success('Entry added ✓');
      setAddModal(false);
      setForm({ ...EMPTY_FORM, date: todayStr() });
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed to add entry'),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, ...d }) => api.patch(`/treasury/${id}`, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['treasury'] });
      toast.success('Entry updated ✓');
      setEditEntry(null);
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed to update entry'),
  });

  const deleteMutation = useMutation({
    mutationFn: id => api.delete(`/treasury/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['treasury'] });
      toast.success('Entry deleted');
      setDeleteEntry(null);
    },
    onError: e => toast.error(e.response?.data?.error || 'Failed to delete entry'),
  });

  // ── Handlers
  const openAdd = () => {
    setForm({ ...EMPTY_FORM, date: todayStr() });
    setAddModal(true);
  };

  const openEdit = (entry) => {
    setForm({
      date:           String(entry.date).split('T')[0],
      type:           entry.type,
      category:       entry.category,
      description:    entry.description    || '',
      unit_id:        entry.unit_id        || '',
      reservation_id: entry.reservation_id || '',
      payment_method: entry.payment_method || 'cash',
      amount:         entry.amount,
    });
    setEditEntry(entry);
  };

  const handleSave = (isEdit) => {
    if (!form.date || !form.type || !form.category || !form.amount)
      return toast.error('Please fill all required fields');
    if (parseFloat(form.amount) <= 0)
      return toast.error('Amount must be greater than 0');

    const payload = {
      date:           form.date,
      type:           form.type,
      category:       form.category,
      description:    form.description   || undefined,
      unit_id:        form.unit_id       || undefined,
      reservation_id: form.reservation_id || undefined,
      payment_method: form.payment_method,
      amount:         parseFloat(form.amount),
    };

    if (isEdit) {
      editMutation.mutate({ id: editEntry.id, ...payload });
    } else {
      addMutation.mutate(payload);
    }
  };

  // ── Export Excel
  const exportExcel = () => {
    if (!entries.length) return;
    const ws = XLSX.utils.json_to_sheet(
      [...entries].reverse().map(e => ({
        Date:           String(e.date).split('T')[0],
        Type:           e.type === 'in' ? 'IN' : 'OUT',
        Category:       e.category,
        Description:    e.description || '',
        Unit:           e.unit_name   || '',
        Method:         METHOD_LABELS[e.payment_method] || e.payment_method || '',
        'Amount In':    e.type === 'in'  ? e.amount : '',
        'Amount Out':   e.type === 'out' ? e.amount : '',
        Balance:        e.running_balance,
        Source:         e.source,
        'Created By':   e.created_by_name || '',
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Treasury');
    XLSX.writeFile(wb, `Treasury_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const balancePositive = (summary.current_balance || 0) >= 0;

  return (
    <div className="space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="page-header mb-0">
          <h1 className="page-title flex items-center gap-2">
            <Wallet className="w-6 h-6 text-emerald-600" />
            Treasury
          </h1>
          <p className="page-subtitle">Daily cash ledger — every movement tracked with running balance</p>
        </div>
        <div className="flex items-center gap-2">
          {(isAdmin) && (
            <button onClick={exportExcel} className="btn-secondary">
              <Download className="w-4 h-4" />Excel
            </button>
          )}
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`btn-secondary ${hasFilters ? 'ring-2 ring-primary-400' : ''}`}
          >
            <Filter className="w-4 h-4" />
            Filters{hasFilters ? ` (${[fromDate,toDate,typeFilter,catFilter,unitFilter,methFilter].filter(Boolean).length})` : ''}
          </button>
          <button onClick={openAdd} className="btn-primary">
            <Plus className="w-4 h-4" />Add Transaction
          </button>
        </div>
      </div>

      {/* ── Summary Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Current Balance — big card */}
        <div className={`card p-5 col-span-1 sm:col-span-1 ${balancePositive ? 'bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-200' : 'bg-gradient-to-br from-red-50 to-orange-50 border-red-200'}`}>
          <p className={`text-xs font-semibold uppercase tracking-wider mb-1 ${balancePositive ? 'text-emerald-600' : 'text-red-500'}`}>
            💰 Current Balance
          </p>
          <p className={`text-3xl font-bold tabular-nums ${balancePositive ? 'text-emerald-700' : 'text-red-600'}`}>
            {currency(summary.current_balance || 0)}
          </p>
          <p className="text-xs text-gray-400 mt-1">All-time running total</p>
        </div>
        {/* Period In */}
        <div className="card p-5 bg-emerald-50 border-emerald-200">
          <div className="flex items-center gap-2 mb-2">
            <ArrowUpCircle className="w-5 h-5 text-emerald-500" />
            <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Total In</p>
          </div>
          <p className="text-2xl font-bold text-emerald-700 tabular-nums">{currency(summary.period_in || 0)}</p>
          <p className="text-xs text-gray-400 mt-1">{hasFilters ? 'Filtered period' : 'All time'}</p>
        </div>
        {/* Period Out */}
        <div className="card p-5 bg-red-50 border-red-200">
          <div className="flex items-center gap-2 mb-2">
            <ArrowDownCircle className="w-5 h-5 text-red-400" />
            <p className="text-xs font-semibold text-red-500 uppercase tracking-wider">Total Out</p>
          </div>
          <p className="text-2xl font-bold text-red-600 tabular-nums">{currency(summary.period_out || 0)}</p>
          <p className="text-xs text-gray-400 mt-1">{hasFilters ? 'Filtered period' : 'All time'}</p>
        </div>
      </div>

      {/* ── Filters Panel ──────────────────────────────────────────────── */}
      {showFilters && (
        <div className="card p-4 border-primary-200 bg-primary-50/30">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label text-xs">From</label>
              <input type="date" className="input w-38" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            </div>
            <div>
              <label className="label text-xs">To</label>
              <input type="date" className="input w-38" value={toDate} onChange={e => setToDate(e.target.value)} />
            </div>
            <div>
              <label className="label text-xs">Type</label>
              <SearchableSelect className="w-32" value={typeFilter} onChange={setTypeFilter}
                placeholder="All"
                options={[{ value: '', label: 'All' }, { value: 'in', label: 'IN' }, { value: 'out', label: 'OUT' }]}
              />
            </div>
            <div>
              <label className="label text-xs">Category</label>
              <SearchableSelect className="w-44" value={catFilter} onChange={setCatFilter}
                placeholder="All Categories"
                options={[{ value: '', label: 'All Categories' }, ...ALL_CATEGORIES.map(c => ({ value: c, label: c }))]}
              />
            </div>
            <div>
              <label className="label text-xs">Unit</label>
              <SearchableSelect className="w-44" value={unitFilter} onChange={setUnitFilter}
                placeholder="All Units"
                options={[{ value: '', label: 'All Units' }, ...units.map(u => ({ value: String(u.id), label: u.name }))]}
              />
            </div>
            <div>
              <label className="label text-xs">Method</label>
              <SearchableSelect className="w-36" value={methFilter} onChange={setMethFilter}
                placeholder="All Methods"
                options={[{ value: '', label: 'All Methods' }, ...PAYMENT_METHODS.map(m => ({ value: m.value, label: m.label }))]}
              />
            </div>
            {hasFilters && (
              <button onClick={clearFilters} className="btn-secondary text-sm self-end">
                <X className="w-3.5 h-3.5" />Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Auto-integration notice ─────────────────────────────────────── */}
      <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-xs text-blue-700">
        <TrendingUp className="w-4 h-4 flex-shrink-0" />
        <span>
          <strong>Auto-sync active:</strong> New approved payments → auto "IN" entry · New company expenses → auto "OUT" entry. Auto-entries cannot be edited or deleted here — manage them from their source tab.
        </span>
      </div>

      {/* ── Ledger Table ───────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="card p-12 flex justify-center"><LoadingSpinner /></div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No transactions yet"
          subtitle="Add your first transaction or check your filters"
          action={<button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" />Add Transaction</button>}
        />
      ) : (
        <div className="rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Sticky-ish header with entry count */}
          <div className="bg-gray-50 border-b border-gray-200 px-4 py-2 flex items-center justify-between text-xs text-gray-500">
            <span>{entries.length} transaction{entries.length !== 1 ? 's' : ''} · newest first</span>
            <span>Running balance shown <strong>after</strong> each transaction</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-800 text-white text-xs uppercase tracking-wide">
                  <SortTh col="date" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-3 py-2.5 text-left font-medium">Date</SortTh>
                  <SortTh col="type" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-3 py-2.5 text-center font-medium">Type</SortTh>
                  <SortTh col="category" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-3 py-2.5 text-left font-medium">Category</SortTh>
                  <SortTh col="description" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-3 py-2.5 text-left font-medium">Description</SortTh>
                  <SortTh col="unit_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-3 py-2.5 text-left font-medium">Unit</SortTh>
                  <SortTh col="payment_method" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-3 py-2.5 text-left font-medium">Method</SortTh>
                  <SortTh col="amount_in" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-3 py-2.5 text-right font-medium text-emerald-300">Amount In</SortTh>
                  <SortTh col="amount_out" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-3 py-2.5 text-right font-medium text-red-300">Amount Out</SortTh>
                  <th className="px-3 py-2.5 text-right font-medium text-blue-200">Balance</th>
                  <th className="px-3 py-2.5 text-center font-medium">Source</th>
                  <th className="px-3 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedEntries.map((entry, idx) => {
                  const isIn  = entry.type === 'in';
                  const isAuto = entry.source !== 'manual';
                  const balPos = entry.running_balance >= 0;

                  return (
                    <tr
                      key={entry.id}
                      className={`group transition-colors ${
                        isIn
                          ? 'bg-emerald-50/40 hover:bg-emerald-50'
                          : 'bg-red-50/30 hover:bg-red-50/60'
                      }`}
                    >
                      {/* Date */}
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600 text-xs font-mono">
                        {String(entry.date).split('T')[0]}
                      </td>

                      {/* Type */}
                      <td className="px-3 py-2 text-center">
                        {isIn ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
                            <ArrowUpCircle className="w-3 h-3" />IN
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-600">
                            <ArrowDownCircle className="w-3 h-3" />OUT
                          </span>
                        )}
                      </td>

                      {/* Category */}
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                        {entry.category}
                      </td>

                      {/* Description */}
                      <td className="px-3 py-2 text-gray-500 max-w-[180px]">
                        <div className="truncate">{entry.description || entry.guest_name || '—'}</div>
                      </td>

                      {/* Unit */}
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap text-xs">
                        {entry.unit_name || <span className="text-gray-300">—</span>}
                      </td>

                      {/* Method */}
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap text-xs capitalize">
                        {METHOD_LABELS[entry.payment_method] || entry.payment_method || '—'}
                      </td>

                      {/* Amount In */}
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">
                        {isIn
                          ? <span className="text-emerald-700">+{currency(entry.amount)}</span>
                          : <span className="text-gray-200">—</span>
                        }
                      </td>

                      {/* Amount Out */}
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">
                        {!isIn
                          ? <span className="text-red-600">-{currency(entry.amount)}</span>
                          : <span className="text-gray-200">—</span>
                        }
                      </td>

                      {/* Running Balance — most prominent column */}
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className={`font-bold text-sm ${balPos ? 'text-blue-700' : 'text-orange-600'}`}>
                          {currency(entry.running_balance)}
                        </span>
                      </td>

                      {/* Source */}
                      <td className="px-3 py-2 text-center">
                        <SourceBadge source={entry.source} />
                      </td>

                      {/* Actions */}
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {isAuto ? (
                            <span title="Auto-generated — edit from source tab"
                              className="p-1.5 text-gray-300 cursor-not-allowed">
                              <Lock className="w-3.5 h-3.5" />
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => openEdit(entry)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                title="Edit">
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setDeleteEntry(entry)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                title="Delete">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {/* Footer: net summary */}
              <tfoot>
                <tr className="bg-gray-800 text-white">
                  <td colSpan={6} className="px-3 py-2.5 text-xs text-gray-300 font-medium">
                    {entries.length} transactions shown
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold text-emerald-300">
                    {currency(summary.period_in || 0)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold text-red-300">
                    {currency(summary.period_out || 0)}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums font-bold text-lg ${balancePositive ? 'text-blue-300' : 'text-orange-300'}`}>
                    {currency(summary.current_balance || 0)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── Add Modal ──────────────────────────────────────────────────── */}
      <Modal
        open={addModal}
        onClose={() => setAddModal(false)}
        title="Add Transaction"
        size="md"
        footer={
          <>
            <button onClick={() => setAddModal(false)} className="btn-secondary">Cancel</button>
            <button
              onClick={() => handleSave(false)}
              disabled={addMutation.isPending}
              className="btn-primary"
            >
              {addMutation.isPending ? 'Saving…' : 'Add to Ledger'}
            </button>
          </>
        }
      >
        <EntryForm form={form} setForm={setForm} units={units} reservations={[]} />
      </Modal>

      {/* ── Edit Modal ─────────────────────────────────────────────────── */}
      <Modal
        open={!!editEntry}
        onClose={() => setEditEntry(null)}
        title="Edit Transaction"
        size="md"
        footer={
          <>
            <button onClick={() => setEditEntry(null)} className="btn-secondary">Cancel</button>
            <button
              onClick={() => handleSave(true)}
              disabled={editMutation.isPending}
              className="btn-primary"
            >
              {editMutation.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </>
        }
      >
        <EntryForm form={form} setForm={setForm} units={units} reservations={[]} />
      </Modal>

      {/* ── Delete Confirmation ────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!deleteEntry}
        onClose={() => setDeleteEntry(null)}
        onConfirm={() => deleteMutation.mutate(deleteEntry?.id)}
        loading={deleteMutation.isPending}
        title="Delete Transaction?"
        message={
          deleteEntry
            ? `This will permanently remove "${deleteEntry.category}" (${currency(deleteEntry.amount)}) from the ledger and recalculate all balances. This action cannot be undone.`
            : ''
        }
        confirmText="Yes, Delete"
        danger={true}
      />
    </div>
  );
}
