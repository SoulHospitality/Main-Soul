import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import api from '../../api/axios';
import { usePermissions } from '../../hooks/usePermissions';
import { useSortableTable } from '../../hooks/useSortableTable';
import Modal from '../ui/Modal';
import ConfirmDialog from '../ui/ConfirmDialog';
import LoadingSpinner from '../ui/LoadingSpinner';
import EmptyState from '../ui/EmptyState';
import SearchFilter from '../ui/SearchFilter';
import SortTh from '../ui/SortTh';
import { currency, formatDate } from '../../utils/formatters';
import { FINANCIAL_EPOCH } from '../../utils/financialEpoch';

/**
 * Reusable ledger page for a fixed expense category
 * (marketing / salary / housekeeping_cost / utilities_cost).
 * Simple flow for admin: date, description, amount, optional notes.
 */
export default function CategoryLedgerPage({
  category,
  title,
  subtitle,
  icon: Icon,
  entryLabel = 'entry',
  descriptionPlaceholder = 'Description…',
}) {
  const qc = useQueryClient();
  const { isAdmin } = usePermissions();
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState(FINANCIAL_EPOCH);
  const [toDate, setToDate] = useState('');
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);

  const emptyForm = {
    description: '',
    amount: '',
    expense_date: new Date().toISOString().split('T')[0],
    notes: '',
  };
  const [form, setForm] = useState(emptyForm);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['expenses', category, fromDate, toDate],
    queryFn: () =>
      api
        .get('/expenses', {
          params: {
            category,
            from_date: fromDate || undefined,
            to_date: toDate || undefined,
          },
        })
        .then((r) => r.data),
  });

  const filtered = entries.filter(
    (e) => !search || e.description?.toLowerCase().includes(search.toLowerCase())
  );
  const { sorted, sortKey, sortDir, handleSort } = useSortableTable(filtered, 'expense_date', 'desc');
  const total = filtered.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

  const saveMutation = useMutation({
    mutationFn: (d) =>
      editId
        ? api.put(`/expenses/${editId}`, { ...d, category })
        : api.post('/expenses', { ...d, category, paid_by: 'company' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['finance-summary'] });
      toast.success(editId ? 'Updated' : 'Added');
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
    setForm(emptyForm);
    setEditId(null);
    setModal(true);
  };
  const openEdit = (e) => {
    setForm({
      description: e.description || '',
      amount: e.amount,
      expense_date: e.expense_date ? String(e.expense_date).split('T')[0] : '',
      notes: e.notes || '',
    });
    setEditId(e.id);
    setModal(true);
  };

  const save = () => {
    if (!form.description || !form.amount || !form.expense_date) {
      return toast.error('Description, amount and date are required');
    }
    saveMutation.mutate(form);
  };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(
      filtered.map((e) => ({
        Date: e.expense_date ? String(e.expense_date).split('T')[0] : '',
        Description: e.description,
        Amount: e.amount,
        Notes: e.notes || '',
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, title);
    XLSX.writeFile(wb, `${category}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="page-header mb-0">
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <button onClick={exportExcel} className="btn-secondary">
              <Download className="w-4 h-4" />
              Export
            </button>
          )}
          {isAdmin && (
            <button onClick={openAdd} className="btn-primary">
              <Plus className="w-4 h-4" />
              Add {entryLabel}
            </button>
          )}
        </div>
      </div>

      <div className="card p-5 border-l-4 border-rose-400 flex items-center gap-4 max-w-md">
        {Icon && (
          <div className="w-11 h-11 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center">
            <Icon className="w-5 h-5" />
          </div>
        )}
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500 font-medium">
            Total ({filtered.length} {filtered.length === 1 ? entryLabel : `${entryLabel}s`})
          </p>
          <p className="text-2xl font-bold text-slate-900 tabular-nums">{currency(total)}</p>
        </div>
      </div>

      <SearchFilter value={search} onChange={setSearch} placeholder="Search description…">
        <input type="date" className="input w-36" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <input type="date" className="input w-36" value={toDate} onChange={(e) => setToDate(e.target.value)} />
      </SearchFilter>

      {isLoading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Icon}
          title={`No ${title.toLowerCase()} recorded`}
          action={
            isAdmin && (
              <button onClick={openAdd} className="btn-primary">
                <Plus className="w-4 h-4" />
                Add {entryLabel}
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
                  <SortTh col="expense_date" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Date</SortTh>
                  <SortTh col="description" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Description</SortTh>
                  <SortTh col="amount" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Amount</SortTh>
                  <th>Notes</th>
                  {isAdmin && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {sorted.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDate(e.expense_date)}</td>
                    <td className="font-medium">{e.description}</td>
                    <td className="font-semibold">{currency(e.amount)}</td>
                    <td className="text-gray-500 text-sm">{e.notes || '—'}</td>
                    {isAdmin && (
                      <td>
                        <div className="flex gap-1">
                          <button
                            onClick={() => openEdit(e)}
                            className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteId(e.id)}
                            className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editId ? `Edit ${entryLabel}` : `Add ${entryLabel}`}
        size="md"
        footer={
          <>
            <button onClick={() => setModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={save} disabled={saveMutation.isPending} className="btn-primary">
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="form-grid">
            <div className="md:col-span-2">
              <label className="label">Description *</label>
              <input
                className="input"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder={descriptionPlaceholder}
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
            <div>
              <label className="label">Date *</label>
              <input
                type="date"
                className="input"
                value={form.expense_date}
                onChange={(e) => setForm((f) => ({ ...f, expense_date: e.target.value }))}
              />
            </div>
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
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteMutation.mutate(deleteId)}
        loading={deleteMutation.isPending}
        title={`Delete ${entryLabel}`}
        message={`Delete this ${entryLabel}?`}
        confirmText="Delete"
        danger
      />
    </div>
  );
}
