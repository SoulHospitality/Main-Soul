import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MinusCircle, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import SearchableSelect from '../components/ui/SearchableSelect';
import { ROLE_LABELS } from '../utils/permissions';
import { currency, formatDate } from '../utils/formatters';

const CATEGORIES = [
  { value: 'delay', label: 'Delay / lateness' },
  { value: 'performance', label: 'Performance' },
  { value: 'advance', label: 'Salary advance' },
  { value: 'absence', label: 'Absence' },
  { value: 'other', label: 'Other' },
];

const EMPTY = {
  staff_user_id: '',
  amount: '',
  reason: '',
  deduction_date: new Date().toISOString().slice(0, 10),
  category: 'other',
};

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Deductions() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY, deduction_date: todayIso() });
  const [deleteId, setDeleteId] = useState(null);

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
  });
  const staffOptions = (Array.isArray(users) ? users : []).filter((u) => u.role !== 'owner');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['hr-deductions'],
    queryFn: () => api.get('/hr/salary-deductions').then((r) => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: (payload) => api.post('/hr/salary-deductions', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-deductions'] });
      qc.invalidateQueries({ queryKey: ['hr-payroll'] });
      toast.success('Deduction applied');
      setModal(false);
      setForm({ ...EMPTY, deduction_date: todayIso() });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not apply deduction'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/hr/salary-deductions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-deductions'] });
      qc.invalidateQueries({ queryKey: ['hr-payroll'] });
      toast.success('Deduction removed');
      setDeleteId(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not delete'),
  });

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      (Array.isArray(rows) ? rows : []).filter((r) => {
        if (!q) return true;
        return [r.full_name, r.staff_code, r.reason, r.category]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q);
      }),
    [rows, q]
  );

  const handleSave = () => {
    if (!form.staff_user_id) return toast.error('Choose a staff member');
    if (!(Number(form.amount) > 0)) return toast.error('Enter an amount greater than 0');
    if (!String(form.reason || '').trim()) return toast.error('Enter a reason');
    if (!form.deduction_date) return toast.error('Choose a date');
    saveMutation.mutate({
      staff_user_id: Number(form.staff_user_id),
      amount: Number(form.amount),
      reason: form.reason.trim(),
      deduction_date: form.deduction_date,
      category: form.category,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="page-header mb-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-soul-muted">HR</p>
          <h1 className="page-title mt-1">Deductions</h1>
          <p className="page-subtitle">
            Choose a staff member and apply a deduction. Amounts reduce that month’s payroll.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setForm({ ...EMPTY, deduction_date: todayIso() });
            setModal(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Apply deduction
        </button>
      </div>

      <SearchFilter value={search} onChange={setSearch} placeholder="Search deductions…" />

      {isLoading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={MinusCircle}
          title="No deductions yet"
          action={
            <button type="button" className="btn-primary" onClick={() => setModal(true)}>
              Apply first deduction
            </button>
          }
        />
      ) : (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Staff</th>
                  <th>Category</th>
                  <th>Reason</th>
                  <th>Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{formatDate(r.deduction_date)}</td>
                    <td>
                      <div className="font-semibold text-soul-blue">{r.full_name}</div>
                      <div className="text-[11px] text-soul-muted">
                        {r.staff_code ? `${r.staff_code} · ` : ''}
                        {ROLE_LABELS[r.role] || r.role}
                      </div>
                    </td>
                    <td className="capitalize">{r.category?.replace('_', ' ')}</td>
                    <td className="max-w-[18rem]">
                      <span className="line-clamp-2">{r.reason}</span>
                      {r.created_by_name ? (
                        <span className="block text-[11px] text-soul-muted">By {r.created_by_name}</span>
                      ) : null}
                    </td>
                    <td className="tabular-nums whitespace-nowrap font-semibold text-rose-700">
                      {currency(r.amount)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-secondary text-xs px-2 py-1 text-rose-700"
                        onClick={() => setDeleteId(r.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
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
        title="Apply deduction"
        size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setModal(false)}>Cancel</button>
            <button type="button" className="btn-primary" disabled={saveMutation.isPending} onClick={handleSave}>
              {saveMutation.isPending ? 'Saving…' : 'Apply'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label">Staff *</label>
            <SearchableSelect
              value={String(form.staff_user_id)}
              onChange={(v) => setForm((f) => ({ ...f, staff_user_id: v }))}
              placeholder="Select staff…"
              options={staffOptions.map((u) => ({
                value: String(u.id),
                label: `${u.full_name}${u.staff_code ? ` · ${u.staff_code}` : ''}`,
              }))}
            />
          </div>
          <div className="form-grid">
            <div>
              <label className="label">Amount (EGP) *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="input"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Date *</label>
              <input
                type="date"
                className="input"
                value={form.deduction_date}
                onChange={(e) => setForm((f) => ({ ...f, deduction_date: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Category</label>
              <select
                className="input"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Reason *</label>
            <textarea
              className="input min-h-[88px]"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="Why this amount is deducted"
            />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Remove deduction"
        danger
        confirmText="Delete"
        loading={deleteMutation.isPending}
        message="This deduction will no longer count against payroll for that date."
        onConfirm={() => deleteMutation.mutate(deleteId)}
      />
    </div>
  );
}
