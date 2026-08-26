import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MinusCircle, Plus, Trash2, Upload } from 'lucide-react';
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
import { dailyRate, DEDUCTION_TYPE_LABELS } from '../utils/hrPolicy';

const EMPTY = {
  staff_user_id: '',
  category: 'other',
  amount: '',
  reason: '',
  deduction_date: '',
  kind: 'deduction',
};

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Deductions() {
  const qc = useQueryClient();
  const fileRef = useRef(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY, deduction_date: todayIso() });
  const [deleteId, setDeleteId] = useState(null);

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
  });
  const staffOptions = (Array.isArray(users) ? users : []).filter(
    (u) => u.role !== 'owner' && u.role !== 'admin'
  );
  const selectedStaff = staffOptions.find((u) => String(u.id) === String(form.staff_user_id));
  const rate = selectedStaff ? dailyRate(selectedStaff.base_salary) : 0;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['hr-deductions'],
    queryFn: () => api.get('/hr/salary-deductions').then((r) => r.data),
  });
  const { data: bonusRows = [] } = useQuery({
    queryKey: ['hr-bonuses'],
    queryFn: () => api.get('/hr/salary-bonuses').then((r) => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: (payload) =>
      payload.kind === 'bonus'
        ? api.post('/hr/salary-bonuses', payload)
        : api.post('/hr/salary-deductions', payload),
    onSuccess: (_, payload) => {
      qc.invalidateQueries({ queryKey: ['hr-deductions'] });
      qc.invalidateQueries({ queryKey: ['hr-bonuses'] });
      qc.invalidateQueries({ queryKey: ['hr-payroll'] });
      qc.invalidateQueries({ queryKey: ['hr-payslip'] });
      toast.success(payload.kind === 'bonus' ? 'Bonus added' : 'Deduction applied');
      setModal(false);
      setForm({ ...EMPTY, deduction_date: todayIso() });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not apply deduction'),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, kind }) =>
      kind === 'bonus' ? api.delete(`/hr/salary-bonuses/${id}`) : api.delete(`/hr/salary-deductions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-deductions'] });
      qc.invalidateQueries({ queryKey: ['hr-bonuses'] });
      qc.invalidateQueries({ queryKey: ['hr-payroll'] });
      qc.invalidateQueries({ queryKey: ['hr-payslip'] });
      toast.success('Deduction removed');
      setDeleteId(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not delete'),
  });

  const importMutation = useMutation({
    mutationFn: (file) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post('/hr/attendance/import', fd).then((r) => r.data);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['hr-deductions'] });
      qc.invalidateQueries({ queryKey: ['hr-payroll'] });
      qc.invalidateQueries({ queryKey: ['hr-payslip'] });
      qc.invalidateQueries({ queryKey: ['hr-attendance'] });
      const errCount = Array.isArray(data.errors) ? data.errors.length : 0;
      toast.success(
        `Imported ${data.created || 0} deduction${data.created === 1 ? '' : 's'}` +
          (data.skipped ? ` · skipped ${data.skipped}` : '') +
          (errCount ? ` · ${errCount} error${errCount === 1 ? '' : 's'}` : '')
      );
      if (errCount && data.errors[0]?.error) {
        toast.error(`Row ${data.errors[0].row}: ${data.errors[0].error}`);
      }
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not import attendance'),
  });

  const combined = useMemo(() => {
    const deductions = (Array.isArray(rows) ? rows : []).map((r) => ({
      ...r,
      kind: 'deduction',
      date: r.deduction_date,
    }));
    const bonuses = (Array.isArray(bonusRows) ? bonusRows : []).map((r) => ({
      ...r,
      kind: 'bonus',
      category: 'bonus',
      date: r.bonus_date,
    }));
    return [...deductions, ...bonuses].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }, [rows, bonusRows]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      combined.filter((r) => {
        if (!q) return true;
        return [r.full_name, r.staff_code, r.reason, r.category]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q);
      }),
    [combined, q]
  );

  const handleSave = () => {
    if (!form.staff_user_id) return toast.error('Choose a staff member');
    if (!form.deduction_date) return toast.error('Choose a date');
    if (!(Number(form.amount) > 0)) return toast.error('Enter an amount greater than 0');
    if (!String(form.reason || '').trim()) return toast.error('Enter a reason');
    saveMutation.mutate({
      staff_user_id: Number(form.staff_user_id),
      deduction_date: form.deduction_date,
      bonus_date: form.deduction_date,
      category: form.kind === 'bonus' ? undefined : form.category,
      amount: Number(form.amount),
      reason: form.reason.trim(),
      kind: form.kind,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="page-header mb-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-soul-muted">HR</p>
          <h1 className="page-title mt-1">Deductions</h1>
          <p className="page-subtitle">
            Upload the door report (Person ID, Time, Attendance Status). Check-in time is used for lateness;
            no check-in on a day in the report is absence, unless there is an approved holiday. Operations staff are skipped.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={importMutation.isPending}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            {importMutation.isPending ? 'Importing…' : 'Upload Excel'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) importMutation.mutate(file);
            }}
          />
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setForm({ ...EMPTY, deduction_date: todayIso() });
              setModal(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Other deduction
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setForm({ ...EMPTY, kind: 'bonus', deduction_date: todayIso() });
              setModal(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Add bonus
          </button>
        </div>
      </div>

      <SearchFilter value={search} onChange={setSearch} placeholder="Search deductions…" />

      {isLoading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={MinusCircle}
          title="No deductions yet"
          action={
            <button type="button" className="btn-primary" onClick={() => fileRef.current?.click()}>
              Upload attendance Excel
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
                  <th>Type</th>
                  <th>Reason</th>
                  <th>Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={`${r.kind}-${r.id}`}>
                    <td className="whitespace-nowrap">{formatDate(r.date)}</td>
                    <td>
                      <div className="font-semibold text-soul-blue">{r.full_name}</div>
                      <div className="text-[11px] text-soul-muted">
                        {r.staff_code ? `${r.staff_code} · ` : ''}
                        {ROLE_LABELS[r.role] || r.role}
                      </div>
                    </td>
                    <td>{r.kind === 'bonus' ? 'Bonus' : DEDUCTION_TYPE_LABELS[r.category] || r.category}</td>
                    <td className="max-w-[18rem]">
                      <span className="line-clamp-2">{r.reason}</span>
                      {r.arrival_time ? (
                        <span className="block text-[11px] text-soul-muted">
                          Arrived {String(r.arrival_time).slice(0, 5)}
                        </span>
                      ) : null}
                    </td>
                    <td
                      className={`tabular-nums whitespace-nowrap font-semibold ${
                        r.kind === 'bonus' ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {r.kind === 'bonus' ? '+' : '−'}
                      {currency(r.amount)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-secondary text-xs px-2 py-1 text-rose-700"
                        onClick={() => setDeleteId({ id: r.id, kind: r.kind })}
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
        title={form.kind === 'bonus' ? 'Add bonus' : 'Other deduction'}
        size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setModal(false)}>
              Cancel
            </button>
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
            {selectedStaff ? (
              <p className="mt-1 text-[11px] text-soul-muted">
                Salary {currency(selectedStaff.base_salary)} · daily rate {currency(rate)} (÷ 30)
              </p>
            ) : null}
          </div>
          <div className="form-grid">
            {form.kind !== 'bonus' ? (
            <div>
              <label className="label">Type *</label>
              <select
                className="input"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                <option value="other">Other</option>
                <option value="penalty">Penalty</option>
                <option value="performance">Performance</option>
                <option value="advance">Advance</option>
              </select>
            </div>
            ) : null}
            <div>
              <label className="label">Date *</label>
              <input
                type="date"
                className="input"
                value={form.deduction_date}
                onChange={(e) => setForm((f) => ({ ...f, deduction_date: e.target.value }))}
              />
            </div>
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
            />
          </div>
          <div>
            <label className="label">Reason *</label>
            <textarea
              className="input min-h-[72px]"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
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
        message={
          deleteId?.kind === 'bonus'
            ? 'This bonus will no longer count on the payslip for that date.'
            : 'This deduction will no longer count against payroll for that date.'
        }
        onConfirm={() => deleteMutation.mutate(deleteId)}
      />
    </div>
  );
}
