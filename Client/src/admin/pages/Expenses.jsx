import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, Receipt, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { usePermissions } from '../hooks/usePermissions';
import { useSortableTable } from '../hooks/useSortableTable';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import SearchableSelect from '../components/ui/SearchableSelect';
import SortTh from '../components/ui/SortTh';
import { currency, formatDate } from '../utils/formatters';
import { FINANCIAL_EPOCH } from '../utils/financialEpoch';
import * as XLSX from 'xlsx';

/** Manual expense categories for company P&L (auto costs stay off this page). */
const CATEGORIES = [
  { value: 'all', label: 'All', short: 'All' },
  { value: 'housekeeping_cost', label: 'Actual housekeeping', short: 'Housekeeping' },
  { value: 'utilities_cost', label: 'Actual utilities', short: 'Utilities' },
  { value: 'salary', label: 'Salaries', short: 'Salaries' },
  { value: 'marketing', label: 'Marketing', short: 'Marketing' },
  { value: 'other', label: 'Other', short: 'Other' },
];

const CATEGORY_META = Object.fromEntries(
  CATEGORIES.filter((c) => c.value !== 'all').map((c) => [c.value, c.label])
);

const needsUnit = (category) => category === 'other';

const EMPTY_FORM = {
  category: 'other',
  unit_id: '',
  description: '',
  amount: '',
  paid_by: 'company',
  expense_date: new Date().toISOString().split('T')[0],
  notes: '',
};

function categoryBadgeClass(cat) {
  switch (cat) {
    case 'housekeeping_cost':
      return 'bg-teal-50 text-teal-800 border-teal-200';
    case 'utilities_cost':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'salary':
      return 'bg-violet-50 text-violet-800 border-violet-200';
    case 'marketing':
      return 'bg-sky-50 text-sky-800 border-sky-200';
    default:
      return 'bg-slate-50 text-slate-700 border-slate-200';
  }
}

