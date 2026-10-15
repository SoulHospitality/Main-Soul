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
  all: 'Everyone',
  reservations: 'Reservations team',
  operations: 'Operations team',
  acquisition: 'Unit acquisition team',
};

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function formatDay(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatActual(kpi) {
  if (kpi.metric === 'reviews') {
    if (kpi.actual == null) return 'No reviews yet';
    return `${kpi.actual} average · ${kpi.review_count} review${kpi.review_count === 1 ? '' : 's'}`;
  }
  if (kpi.measure === 'value') return currency(kpi.actual);
  return String(kpi.actual ?? 0);
}

function formatTarget(kpi) {
  if (kpi.metric === 'reviews') return `${kpi.target_value} average`;
  if (kpi.measure === 'value') return currency(kpi.target_value);
  if (kpi.metric === 'unit_acquisitions') return `${kpi.target_value} units`;
  return `${kpi.target_value} reservations`;
}

function emptyForm(metrics, teamKeys) {
  const metric = metrics[0]?.key || 'reservations';
  const measure = metrics[0]?.measures?.[0]?.key || 'count';
  return {
    metric,
    measure,
    target_value: metric === 'reviews' ? '4.5' : '100',
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
  const [selectedStaffId, setSelectedStaffId] = useState(null);
  const [selectedKpiId, setSelectedKpiId] = useState(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['kpi'],
    queryFn: () => api.get('/kpi').then((r) => r.data),
  });

  const metrics = data?.metrics || [];
  const teamKeys = data?.team_keys || [];
  const staff = data?.staff || [];
  const [form, setForm] = useState(null);

  const create = useMutation({
    mutationFn: (payload) => api.post('/kpi', payload).then((r) => r.data),
    onSuccess: () => {
      toast.success('KPI added');
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['kpi'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not add the KPI'),
  });

  const remove = useMutation({
    mutationFn: ({ id, staffId }) => api.delete(`/kpi/${id}`, { params: { staff_id: staffId } }).then((r) => r.data),
    onSuccess: () => {
      toast.success('KPI removed');
      qc.invalidateQueries({ queryKey: ['kpi'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not remove the KPI'),
  });

  const selectedStaff = useMemo(
    () => staff.find((person) => String(person.id) === String(selectedStaffId)) || staff[0] || null,
    [staff, selectedStaffId]
  );
  const selectedKpi = selectedStaff?.kpis?.find((kpi) => kpi.id === selectedKpiId) || selectedStaff?.kpis?.[0] || null;
  const selectedMetric = metrics.find((item) => item.key === form?.metric);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <EmptyState title={error.response?.data?.error || 'Could not load KPIs'} />;

  function openForm() {
    setForm(emptyForm(metrics, teamKeys));
    setOpen(true);
  }

  function changeMetric(metric) {
    const next = metrics.find((item) => item.key === metric);
    const measure = next?.measures?.[0]?.key || 'count';
    setForm((current) => ({
      ...current,
      metric,
      measure,
      target_value: metric === 'reviews' ? '4.5' : '100',
    }));
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
      measure: form.measure,
      target_value: Number(form.target_value),
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
            Each person carries their own targets. The result is calculated from reservations, units they add, or the average rating of guests they checked in.
          </p>
        </div>
        {data.can_manage ? (
          <button type="button" className="btn-primary" onClick={openForm}>Add KPI</button>
        ) : null}
      </div>

      {!staff.length ? (
        <EmptyState title="No staff to show" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="space-y-2">
            {staff.map((person) => (
              <button
                key={person.id}
                type="button"
                onClick={() => {
                  setSelectedStaffId(person.id);
                  setSelectedKpiId(null);
                }}
                className={`card w-full p-4 text-left ${selectedStaff?.id === person.id ? 'ring-2 ring-[var(--pms-accent,#F28C28)]' : ''}`}
              >
                <p className="font-semibold text-soul-blue">{person.full_name}</p>
                <p className="text-xs text-soul-muted mt-1">
                  {ROLE_LABELS[person.role] || person.role}
                  {' · '}
                  {person.kpis.length} KPI{person.kpis.length === 1 ? '' : 's'}
                </p>
              </button>
            ))}
          </div>

          {selectedStaff ? (
            <section className="space-y-4">
              <div>
                <h2 className="font-semibold text-soul-blue">{selectedStaff.full_name}</h2>
                <p className="text-sm text-soul-muted">{ROLE_LABELS[selectedStaff.role] || selectedStaff.role}</p>
              </div>
              {!selectedStaff.kpis.length ? (
                <EmptyState title="No KPIs yet" subtitle="A manager adds targets for this person from this page." />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {selectedStaff.kpis.map((kpi) => (
                      <button
                        key={kpi.id}
                        type="button"
                        onClick={() => setSelectedKpiId(kpi.id)}
                        className={`card p-4 text-left ${selectedKpi?.id === kpi.id ? 'ring-2 ring-[var(--pms-accent,#F28C28)]' : ''}`}
                      >
                        <p className="font-semibold text-soul-blue">{kpi.metric_label}</p>
                        <p className="text-xs text-soul-muted mt-1">{kpi.measure_label} · {formatTarget(kpi)}</p>
                        <p className="mt-2 text-sm">{formatActual(kpi)} · {kpi.percent}%</p>
                      </button>
                    ))}
                  </div>
                  {selectedKpi ? (
                    <KpiDetail
                      kpi={selectedKpi}
                      onDelete={() => remove.mutate({ id: selectedKpi.id, staffId: selectedStaff.id })}
                      deleting={remove.isPending}
                    />
                  ) : null}
                </>
              )}
            </section>
          ) : null}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a KPI"
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" form="kpi-form" className="btn-primary" disabled={create.isPending}>Save KPI</button>
          </>
        }
      >
        {form ? (
          <form id="kpi-form" className="space-y-4" onSubmit={submit}>
            <div>
              <label className="label">Type</label>
              <select className="input" value={form.metric} onChange={(event) => changeMetric(event.target.value)}>
                {metrics.map((item) => (
                  <option key={item.key} value={item.key}>{item.label}</option>
                ))}
              </select>
            </div>

            {selectedMetric?.measures?.length > 1 ? (
              <div>
                <label className="label">Measure</label>
                <div className="flex flex-wrap gap-4 text-sm">
                  {selectedMetric.measures.map((item) => (
                    <label key={item.key} className="inline-flex items-center gap-2">
                      <input
                        type="radio"
                        name="kpi-measure"
                        checked={form.measure === item.key}
                        onChange={() => setForm((current) => ({ ...current, measure: item.key }))}
                      />
                      {item.key === 'count' ? 'Number of reservations' : 'Total value of reservations'}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">
                  {form.metric === 'reviews'
                    ? 'Target average rating'
                    : form.measure === 'value'
                      ? 'Target value (EGP)'
                      : form.metric === 'unit_acquisitions'
                        ? 'Units to add'
                        : 'Number of reservations'}
                </label>
                <input
                  className="input"
                  type="number"
                  min={form.metric === 'reviews' ? '1' : '1'}
                  max={form.metric === 'reviews' ? '5' : undefined}
                  step={form.metric === 'reviews' || form.measure === 'value' ? '0.1' : '1'}
                  required
                  value={form.target_value}
                  onChange={(event) => setForm((current) => ({ ...current, target_value: event.target.value }))}
                />
              </div>
              <div>
                <label className="label">Starts</label>
                <input className="input" type="date" required value={form.starts_on} onChange={(event) => setForm((current) => ({ ...current, starts_on: event.target.value }))} />
              </div>
              <div>
                <label className="label">Deadline</label>
                <input className="input" type="date" required value={form.deadline} onChange={(event) => setForm((current) => ({ ...current, deadline: event.target.value }))} />
              </div>
            </div>

            <p className="text-xs text-soul-muted">
              {form.metric === 'reviews'
                ? 'Only reviews from a guest who reserved that unit count. The average is given to the person who checked them in.'
                : form.metric === 'unit_acquisitions'
                  ? 'Counts units this person adds during the period.'
                  : 'Counts reservations this person makes during the period.'}
            </p>

            <div>
              <label className="label">Assign to</label>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="kpi-scope" checked={form.scope === 'team'} onChange={() => setForm((current) => ({ ...current, scope: 'team' }))} />
                  Whole team
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="kpi-scope" checked={form.scope === 'staff'} onChange={() => setForm((current) => ({ ...current, scope: 'staff' }))} />
                  Selected people
                </label>
              </div>
            </div>

            {form.scope === 'team' && teamKeys.length > 1 ? (
              <div>
                <label className="label">Team</label>
                <select className="input" value={form.team_key} onChange={(event) => setForm((current) => ({ ...current, team_key: event.target.value }))}>
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
                    <input type="checkbox" checked={form.staff_ids.includes(person.id)} onChange={() => toggleStaff(person.id)} />
                    <span>{person.full_name}</span>
                    <span className="text-soul-muted">{ROLE_LABELS[person.role] || person.role}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-soul-muted">
                {teamKeys.length === 1 ? 'This goes to everyone who reports to you.' : 'This goes to every active person in the team you chose.'}
              </p>
            )}
          </form>
        ) : null}
      </Modal>
    </div>
  );
}

function KpiDetail({ kpi, onDelete, deleting }) {
  return (
    <section className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-soul-line flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-soul-blue">{kpi.metric_label}</h3>
          <p className="text-sm text-soul-muted mt-1">
            {formatDay(kpi.starts_on)} to {formatDay(kpi.deadline)}. Target {formatTarget(kpi)}. Result {formatActual(kpi)} ({kpi.percent}%).
          </p>
          {kpi.created_by_name ? <p className="text-xs text-soul-muted mt-1">Added by {kpi.created_by_name}</p> : null}
        </div>
        {kpi.can_delete ? (
          <button type="button" className="btn-secondary" onClick={onDelete} disabled={deleting}>Remove</button>
        ) : null}
      </div>
      <div className="px-5 py-4">
        <h4 className="font-semibold text-soul-blue">Daily performance</h4>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-soul-muted">
                <th className="py-2 pr-3 font-medium">Day</th>
                <th className="py-2 font-medium text-right">{kpi.metric === 'reviews' ? 'Average' : 'Result'}</th>
              </tr>
            </thead>
            <tbody>
              {(kpi.daily || []).map((day) => (
                <tr key={day.date} className="border-t border-soul-line/70">
                  <td className="py-2 pr-3 text-soul-muted">{formatDay(day.date)}</td>
                  <td className="py-2 text-right tabular-nums">
                    {kpi.measure === 'value' ? currency(day.value) : day.value}
                    {kpi.metric === 'reviews' && day.count ? ` · ${day.count}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!kpi.daily?.length ? <p className="text-sm text-soul-muted">No days in this KPI yet.</p> : null}
        </div>
      </div>
    </section>
  );
}
