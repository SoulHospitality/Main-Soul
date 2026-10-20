import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';

function minutesLabel(value) {
  if (value == null || value === '') return '';
  const minutes = Number(value);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export default function HrRules() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState({ label: '', factor: '1' });
  const { data, isLoading, error } = useQuery({
    queryKey: ['hr-deduction-rules'],
    queryFn: () => api.get('/hr/deduction-rules').then((r) => r.data),
  });

  const save = useMutation({
    mutationFn: (row) => api.put(`/hr/deduction-rules/${row.id}`, row).then((r) => r.data),
    onSuccess: () => {
      toast.success('Rule updated');
      qc.invalidateQueries({ queryKey: ['hr-deduction-rules'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not update the rule'),
  });

  const create = useMutation({
    mutationFn: (row) => api.post('/hr/deduction-rules', row).then((r) => r.data),
    onSuccess: () => {
      toast.success('Rule added');
      setDraft({ label: '', factor: '1' });
      qc.invalidateQueries({ queryKey: ['hr-deduction-rules'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not add the rule'),
  });

  if (isLoading) return <LoadingSpinner />;
  if (error) return <EmptyState title={error.response?.data?.error || 'Could not load HR rules'} />;

  const rows = Array.isArray(data) ? data : [];

  return (
    <div className="space-y-6">
      <div className="page-header mb-0">
        <h1 className="page-title">HR rules</h1>
        <p className="page-subtitle">
          Deduction rules are a multiple of the daily rate. Late bands use the arrival time. A new rule is kept here for payroll to apply by name.
        </p>
      </div>
      <section className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-soul-muted border-b border-soul-line">
              <th className="px-5 py-3 font-medium">Rule</th>
              <th className="px-3 py-3 font-medium">Kind</th>
              <th className="px-3 py-3 font-medium">Until</th>
              <th className="px-3 py-3 font-medium">Daily rate ×</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <RuleRow key={row.id} row={row} onSave={(next) => save.mutate(next)} saving={save.isPending} />
            ))}
          </tbody>
        </table>
      </section>
      <form
        className="card p-5 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate({ label: draft.label, factor: Number(draft.factor) });
        }}
      >
        <div>
          <label className="label">New rule</label>
          <input className="input" required value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} />
        </div>
        <div>
          <label className="label">Daily rate ×</label>
          <input className="input w-28" type="number" min="0" max="10" step="0.05" required value={draft.factor} onChange={(event) => setDraft((current) => ({ ...current, factor: event.target.value }))} />
        </div>
        <button type="submit" className="btn-primary" disabled={create.isPending}>Add rule</button>
      </form>
    </div>
  );
}

function RuleRow({ row, onSave, saving }) {
  const [label, setLabel] = useState(row.label);
  const [factor, setFactor] = useState(String(row.factor));
  return (
    <tr className="border-b border-soul-line/70">
      <td className="px-5 py-3">
        <input className="input" value={label} onChange={(event) => setLabel(event.target.value)} />
      </td>
      <td className="px-3 py-3 text-soul-muted">{row.kind}</td>
      <td className="px-3 py-3 text-soul-muted">{row.kind === 'lateness' ? minutesLabel(row.end_minutes) : '—'}</td>
      <td className="px-3 py-3">
        <input className="input w-24" type="number" min="0" max="10" step="0.05" value={factor} onChange={(event) => setFactor(event.target.value)} />
      </td>
      <td className="px-5 py-3 text-right">
        <button type="button" className="btn-secondary" disabled={saving} onClick={() => onSave({ id: row.id, label, factor: Number(factor), end_minutes: row.end_minutes, active: row.active })}>
          Save
        </button>
      </td>
    </tr>
  );
}