function ExpenseForm({ form, setForm, units }) {
  const unitRequired = needsUnit(form.category);
  return (
    <div className="space-y-4">
      <div className="form-grid">
        <div className="md:col-span-2">
          <label className="label">Category *</label>
          <SearchableSelect
            value={form.category}
            onChange={(v) =>
              setForm((f) => ({
                ...f,
                category: v,
                unit_id: needsUnit(v) ? f.unit_id : '',
                paid_by: needsUnit(v) ? f.paid_by : 'company',
              }))
            }
            options={CATEGORIES.filter((c) => c.value !== 'all').map((c) => ({
              value: c.value,
              label: c.label,
            }))}
          />
        </div>
        {unitRequired && (
          <div>
            <label className="label">Unit *</label>
            <SearchableSelect
              value={form.unit_id}
              onChange={(v) => setForm((f) => ({ ...f, unit_id: v }))}
              placeholder="Select unit…"
              options={[
                { value: '', label: 'Select unit…' },
                ...units.map((u) => ({
                  value: String(u.id),
                  label: `${u.name} (${u.project})`,
                })),
              ]}
            />
          </div>
        )}
        <div>
          <label className="label">Date *</label>
          <input
            type="date"
            className="input"
            value={form.expense_date}
            onChange={(e) => setForm((f) => ({ ...f, expense_date: e.target.value }))}
          />
        </div>
        <div className="md:col-span-2">
          <label className="label">Description *</label>
          <input
            className="input"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder={
              form.category === 'utilities_cost'
                ? 'e.g. July electricity — Fouka Bay SA-4B-102'
                : form.category === 'housekeeping_cost'
                  ? 'e.g. Cleaner overtime, supplies'
                  : form.category === 'salary'
                    ? 'e.g. July payroll — Ahmed'
                    : form.category === 'marketing'
                      ? 'e.g. Instagram ads July'
                      : 'e.g. AC maintenance'
            }
          />
        </div>
        <div>
          <label className="label">Amount (EGP) *</label>
          <input
            type="number"
            min="0"
            step="0.01"
            className="input"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            placeholder="0.00"
          />
        </div>
        {unitRequired && (
          <div>
            <label className="label">Paid By *</label>
            <div className="flex gap-3 mt-2">
              {['company', 'owner', 'tenant'].map((v) => (
                <label key={v} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="paid_by"
                    value={v}
                    checked={form.paid_by === v}
                    onChange={() => setForm((f) => ({ ...f, paid_by: v }))}
                    className="text-primary-600"
                  />
                  <span className="text-sm font-medium capitalize">{v}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
      <div>
        <label className="label">Notes</label>
        <textarea
          className="input resize-none"
          rows={2}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
      </div>
    </div>
  );
}

export default function Expenses() {
  const qc = useQueryClient();
  const { isAdmin, can } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryParam = searchParams.get('category') || 'all';
  const filterCategory = CATEGORY_META[categoryParam] ? categoryParam : 'all';

  const [search, setSearch] = useState('');
  const [filterUnit, setFilterUnit] = useState('');
  const [filterPaidBy, setFilterPaidBy] = useState('');
  const [fromDate, setFromDate] = useState(FINANCIAL_EPOCH);
  const [toDate, setToDate] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);

  const setFilterCategory = (value) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === 'all') next.delete('category');
    else next.set('category', value);
    setSearchParams(next, { replace: true });
  };

  const { data: units = [] } = useQuery({
    queryKey: ['units'],
    queryFn: () => api.get('/units').then((r) => r.data),
  });

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses', filterCategory, filterUnit, filterPaidBy, fromDate, toDate],
    queryFn: () =>
      api
        .get('/expenses', {
          params: {
            category: filterCategory === 'all' ? undefined : filterCategory,
            unit_id: filterUnit || undefined,
            paid_by: filterPaidBy || undefined,
            from_date: fromDate || undefined,
            to_date: toDate || undefined,
          },
        })
        .then((r) => r.data),
  });

  const filtered = expenses.filter(
    (e) =>
      !search ||
      e.description?.toLowerCase().includes(search.toLowerCase()) ||
      e.unit_name?.toLowerCase().includes(search.toLowerCase()) ||
      (CATEGORY_META[e.category] || e.category || '')
        .toLowerCase()
        .includes(search.toLowerCase())
  );

  const { sorted, sortKey, sortDir, handleSort } = useSortableTable(filtered, 'expense_date', 'desc');

  const totalsByCategory = useMemo(() => {
    const map = {};
    for (const c of Object.keys(CATEGORY_META)) map[c] = 0;
    for (const e of filtered) {
      const cat = CATEGORY_META[e.category] ? e.category : 'other';
      map[cat] = (map[cat] || 0) + (parseFloat(e.amount) || 0);
    }
    return map;
  }, [filtered]);

  const grandTotal = filtered.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

  const saveMutation = useMutation({
    mutationFn: (d) => {
      const category = d.category || 'other';
      const payload = {
        ...d,
        category,
        unit_id: needsUnit(category) ? d.unit_id || null : null,
        paid_by: needsUnit(category) ? d.paid_by || 'company' : 'company',
      };
      return editId
        ? api.put(`/expenses/${editId}`, payload)
        : api.post('/expenses', payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['finance-summary'] });
      toast.success(editId ? 'Updated' : 'Expense added');
      setModal(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error saving'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/expenses/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['finance-summary'] });
      toast.success('Deleted');
      setDeleteId(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error deleting'),
  });

  const openAdd = () => {
    setForm({
      ...EMPTY_FORM,
      category: filterCategory === 'all' ? 'other' : filterCategory,
    });
    setEditId(null);
    setModal(true);
  };

  const openEdit = (e) => {
    setForm({
      category: CATEGORY_META[e.category] ? e.category : 'other',
      unit_id: e.unit_id ? String(e.unit_id) : '',
      description: e.description || '',
      amount: e.amount,
      paid_by: e.paid_by || 'company',
      expense_date: e.expense_date ? String(e.expense_date).split('T')[0] : '',
      notes: e.notes || '',
    });
    setEditId(e.id);
    setModal(true);
  };

  const save = () => {
    if (!form.description || !form.amount || !form.expense_date || !form.category) {
      return toast.error('Category, description, amount and date are required');
    }
    if (needsUnit(form.category) && !form.unit_id) {
      return toast.error('Unit is required for other expenses');
    }
    saveMutation.mutate(form);
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(
      filtered.map((e) => ({
        Date: e.expense_date ? String(e.expense_date).split('T')[0] : '',
        Category: CATEGORY_META[e.category] || e.category || 'Other',
        Unit: e.unit_name || '',
        Project: e.project || '',
        Description: e.description,
        'Paid By': e.paid_by,
        Amount: e.amount,
        Notes: e.notes || '',
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Expenses');
    XLSX.writeFile(wb, 'expenses.xlsx');
  };

  const canWrite = can('expenses:write') || isAdmin;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="page-header mb-0">
          <h1 className="page-title">Expenses</h1>
          <p className="page-subtitle">
            All manual costs in one place — housekeeping, utilities, salaries, marketing, and other
          </p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <button onClick={exportExcel} className="btn-secondary">
              <Download className="w-4 h-4" />
              Export
            </button>
          )}
          {canWrite && (
            <button onClick={openAdd} className="btn-primary">
              <Plus className="w-4 h-4" />
              Add Expense
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => {
          const active = filterCategory === c.value;
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => setFilterCategory(c.value)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                active
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {c.short}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="card p-4 border-l-4 border-primary-500">
          <div className="text-xl font-bold text-gray-900 tabular-nums">{currency(grandTotal)}</div>
          <div className="text-xs text-gray-500 mt-0.5">Total ({filtered.length})</div>
        </div>
        {Object.entries(CATEGORY_META).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilterCategory(key)}
            className="card p-4 text-left hover:shadow-md transition-shadow"
          >
            <div className="text-lg font-bold text-slate-900 tabular-nums">
              {currency(totalsByCategory[key] || 0)}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">{label}</div>
          </button>
        ))}
      </div>

      <SearchFilter value={search} onChange={setSearch} placeholder="Search description, unit, category…">
        <SearchableSelect
          className="w-48"
          value={filterUnit}
          onChange={setFilterUnit}
          placeholder="All Units"
          options={[
            { value: '', label: 'All Units' },
            ...units.map((u) => ({ value: String(u.id), label: u.name })),
          ]}
        />
        <SearchableSelect
          className="w-36"
          value={filterPaidBy}
          onChange={setFilterPaidBy}
          placeholder="All"
          options={[
            { value: '', label: 'All' },
            { value: 'company', label: 'Company' },
            { value: 'owner', label: 'Owner' },
            { value: 'tenant', label: 'Tenant' },
          ]}
        />
        <input
          type="date"
          className="input w-36"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
        />
        <input
          type="date"
          className="input w-36"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
        />
      </SearchFilter>

      {isLoading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No expenses found"
          action={
            canWrite && (
              <button onClick={openAdd} className="btn-primary">
                <Plus className="w-4 h-4" />
                Add Expense
              </button>
            )
          }
        />
      ) : (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <SortTh col="expense_date" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Date
                  </SortTh>
                  <SortTh col="category" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Category
                  </SortTh>
                  <SortTh col="unit_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Unit
                  </SortTh>
                  <SortTh col="description" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Description
                  </SortTh>
                  <SortTh col="paid_by" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Paid By
                  </SortTh>
                  <SortTh col="amount" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Amount
                  </SortTh>
                  {canWrite && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {sorted.map((e) => {
                  const cat = CATEGORY_META[e.category] ? e.category : 'other';
                  return (
                    <tr key={e.id}>
                      <td>{formatDate(e.expense_date)}</td>
                      <td>
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${categoryBadgeClass(cat)}`}
                        >
                          {CATEGORY_META[cat]}
                        </span>
                      </td>
                      <td>
                        {e.unit_name ? (
                          <>
                            <div className="font-medium">{e.unit_name}</div>
                            <div className="text-xs text-gray-400">{e.project}</div>
                          </>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td>{e.description}</td>
                      <td>
                        <span
                          className={
                            e.paid_by === 'company'
                              ? 'badge-blue'
                              : e.paid_by === 'tenant'
                                ? 'badge-purple'
                                : 'badge-orange'
                          }
                        >
                          {e.paid_by === 'company'
                            ? 'Company'
                            : e.paid_by === 'tenant'
                              ? 'Tenant'
                              : 'Owner'}
                        </span>
                      </td>
                      <td className="font-semibold tabular-nums">{currency(e.amount)}</td>
                      {canWrite && (
                        <td>
                          <div className="flex gap-1">
                            <button
                              onClick={() => openEdit(e)}
                              className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            {isAdmin && (
                              <button
                                onClick={() => setDeleteId(e.id)}
                                className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editId ? 'Edit Expense' : 'Add Expense'}
        size="md"
        footer={
          <>
            <button onClick={() => setModal(false)} className="btn-secondary">
              Cancel
            </button>
            <button onClick={save} disabled={saveMutation.isPending} className="btn-primary">
              {saveMutation.isPending ? 'Saving...' : 'Save'}
            </button>
          </>
        }
      >
        <ExpenseForm form={form} setForm={setForm} units={units} />
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteMutation.mutate(deleteId)}
        loading={deleteMutation.isPending}
        title="Delete Expense"
        message="Delete this expense?"
        confirmText="Delete"
        danger
      />
    </div>
  );
}
