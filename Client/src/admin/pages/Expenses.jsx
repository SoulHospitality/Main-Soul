import { useState } from 'react';
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

const EMPTY_FORM = { unit_id:'', description:'', amount:'', paid_by:'company', expense_date: new Date().toISOString().split('T')[0], notes:'' };

function ExpenseForm({ form, setForm, units }) {
  return (
    <div className="space-y-4">
      <div className="form-grid">
        <div>
          <label className="label">Unit *</label>
          <SearchableSelect value={form.unit_id} onChange={v => setForm(f => ({ ...f, unit_id: v }))}
            placeholder="Select unit…"
            options={[{ value: '', label: 'Select unit…' }, ...units.map(u => ({ value: String(u.id), label: `${u.name} (${u.project})` }))]}
          />
        </div>
        <div><label className="label">Date *</label><input type="date" className="input" value={form.expense_date} onChange={e => setForm(f => ({ ...f, expense_date: e.target.value }))} /></div>
        <div className="md:col-span-2"><label className="label">Description *</label><input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. AC maintenance" /></div>
        <div><label className="label">Amount (AED) *</label><input type="number" min="0" step="0.01" className="input" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" /></div>
        <div>
          <label className="label">Paid By *</label>
          <div className="flex gap-3 mt-2">
            {['company','owner','tenant'].map(v => (
              <label key={v} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="paid_by" value={v} checked={form.paid_by === v} onChange={() => setForm(f => ({ ...f, paid_by: v }))} className="text-primary-600" />
                <span className="text-sm font-medium capitalize">{v}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <div><label className="label">Notes</label><textarea className="input resize-none" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
    </div>
  );
}

export default function Expenses() {
  const qc = useQueryClient();
  const { isAdmin, can } = usePermissions();
  const [search, setSearch] = useState('');
  const [filterUnit, setFilterUnit] = useState('');
  const [filterPaidBy, setFilterPaidBy] = useState('');
  const [fromDate, setFromDate] = useState(FINANCIAL_EPOCH);
  const [toDate, setToDate] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);

  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: () => api.get('/units').then(r => r.data) });

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses', filterUnit, filterPaidBy, fromDate, toDate],
    queryFn: () => api.get('/expenses', { params: { unit_id: filterUnit || undefined, paid_by: filterPaidBy || undefined, from_date: fromDate || undefined, to_date: toDate || undefined } }).then(r => r.data),
  });

  const filtered = expenses.filter(e => !search || e.description?.toLowerCase().includes(search.toLowerCase()) || e.unit_name?.toLowerCase().includes(search.toLowerCase()));

  const { sorted, sortKey, sortDir, handleSort } = useSortableTable(filtered, 'expense_date', 'desc');

  const totalCompany = filtered.filter(e => e.paid_by === 'company').reduce((s, e) => s + e.amount, 0);
  const totalOwner   = filtered.filter(e => e.paid_by === 'owner').reduce((s, e) => s + e.amount, 0);
  const totalTenant  = filtered.filter(e => e.paid_by === 'tenant').reduce((s, e) => s + e.amount, 0);

  const saveMutation = useMutation({
    mutationFn: (d) => editId ? api.put(`/expenses/${editId}`, d) : api.post('/expenses', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); toast.success(editId ? 'Updated' : 'Expense added'); setModal(false); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error saving'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/expenses/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); toast.success('Deleted'); setDeleteId(null); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error deleting'),
  });

  const openAdd = () => { setForm(EMPTY_FORM); setEditId(null); setModal(true); };
  const openEdit = (e) => { setForm({ unit_id: e.unit_id, description: e.description, amount: e.amount, paid_by: e.paid_by, expense_date: e.expense_date, notes: e.notes || '' }); setEditId(e.id); setModal(true); };

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map(e => ({ Date: e.expense_date, Unit: e.unit_name, Project: e.project, Description: e.description, 'Paid By': e.paid_by, Amount: e.amount })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Expenses'); XLSX.writeFile(wb, 'expenses.xlsx');
  };

  const canWrite = can('expenses:write');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="page-header mb-0">
          <h1 className="page-title">Expenses</h1>
          <p className="page-subtitle">{filtered.length} records</p>
        </div>
        <div className="flex gap-2">
          {(isAdmin) && <button onClick={exportExcel} className="btn-secondary"><Download className="w-4 h-4" />Export</button>}
          {canWrite && <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" />Add Expense</button>}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        <div className="card p-4 text-center border-l-4 border-primary-500">
          <div className="text-2xl font-bold text-gray-900">{currency(totalCompany + totalOwner + totalTenant)}</div>
          <div className="text-sm text-gray-500">Total Expenses</div>
        </div>
        <div className="card p-4 text-center border-l-4 border-blue-500">
          <div className="text-2xl font-bold text-blue-700">{currency(totalCompany)}</div>
          <div className="text-sm text-gray-500">Company Paid</div>
        </div>
        <div className="card p-4 text-center border-l-4 border-orange-500">
          <div className="text-2xl font-bold text-orange-700">{currency(totalOwner)}</div>
          <div className="text-sm text-gray-500">Owner Paid</div>
        </div>
        <div className="card p-4 text-center border-l-4 border-purple-500">
          <div className="text-2xl font-bold text-purple-700">{currency(totalTenant)}</div>
          <div className="text-sm text-gray-500">Tenant Paid</div>
        </div>
      </div>

      <SearchFilter value={search} onChange={setSearch} placeholder="Search description, unit...">
        <SearchableSelect className="w-48" value={filterUnit} onChange={setFilterUnit}
          placeholder="All Units"
          options={[{ value: '', label: 'All Units' }, ...units.map(u => ({ value: String(u.id), label: u.name }))]}
        />
        <SearchableSelect className="w-36" value={filterPaidBy} onChange={setFilterPaidBy}
          placeholder="All"
          options={[{ value: '', label: 'All' }, { value: 'company', label: 'Company' }, { value: 'owner', label: 'Owner' }, { value: 'tenant', label: 'Tenant' }]}
        />
        <input type="date" className="input w-36" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        <input type="date" className="input w-36" value={toDate} onChange={e => setToDate(e.target.value)} />
      </SearchFilter>

      {isLoading ? <LoadingSpinner /> : filtered.length === 0 ? (
        <EmptyState icon={Receipt} title="No expenses found" action={canWrite && <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" />Add Expense</button>} />
      ) : (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table">
              <thead><tr>
                <SortTh col="expense_date" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Date</SortTh>
                <SortTh col="unit_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Unit</SortTh>
                <SortTh col="description" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Description</SortTh>
                <SortTh col="paid_by" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Paid By</SortTh>
                <SortTh col="amount" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Amount</SortTh>
                {canWrite && <th>Actions</th>}
              </tr></thead>
              <tbody>
                {sorted.map(e => (
                  <tr key={e.id}>
                    <td>{formatDate(e.expense_date)}</td>
                    <td>
                      <div className="font-medium">{e.unit_name}</div>
                      <div className="text-xs text-gray-400">{e.project}</div>
                    </td>
                    <td>{e.description}</td>
                    <td>
                      <span className={e.paid_by === 'company' ? 'badge-blue' : e.paid_by === 'tenant' ? 'badge-purple' : 'badge-orange'}>
                        {e.paid_by === 'company' ? 'Company' : e.paid_by === 'tenant' ? 'Tenant' : 'Owner'}
                      </span>
                    </td>
                    <td className="font-semibold">{currency(e.amount)}</td>
                    {canWrite && <td>
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(e)} className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50"><Edit2 className="w-3.5 h-3.5" /></button>
                        {(isAdmin) && <button onClick={() => setDeleteId(e.id)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>}
                      </div>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Edit Expense' : 'Add Expense'} size="md"
        footer={<><button onClick={() => setModal(false)} className="btn-secondary">Cancel</button><button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending} className="btn-primary">{saveMutation.isPending ? 'Saving...' : 'Save'}</button></>}
      >
        <ExpenseForm form={form} setForm={setForm} units={units} />
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => deleteMutation.mutate(deleteId)} loading={deleteMutation.isPending} title="Delete Expense" message="Delete this expense?" confirmText="Delete" danger />
    </div>
  );
}
