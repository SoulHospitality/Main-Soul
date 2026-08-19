import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Modal from '../components/ui/Modal';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import { ROLE_LABELS, canAccess } from '../utils/permissions';
import { currency, formatDate } from '../utils/formatters';
import { useAuth } from '../context/AuthContext';

export default function Loans() {
  const { user } = useAuth();
  const isHr = canAccess(user, 'payroll');
  const qc = useQueryClient();
  const [status, setStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [rejectRow, setRejectRow] = useState(null);
  const [note, setNote] = useState('');
  const [form, setForm] = useState({ amount: '', reason: '' });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['hr-loans', status, isHr],
    queryFn: () =>
      api
        .get('/hr/loans', {
          params: {
            ...(status === 'all' ? {} : { status }),
            ...(!isHr ? { mine: 1 } : {}),
          },
        })
        .then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (payload) => api.post('/hr/loans', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-loans'] });
      toast.success('Loan request sent to HR');
      setForm({ amount: '', reason: '' });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not submit loan'),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, status: next, review_note }) =>
      api.post(`/hr/loans/${id}/review`, { status: next, review_note }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['hr-loans'] });
      qc.invalidateQueries({ queryKey: ['hr-deductions'] });
      qc.invalidateQueries({ queryKey: ['hr-payroll'] });
      toast.success(vars.status === 'approved' ? 'Loan approved — deducted next month' : 'Loan rejected');
      setRejectRow(null);
      setNote('');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not update request'),
  });

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      (Array.isArray(rows) ? rows : []).filter((r) => {
        if (!q) return true;
        return [r.full_name, r.staff_code, r.reason]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q);
      }),
    [rows, q]
  );

  return (
    <div className="space-y-6">
      <div className="page-header">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-soul-muted">HR</p>
        <h1 className="page-title mt-1">Loans</h1>
        <p className="page-subtitle">
          Request a loan. If HR accepts it, the amount is deducted from next month’s salary.
        </p>
      </div>

      <div className="card space-y-3">
        <h3 className="font-semibold text-soul-blue">Request a loan</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <div className="sm:col-span-2">
            <label className="label">Reason *</label>
            <textarea
              className="input min-h-[72px]"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </div>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={createMutation.isPending}
          onClick={() => {
            if (!(Number(form.amount) > 0)) return toast.error('Enter an amount');
            if (!form.reason.trim()) return toast.error('Enter a reason');
            createMutation.mutate({ amount: Number(form.amount), reason: form.reason.trim() });
          }}
        >
          {createMutation.isPending ? 'Sending…' : 'Send request'}
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchFilter value={search} onChange={setSearch} placeholder="Search loans…" />
        <select className="input sm:w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Banknote} title="No loan requests" />
      ) : (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Amount</th>
                  <th>Reason</th>
                  <th>Payroll month</th>
                  <th>Status</th>
                  {isHr ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="font-semibold text-soul-blue">{r.full_name}</div>
                      <div className="text-[11px] text-soul-muted">
                        {r.staff_code ? `${r.staff_code} · ` : ''}
                        {ROLE_LABELS[r.role] || r.role}
                      </div>
                    </td>
                    <td className="tabular-nums font-semibold">{currency(r.amount)}</td>
                    <td className="max-w-[16rem]"><span className="line-clamp-2">{r.reason}</span></td>
                    <td className="whitespace-nowrap text-soul-muted">
                      {r.deduct_year && r.deduct_month
                        ? `${r.deduct_year}-${String(r.deduct_month).padStart(2, '0')}`
                        : '—'}
                    </td>
                    <td className="capitalize">{r.status}</td>
                    {isHr ? (
                      <td>
                        {r.status === 'pending' ? (
                          <div className="flex gap-1">
                            <button
                              type="button"
                              className="btn-secondary text-xs px-2 py-1 text-emerald-700"
                              onClick={() => reviewMutation.mutate({ id: r.id, status: 'approved' })}
                            >
                              <Check className="h-3.5 w-3.5" />
                              Accept
                            </button>
                            <button
                              type="button"
                              className="btn-secondary text-xs px-2 py-1 text-rose-700"
                              onClick={() => {
                                setRejectRow(r);
                                setNote('');
                              }}
                            >
                              <X className="h-3.5 w-3.5" />
                              Reject
                            </button>
                          </div>
                        ) : r.reviewed_by_name ? (
                          <span className="text-[11px] text-soul-muted">{r.reviewed_by_name}</span>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={!!rejectRow}
        onClose={() => setRejectRow(null)}
        title="Reject loan"
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setRejectRow(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={reviewMutation.isPending}
              onClick={() =>
                reviewMutation.mutate({
                  id: rejectRow.id,
                  status: 'rejected',
                  review_note: note.trim() || undefined,
                })
              }
            >
              Reject
            </button>
          </>
        }
      >
        <p className="text-sm text-soul-muted mb-3">
          Reject {rejectRow?.full_name}’s loan of {rejectRow ? currency(rejectRow.amount) : ''}?
        </p>
        <label className="label">Note (optional)</label>
        <textarea className="input min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </div>
  );
}
