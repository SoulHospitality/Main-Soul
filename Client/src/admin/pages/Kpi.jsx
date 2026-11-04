import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import { ROLE_LABELS } from '../utils/permissions';
import { useAuth } from '../context/AuthContext';
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
  if (kpi.metric === 'check_ins') return `${kpi.target_value} check-ins`;
  return `${kpi.target_value} reservations`;
}

function formatAmount(kpi, value) {
  if (value == null) return '—';
  if (kpi.measure === 'value') return currency(value);
  return String(Math.round(Number(value) * 10) / 10);
}

const STATUS_STYLES = {
  not_started: 'bg-slate-100 text-slate-600',
  early: 'bg-slate-100 text-slate-700',
  on_track: 'bg-emerald-50 text-emerald-800',
  at_risk: 'bg-amber-50 text-amber-800',
  behind: 'bg-rose-50 text-rose-800',
  achieved: 'bg-emerald-600 text-white',
  missed: 'bg-rose-600 text-white',
};

const BAR_STYLES = {
  on_track: 'bg-emerald-500',
  achieved: 'bg-emerald-600',
  at_risk: 'bg-amber-500',
  behind: 'bg-rose-500',
  missed: 'bg-rose-600',
};

function StatusChip({ kpi }) {
  return (
    <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[kpi.status] || STATUS_STYLES.early}`}>
      {kpi.status_label || kpi.status}
    </span>
  );
}

function Importance({ weight }) {
  const w = Number(weight) || 1;
  return (
    <span className="text-[11px] text-soul-muted" title={`Importance ${w} of 5`}>
      {'●'.repeat(w)}
      <span className="opacity-30">{'●'.repeat(5 - w)}</span>
    </span>
  );
}

/** Progress bar with a marker for where the KPI should be by today. */
function PaceBar({ kpi }) {
  const shown = Math.min(100, Math.max(0, Number(kpi.percent) || 0));
  const expected = kpi.metric === 'reviews' ? null : kpi.pace?.expected_percent;
  return (
    <div className="relative mt-2 h-2 rounded-full bg-slate-100" aria-hidden="true">
      <div className={`h-2 rounded-full ${BAR_STYLES[kpi.status] || 'bg-slate-400'}`} style={{ width: `${shown}%` }} />
      {expected != null && kpi.status !== 'not_started' && expected < 100 ? (
        <span className="absolute -top-1 h-4 w-0.5 rounded bg-soul-blue/70" style={{ left: `${Math.min(100, expected)}%` }} title="Expected by today" />
      ) : null}
    </div>
  );
}

function paceLine(kpi) {
  const p = kpi.pace || {};
  if (kpi.status === 'not_started') return `Starts ${formatDay(kpi.starts_on)}`;
  if (kpi.metric === 'reviews') {
    if (kpi.status === 'early') return `Needs at least ${p.min_reviews || 3} reviews to judge · ${p.days_left} days left`;
    return `${p.days_left ? `${p.days_left} days left` : 'Ended'}`;
  }
  const parts = [];
  if (p.days_left) parts.push(`Expected by today ${formatAmount(kpi, p.expected)}`);
  if (p.days_left && p.projected != null) parts.push(`on pace for ${formatAmount(kpi, p.projected)}`);
  if (p.needed_per_day && kpi.status !== 'achieved') parts.push(`needs ${formatAmount(kpi, p.needed_per_day)}/day`);
  parts.push(p.days_left ? `${p.days_left} days left` : 'ended');
  return parts.join(' · ');
}

function ScoreRing({ score }) {
  if (score == null) return <span className="text-sm text-soul-muted">—</span>;
  const tone = score >= 90 ? 'text-emerald-700' : score >= 70 ? 'text-amber-700' : 'text-rose-700';
  return <span className={`font-display text-xl tabular-nums ${tone}`}>{Math.round(score)}%</span>;
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
    title: '',
    weight: 1,
    notes: '',
  };
}

export default function Kpi() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
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
      title: form.title,
      weight: Number(form.weight) || 1,
      notes: form.notes,
    });
  }

  const scored = staff.filter((person) => person.score != null);
  const teamScore = scored.length ? scored.reduce((sum, person) => sum + person.score, 0) / scored.length : null;
  const teamCounts = staff.reduce((acc, person) => {
    for (const [key, value] of Object.entries(person.status_counts || {})) acc[key] = (acc[key] || 0) + value;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="page-header mb-0 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">KPI</h1>
          <p className="page-subtitle">
            Every KPI shows where it should be by today, where the current pace lands, and a status. A person’s score is
            the importance-weighted average of their running KPIs, each counted up to 100%.
          </p>
        </div>
        {data.can_manage ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={openForm}>Add KPI</button>
            <button type="button" className="btn-primary" onClick={() => setChecklistOpen(true)}>Add checklist</button>
          </div>
        ) : null}
      </div>

      {staff.length > 1 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-soul-muted">Team score</p>
            <p className="mt-1"><ScoreRing score={teamScore} /></p>
          </div>
          {[
            ['on_track', 'On track'],
            ['at_risk', 'At risk'],
            ['behind', 'Behind'],
            ['achieved', 'Achieved'],
          ].map(([key, label]) => (
            <div key={key} className="card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-soul-muted">{label}</p>
              <p className="mt-1 font-display text-xl tabular-nums text-soul-blue">{teamCounts[key] || 0}</p>
            </div>
          ))}
        </div>
      ) : null}

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
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-soul-blue">{person.full_name}</p>
                    <p className="text-xs text-soul-muted mt-1">
                      {ROLE_LABELS[person.role] || person.role}
                      {' · '}
                      {person.kpis.length} KPI{person.kpis.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <ScoreRing score={person.score} />
                </div>
                {Object.keys(person.status_counts || {}).length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.entries(person.status_counts).map(([key, count]) => (
                      <span key={key} className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[key] || ''}`}>
                        {count} {(data.statuses?.[key] || key).toLowerCase()}
                      </span>
                    ))}
                  </div>
                ) : null}
              </button>
            ))}
          </div>

          {selectedStaff ? (
            <section className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-soul-blue">{selectedStaff.full_name}</h2>
                  <p className="text-sm text-soul-muted">{ROLE_LABELS[selectedStaff.role] || selectedStaff.role}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-soul-muted">Current score ({selectedStaff.scored_kpis || 0} KPI{selectedStaff.scored_kpis === 1 ? '' : 's'})</p>
                  <ScoreRing score={selectedStaff.score} />
                </div>
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
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-soul-blue">{kpi.title || kpi.metric_label}</p>
                          <StatusChip kpi={kpi} />
                        </div>
                        <p className="text-xs text-soul-muted mt-1">
                          {kpi.title ? `${kpi.metric_label} · ` : ''}{kpi.measure_label} · {formatTarget(kpi)} · <Importance weight={kpi.weight} />
                        </p>
                        <p className="mt-2 text-sm">{formatActual(kpi)} · <span className="font-semibold">{kpi.percent}%</span></p>
                        <PaceBar kpi={kpi} />
                        <p className="text-[11px] text-soul-muted mt-1.5">{paceLine(kpi)}</p>
                        {kpi.checklist_weight ? (
                          <p className="text-xs text-soul-muted mt-1">Daily checklist is {kpi.checklist_weight}% of this KPI</p>
                        ) : null}
                      </button>
                    ))}
                  </div>
                  {selectedKpi ? (
                    <KpiDetail
                      kpi={selectedKpi}
                      staffId={selectedStaff.id}
                      today={data.today}
                      canManage={data.can_manage}
                      people={staff.filter((person) => person.kpis.some((item) => item.id === selectedKpi.id))}
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
            <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr]">
              <div>
                <label className="label">Name (optional)</label>
                <input className="input" placeholder="e.g. November bookings" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
              </div>
              <div>
                <label className="label">Importance</label>
                <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
                  {[1, 2, 3, 4, 5].map((w) => (
                    <button key={w} type="button" onClick={() => setForm((current) => ({ ...current, weight: w }))} className={`rounded-md px-3 py-1.5 text-xs font-medium ${Number(form.weight) === w ? 'bg-white text-soul-blue shadow-sm' : 'text-slate-500'}`}>
                      {w}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-soul-muted mt-1">How much it counts in the person’s score</p>
              </div>
            </div>
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
                        : form.metric === 'check_ins'
                          ? 'Check-ins to handle'
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
                  : form.metric === 'check_ins'
                    ? 'Counts check-ins this person hands over to guests during the period.'
                    : 'Counts reservations this person makes during the period.'}
            </p>
            <div>
              <label className="label">Notes (optional)</label>
              <textarea className="input min-h-[56px]" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
            </div>

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
      <PageChecklist
        open={checklistOpen}
        onClose={() => setChecklistOpen(false)}
        staff={staff}
      />
    </div>
  );
}

function PageChecklist({ open, onClose, staff }) {
  const qc = useQueryClient();
  const catalog = useMemo(() => {
    const map = new Map();
    for (const person of staff) {
      for (const kpi of person.kpis || []) {
        if (!map.has(kpi.id)) map.set(kpi.id, { ...kpi, people: [] });
        map.get(kpi.id).people.push(person);
      }
    }
    return [...map.values()];
  }, [staff]);
  const [form, setForm] = useState(null);
  const selected = catalog.find((kpi) => kpi.id === form?.kpi_id) || catalog[0] || null;

  useEffect(() => {
    if (!open) return;
    setForm({
      kpi_id: catalog[0]?.id || '',
      title: '',
      weight_percent: '20',
      items: [''],
      scope: 'all',
      staff_ids: [],
    });
  }, [open, catalog]);

  const createList = useMutation({
    mutationFn: (payload) => api.post(`/kpi/${payload.kpi_id}/checklists`, payload).then((r) => r.data),
    onSuccess: () => {
      toast.success('Checklist added');
      onClose();
      qc.invalidateQueries({ queryKey: ['kpi'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not add the checklist'),
  });

  function submit(event) {
    event.preventDefault();
    if (!selected) return;
    createList.mutate({
      kpi_id: selected.id,
      title: form.title,
      weight_percent: Number(form.weight_percent),
      items: form.items,
      scope: form.scope === 'staff' ? 'staff' : 'all',
      staff_ids: form.staff_ids,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a daily checklist"
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="kpi-page-checklist" className="btn-primary" disabled={createList.isPending || !selected}>Save checklist</button>
        </>
      }
    >
      {!catalog.length ? (
        <p className="text-sm text-soul-muted">Set a KPI amount for someone in User management first. The checklist is a share of that KPI.</p>
      ) : form ? (
        <form id="kpi-page-checklist" className="space-y-4" onSubmit={submit}>
          <div>
            <label className="label">KPI</label>
            <select
              className="input"
              value={form.kpi_id}
              onChange={(event) => setForm((current) => ({ ...current, kpi_id: Number(event.target.value), staff_ids: [] }))}
            >
              {catalog.map((kpi) => (
                <option key={kpi.id} value={kpi.id}>
                  {kpi.metric_label} · {formatTarget(kpi)} · {kpi.people.map((person) => person.full_name).join(', ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Name</label>
            <input className="input" required value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
          </div>
          <div>
            <label className="label">How much of this KPI</label>
            <input
              className="input"
              type="number"
              min="1"
              max={String(Math.max(1, 100 - (selected?.checklist_weight || 0)))}
              step="1"
              required
              value={form.weight_percent}
              onChange={(event) => setForm((current) => ({ ...current, weight_percent: event.target.value }))}
            />
            <p className="text-xs text-soul-muted mt-1">You choose the share. The rest stays on the KPI amount.</p>
          </div>
          <div className="space-y-2">
            <label className="label">Items to check each day</label>
            {form.items.map((item, index) => (
              <div key={index} className="flex gap-2">
                <input
                  className="input"
                  required
                  value={item}
                  onChange={(event) => setForm((current) => {
                    const items = current.items.slice();
                    items[index] = event.target.value;
                    return { ...current, items };
                  })}
                />
                {form.items.length > 1 ? (
                  <button type="button" className="btn-secondary" onClick={() => setForm((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }))}>
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
            {form.items.length < 12 ? (
              <button type="button" className="btn-secondary" onClick={() => setForm((current) => ({ ...current, items: [...current.items, ''] }))}>
                Add item
              </button>
            ) : null}
          </div>
          <div>
            <label className="label">Assign to</label>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="radio" checked={form.scope === 'all'} onChange={() => setForm((current) => ({ ...current, scope: 'all' }))} />
                Everyone on this KPI
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" checked={form.scope === 'staff'} onChange={() => setForm((current) => ({ ...current, scope: 'staff' }))} />
                Selected people
              </label>
            </div>
          </div>
          {form.scope === 'staff' && selected ? (
            <div className="max-h-56 overflow-y-auto rounded-xl border border-soul-line divide-y divide-soul-line/70">
              {selected.people.map((person) => (
                <label key={person.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.staff_ids.includes(person.id)}
                    onChange={() => setForm((current) => {
                      const has = current.staff_ids.includes(person.id);
                      return {
                        ...current,
                        staff_ids: has ? current.staff_ids.filter((id) => id !== person.id) : [...current.staff_ids, person.id],
                      };
                    })}
                  />
                  <span>{person.full_name}</span>
                </label>
              ))}
            </div>
          ) : null}
        </form>
      ) : null}
    </Modal>
  );
}

function KpiDetail({ kpi, staffId, today, canManage, people, onDelete, deleting }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(today && today >= kpi.starts_on && today <= kpi.deadline ? today : kpi.starts_on);
  const [form, setForm] = useState(null);
  const [edit, setEdit] = useState(null);

  const saveEdit = useMutation({
    mutationFn: (payload) => api.patch(`/kpi/${kpi.id}`, payload).then((r) => r.data),
    onSuccess: () => {
      toast.success('KPI updated');
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['kpi'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not update the KPI'),
  });
  const repeat = useMutation({
    mutationFn: () => api.post(`/kpi/${kpi.id}/repeat`).then((r) => r.data),
    onSuccess: (res) => {
      toast.success(`Repeated for ${formatDay(res.starts_on)} – ${formatDay(res.deadline)}`);
      qc.invalidateQueries({ queryKey: ['kpi'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not repeat the KPI'),
  });
  const yesterday = (() => {
    if (!today) return null;
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const workDays = new Set(kpi.work_days || []);

  const createList = useMutation({
    mutationFn: (payload) => api.post(`/kpi/${kpi.id}/checklists`, payload).then((r) => r.data),
    onSuccess: () => {
      toast.success('Checklist added');
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['kpi'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not add the checklist'),
  });
  const removeList = useMutation({
    mutationFn: (checklistId) => api.delete(`/kpi/${kpi.id}/checklists/${checklistId}`).then((r) => r.data),
    onSuccess: () => {
      toast.success('Checklist removed');
      qc.invalidateQueries({ queryKey: ['kpi'] });
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Could not remove the checklist'),
  });
  const tick = useMutation({
    mutationFn: (payload) => api.post(`/kpi/checklists/${payload.checklistId}/ticks`, payload).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kpi'] }),
    onError: (err) => toast.error(err.response?.data?.error || 'Could not update the checklist'),
  });

  function openForm() {
    setForm({
      title: '',
      weight_percent: '20',
      items: [''],
      scope: 'all',
      staff_ids: [],
    });
    setOpen(true);
  }

  function submit(event) {
    event.preventDefault();
    createList.mutate({
      title: form.title,
      weight_percent: Number(form.weight_percent),
      items: form.items,
      scope: form.scope === 'staff' ? 'staff' : 'all',
      staff_ids: form.staff_ids,
    });
  }

  const checklistByDate = new Map();
  for (const checklist of kpi.checklists || []) {
    for (const row of checklist.daily || []) {
      const current = checklistByDate.get(row.date) || { checked: 0, total: 0 };
      current.checked += row.checked;
      current.total += row.total;
      checklistByDate.set(row.date, current);
    }
  }

  return (
    <section className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-soul-line flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-soul-blue">{kpi.title || kpi.metric_label}</h3>
            <StatusChip kpi={kpi} />
            <Importance weight={kpi.weight} />
          </div>
          <p className="text-xs text-soul-muted mt-1">{paceLine(kpi)}</p>
          <p className="text-sm text-soul-muted mt-1">
            {formatDay(kpi.starts_on)} to {formatDay(kpi.deadline)}. Target {formatTarget(kpi)}. Result {formatActual(kpi)} ({kpi.metric_percent}% of the target).
          </p>
          {kpi.checklist_weight ? (
            <p className="text-sm text-soul-muted mt-1">
              The result is {Math.max(0, Math.round((100 - kpi.checklist_weight) * 10) / 10)}% of this KPI. The daily checklist is {kpi.checklist_weight}%. Overall {kpi.percent}%.
            </p>
          ) : (
            <p className="text-sm text-soul-muted mt-1">Overall {kpi.percent}%.</p>
          )}
          {kpi.notes ? <p className="text-xs italic text-soul-muted mt-1">{kpi.notes}</p> : null}
          {kpi.created_by_name ? <p className="text-xs text-soul-muted mt-1">Added by {kpi.created_by_name}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage ? (
            <button type="button" className="btn-primary" onClick={openForm}>Add checklist</button>
          ) : null}
          {kpi.can_delete ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setEdit({
                title: kpi.title || '',
                target_value: String(kpi.target_value),
                starts_on: kpi.starts_on,
                deadline: kpi.deadline,
                weight: kpi.weight || 1,
                notes: kpi.notes || '',
                measure: kpi.measure,
              })}
            >
              Edit
            </button>
          ) : null}
          {kpi.can_delete && canManage ? (
            <button type="button" className="btn-secondary" onClick={() => repeat.mutate()} disabled={repeat.isPending} title="Copy this KPI, its people and checklists into the next period">
              Repeat next period
            </button>
          ) : null}
          {kpi.can_delete ? (
            <button type="button" className="btn-secondary" onClick={onDelete} disabled={deleting}>Remove</button>
          ) : null}
        </div>
      </div>

      <div className="px-5 py-4 space-y-4 border-b border-soul-line">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h4 className="font-semibold text-soul-blue">Daily checklist</h4>
          <div>
            <label className="label">Day</label>
            <input
              className="input"
              type="date"
              min={kpi.starts_on}
              max={today && today < kpi.deadline ? today : kpi.deadline}
              value={day}
              onChange={(event) => setDay(event.target.value)}
            />
          </div>
        </div>
        {(kpi.checklists || []).length && day && !workDays.has(day) && day <= (today || day) ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-soul-muted">
            This is a day off or approved leave for this person, so it doesn’t count towards the checklist.
          </p>
        ) : null}
        {(kpi.checklists || []).length ? (
          kpi.checklists.map((checklist) => (
            <div key={checklist.id} className="rounded-xl border border-soul-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-soul-blue">{checklist.title}</p>
                  <p className="text-xs text-soul-muted mt-1">
                    {checklist.weight_percent}% of this KPI · {checklist.completion_percent}% of working days completed
                    {checklist.created_by_name ? ` · Added by ${checklist.created_by_name}` : ''}
                  </p>
                </div>
                {checklist.can_delete ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={removeList.isPending}
                    onClick={() => removeList.mutate(checklist.id)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <div className="mt-3 space-y-2">
                {checklist.items.map((item) => {
                  const checked = (item.checked_dates || []).includes(day);
                  // Staff tick today or yesterday; the manager who added the list can fix any day.
                  const canTick = Boolean(day)
                    && (!today || day <= today)
                    && (checklist.can_delete || (Number(user?.id) === Number(staffId) && (!yesterday || day >= yesterday)));
                  return (
                    <label key={item.id} className="flex items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!canTick || tick.isPending}
                        onChange={() => tick.mutate({
                          checklistId: checklist.id,
                          staff_id: staffId,
                          item_id: item.id,
                          date: day,
                          checked: !checked,
                        })}
                      />
                      <span>{item.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-soul-muted">No daily checklist on this KPI yet.</p>
        )}
      </div>

      <div className="px-5 py-4">
        <h4 className="font-semibold text-soul-blue">Daily performance</h4>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-soul-muted">
                <th className="py-2 pr-3 font-medium">Day</th>
                <th className="py-2 font-medium text-right">{kpi.metric === 'reviews' ? 'Average' : 'Result'}</th>
                {kpi.checklist_weight ? <th className="py-2 pl-3 font-medium text-right">Checklist</th> : null}
              </tr>
            </thead>
            <tbody>
              {(kpi.daily || []).map((row) => {
                const checks = checklistByDate.get(row.date);
                return (
                  <tr key={row.date} className="border-t border-soul-line/70">
                    <td className="py-2 pr-3 text-soul-muted">{formatDay(row.date)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {kpi.measure === 'value' ? currency(row.value) : row.value}
                      {kpi.metric === 'reviews' && row.count ? ` · ${row.count}` : ''}
                    </td>
                    {kpi.checklist_weight ? (
                      <td className="py-2 pl-3 text-right tabular-nums">
                        {checks ? `${checks.checked}/${checks.total}` : '—'}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!kpi.daily?.length ? <p className="text-sm text-soul-muted">No days in this KPI yet.</p> : null}
        </div>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a daily checklist"
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" form="kpi-checklist-form" className="btn-primary" disabled={createList.isPending}>Save checklist</button>
          </>
        }
      >
        {form ? (
          <form id="kpi-checklist-form" className="space-y-4" onSubmit={submit}>
            <div>
              <label className="label">Name</label>
              <input className="input" required value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
            </div>
            <div>
              <label className="label">How much of this KPI</label>
              <input
                className="input"
                type="number"
                min="1"
                max={String(Math.max(1, 100 - (kpi.checklist_weight || 0)))}
                step="1"
                required
                value={form.weight_percent}
                onChange={(event) => setForm((current) => ({ ...current, weight_percent: event.target.value }))}
              />
              <p className="text-xs text-soul-muted mt-1">
                {kpi.checklist_weight ? `${kpi.checklist_weight}% is already used. ` : ''}
                The rest of the KPI stays on {kpi.metric_label.toLowerCase()}.
              </p>
            </div>
            <div className="space-y-2">
              <label className="label">Items to check each day</label>
              {form.items.map((item, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    className="input"
                    required
                    value={item}
                    onChange={(event) => setForm((current) => {
                      const items = current.items.slice();
                      items[index] = event.target.value;
                      return { ...current, items };
                    })}
                  />
                  {form.items.length > 1 ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setForm((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }))}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              ))}
              {form.items.length < 12 ? (
                <button type="button" className="btn-secondary" onClick={() => setForm((current) => ({ ...current, items: [...current.items, ''] }))}>
                  Add item
                </button>
              ) : null}
            </div>
            <div>
              <label className="label">Assign to</label>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="checklist-scope" checked={form.scope === 'all'} onChange={() => setForm((current) => ({ ...current, scope: 'all' }))} />
                  Everyone on this KPI
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="radio" name="checklist-scope" checked={form.scope === 'staff'} onChange={() => setForm((current) => ({ ...current, scope: 'staff' }))} />
                  Selected people
                </label>
              </div>
            </div>
            {form.scope === 'staff' ? (
              <div className="max-h-56 overflow-y-auto rounded-xl border border-soul-line divide-y divide-soul-line/70">
                {people.map((person) => (
                  <label key={person.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.staff_ids.includes(person.id)}
                      onChange={() => setForm((current) => {
                        const has = current.staff_ids.includes(person.id);
                        return {
                          ...current,
                          staff_ids: has
                            ? current.staff_ids.filter((id) => id !== person.id)
                            : [...current.staff_ids, person.id],
                        };
                      })}
                    />
                    <span>{person.full_name}</span>
                    <span className="text-soul-muted">{ROLE_LABELS[person.role] || person.role}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-soul-muted">This goes to everyone on this KPI who you can assign.</p>
            )}
          </form>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title="Edit KPI"
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button>
            <button
              type="button"
              className="btn-primary"
              disabled={saveEdit.isPending}
              onClick={() => saveEdit.mutate({ ...edit, target_value: Number(edit.target_value), weight: Number(edit.weight) })}
            >
              Save changes
            </button>
          </>
        }
      >
        {edit ? (
          <div className="space-y-4">
            <p className="text-xs text-soul-muted">
              {kpi.metric_label} · {kpi.measure_label}. Changes apply to everyone on this KPI.
            </p>
            <div>
              <label className="label">Name</label>
              <input className="input" value={edit.title} placeholder={kpi.metric_label} onChange={(e) => setEdit((c) => ({ ...c, title: e.target.value }))} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="label">Target</label>
                <input
                  className="input"
                  type="number"
                  step={kpi.metric === 'reviews' || kpi.measure === 'value' ? '0.1' : '1'}
                  min="1"
                  max={kpi.metric === 'reviews' ? '5' : undefined}
                  value={edit.target_value}
                  onChange={(e) => setEdit((c) => ({ ...c, target_value: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Starts</label>
                <input className="input" type="date" value={edit.starts_on} onChange={(e) => setEdit((c) => ({ ...c, starts_on: e.target.value }))} />
              </div>
              <div>
                <label className="label">Deadline</label>
                <input className="input" type="date" value={edit.deadline} onChange={(e) => setEdit((c) => ({ ...c, deadline: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="label">Importance</label>
              <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
                {[1, 2, 3, 4, 5].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setEdit((c) => ({ ...c, weight: w }))}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium ${Number(edit.weight) === w ? 'bg-white text-soul-blue shadow-sm' : 'text-slate-500'}`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea className="input min-h-[56px]" value={edit.notes} onChange={(e) => setEdit((c) => ({ ...c, notes: e.target.value }))} />
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
