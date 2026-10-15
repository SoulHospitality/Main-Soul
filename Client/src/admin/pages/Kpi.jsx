import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import { ROLE_LABELS } from '../utils/permissions';
import { currency } from '../utils/formatters';

const TEAM_LABELS = {
  mine: 'My team',
  reservations: 'Reservations team',
  operations: 'Operations team',
  all: 'Everyone',
};

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function formatDay(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function emptyForm(metrics, teamKeys) {
  return {
    metric: metrics[0]?.key || 'reservations',
    target_value: '100',
    reward_amount: '1000',
    min_percent: '50',
    starts_on: todayInput(),
    deadline: '',
    scope: 'team',
    team_key: teamKeys[0] || 'mine',
    staff_ids: [],
  };
}

export default function Kpi() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['kpi'],
    queryFn: () => api.get('/kpi').then((r) => r.data),
  });

  const metrics = data?.metrics || [];
  const teamKeys = data?.team_keys || [];
  const [form, setForm] = useState(null);

  const create = useMutation({
    mutationFn: (payload) => api.post('/kpi', payload).then((r) => r.data),
    onSuccess: () => {
      toast.success('Target added');
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['kpi'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not add the target'),
  });

  const apply = useMutation({
    mutationFn: (id) => api.post(`/kpi/${id}/apply`).then((r) => r.data),
    onSuccess: () => {
      toast.success('Bonuses added to payroll');
      qc.invalidateQueries({ queryKey: ['kpi'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not add the bonuses'),
  });

  const remove = useMutation({
    mutationFn: (id) => api.delete(`/kpi/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast.success('Target removed');
      qc.invalidateQueries({ queryKey: ['kpi'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not remove the target'),
  });

  const targets = data?.targets || [];
  const selected = useMemo(
    () => targets.find((item) => item.id === selectedId) || targets[0] || null,
    [targets, selectedId]
  );

  if (isLoading) return <LoadingSpinner />;
  if (error) {
    return <EmptyState title={error.response?.data?.error || 'Could not load KPI'} />;
  }

  function openForm() {
    setForm(emptyForm(metrics, teamKeys));
    setOpen(true);
  }

  function toggleStaff(id) {
    setForm((current) => {
      const has = current.staff_ids.includes(id);
      return {
        ...current,
        staff_ids: has ? current.staff_ids.filter((item) => item !== id) : [...current.staff_ids, id],
      };
    });
  }

  function submit(event) {
    event.preventDefault();
    create.mutate({
      metric: form.metric,
      target_value: Number(form.target_value),
      reward_amount: Number(form.reward_amount),
      min_percent: Number(form.min_percent),
      starts_on: form.starts_on,
      deadline: form.deadline,
      scope: form.scope,
      team_key: form.team_key,
      staff_ids: form.staff_ids,
    });
  }

  return (
    <div className="space-y-6">
      <div className="page-header mb-0 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">KPI</h1>
          <p className="page-subtitle">
            Targets for the team. Each person earns the same share of the reward as the share of the target they finish. Below the minimum, the bonus is zero.
          </p>
        </div>
        {data.can_manage ? (
          <button type="button" className="btn-primary" onClick={openForm}>
            Add target
          </button>
        ) : null}
      </div>

      {!targets.length ? (
        <EmptyState title="No targets yet" subtitle="When a manager assigns a target, progress and the bonus appear here." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <div className="space-y-3">
            {targets.map((target) => (
              <button
                key={target.id}
                type="button"
                onClick={() => setSelectedId(target.id)}
                className={`card w-full p-4 text-left ${selected?.id === target.id ? 'ring-2 ring-[var(--pms-accent,#F28C28)]' : ''}`}
              >
                <p className="font-semibold text-soul-blue">{target.metric_label}</p>
                <p className="text-sm text-soul-muted mt-1">
                  {target.target_value} by {formatDay(target.deadline)} · {currency(target.reward_amount)}
                </p>
                <p className="text-xs text-soul-muted mt-1">
                  Minimum {target.min_percent}% · {target.assignees.length} {target.assignees.length === 1 ? 'person' : 'people'}
                </p>
              </button>
            ))}
          </div>

          {selected ? (
            <TargetDetail
              target={selected}
              onApply={() => apply.mutate(selected.id)}
              applying={apply.isPending}
              onDelete={() => remove.mutate(selected.id)}
              deleting={remove.isPending}
            />
          ) : null}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a target"
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="kpi-form" className="btn-primary" disabled={create.isPending}>
              Save target
            </button>
          </>
        }
      >
        {form ? (
          <form id="kpi-form" className="space-y-4" onSubmit={submit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">What to count</label>
                <select
                  className="input"
                  value={form.metric}
                  onChange={(event) => setForm((current) => ({ ...current, metric: event.target.value }))}
                >
                  {metrics.map((item) => (
                    <option key={item.key} value={item.key}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Target</label>
                <input
                  className="input"
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={form.target_value}
                  onChange={(event) => setForm((current) => ({ ...current, target_value: event.target.value }))}
                />
              </div>
              <div>
                <label className="label">Reward (EGP)</label>
                <input
                  className="input"
                  type="number"
                  min="1"
                  step="0.01"
                  required
                  value={form.reward_amount}
                  onChange={(event) => setForm((current) => ({ ...current, reward_amount: event.target.value }))}
                />
              </div>
              <div>
                <label className="label">Minimum to earn anything (%)</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  required
                  value={form.min_percent}
                  onChange={(event) => setForm((current) => ({ ...current, min_percent: event.target.value }))}
                />
              </div>
              <div>
                <label className="label">Starts</label>
                <input
                  className="input"
                  type="date"
                  required
                  value={form.starts_on}
                  onChange={(event) => setForm((current) => ({ ...current, starts_on: event.target.value }))}
                />
              </div>
              <div>
                <label className="label">Deadline</label>
                <input
                  className="input"
                  type="date"
                  required
                  value={form.deadline}
                  onChange={(event) => setForm((current) => ({ ...current, deadline: event.target.value }))}
                />
              </div>
            </div>

            <div>
              <label className="label">Assign to</label>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="kpi-scope"
                    checked={form.scope === 'team'}
                    onChange={() => setForm((current) => ({ ...current, scope: 'team' }))}
                  />
                  Whole team
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="kpi-scope"
                    checked={form.scope === 'staff'}
                    onChange={() => setForm((current) => ({ ...current, scope: 'staff' }))}
                  />
                  Selected people
                </label>
              </div>
            </div>

            {form.scope === 'team' && teamKeys.length > 1 ? (
              <div>
                <label className="label">Team</label>
                <select
                  className="input"
                  value={form.team_key}
                  onChange={(event) => setForm((current) => ({ ...current, team_key: event.target.value }))}
                >
                  {teamKeys.map((key) => (
                    <option key={key} value={key}>{TEAM_LABELS[key] || key}</option>
                  ))}
                </select>
              </div>
            ) : null}

            {form.scope === 'staff' ? (
              <div className="max-h-56 overflow-y-auto rounded-xl border border-soul-line divide-y divide-soul-line/70">
                {(data.team || []).map((person) => (
                  <label key={person.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.staff_ids.includes(person.id)}
                      onChange={() => toggleStaff(person.id)}
                    />
                    <span>{person.full_name}</span>
                    <span className="text-soul-muted">{ROLE_LABELS[person.role] || person.role}</span>
                  </label>
                ))}
                {!data.team?.length ? <p className="px-3 py-4 text-sm text-soul-muted">No one on your team yet.</p> : null}
              </div>
            ) : (
              <p className="text-xs text-soul-muted">
                {form.team_key === 'mine' || teamKeys.length === 1
                  ? 'This goes to everyone who reports to you.'
                  : 'This goes to every active person in the team you chose.'}
              </p>
            )}
          </form>
        ) : null}
      </Modal>
    </div>
  );
}

function TargetDetail({ target, onApply, applying, onDelete, deleting }) {
  return (
    <section className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-soul-line flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-soul-blue">
            {target.target_value} {target.metric_label.toLowerCase()}
          </h2>
          <p className="text-sm text-soul-muted mt-1">
            {formatDay(target.starts_on)} to {formatDay(target.deadline)}. Reward {currency(target.reward_amount)}. Below {target.min_percent}% pays nothing.
          </p>
          {target.created_by_name ? (
            <p className="text-xs text-soul-muted mt-1">Added by {target.created_by_name}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          {target.can_apply ? (
            <button type="button" className="btn-primary" onClick={onApply} disabled={applying}>
              Add bonuses
            </button>
          ) : null}
          {target.can_delete ? (
            <button type="button" className="btn-secondary" onClick={onDelete} disabled={deleting}>
              Remove
            </button>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-soul-muted border-b border-soul-line">
              <th className="px-5 py-3 font-medium">Person</th>
              <th className="px-3 py-3 font-medium text-right">Done</th>
              <th className="px-3 py-3 font-medium text-right">Share</th>
              <th className="px-5 py-3 font-medium text-right">Bonus</th>
            </tr>
          </thead>
          <tbody>
            {target.assignees.map((person) => (
              <tr key={person.staff_user_id} className="border-b border-soul-line/70">
                <td className="px-5 py-3">
                  <div className="font-medium">{person.full_name}</div>
                  <div className="text-xs text-soul-muted">{ROLE_LABELS[person.role] || person.role}</div>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{person.count} / {target.target_value}</td>
                <td className="px-3 py-3 text-right tabular-nums">{person.percent}%</td>
                <td className="px-5 py-3 text-right tabular-nums">
                  {currency(person.bonus)}
                  {person.applied ? <div className="text-xs text-soul-muted">On payslip</div> : null}
                  {!person.applied && !person.eligible ? <div className="text-xs text-soul-muted">Below minimum</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-4 border-t border-soul-line">
        <h3 className="font-semibold text-soul-blue">Daily performance</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-soul-muted">
                <th className="py-2 pr-3 font-medium">Day</th>
                {target.assignees.map((person) => (
                  <th key={person.staff_user_id} className="py-2 px-3 font-medium text-right">{person.full_name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(target.days || []).map((day) => (
                <tr key={day} className="border-t border-soul-line/70">
                  <td className="py-2 pr-3 text-soul-muted">{formatDay(day)}</td>
                  {target.assignees.map((person) => {
                    const cell = (person.daily || []).find((item) => item.date === day);
                    return (
                      <td key={person.staff_user_id} className="py-2 px-3 text-right tabular-nums">
                        {cell?.count || 0}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {!target.days?.length ? <p className="text-sm text-soul-muted">No days in this target yet.</p> : null}
        </div>
      </div>
    </section>
  );
}
