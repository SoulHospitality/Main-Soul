import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Users, CalendarDays, Activity } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../utils/permissions';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import { formatDateTime } from '../utils/formatters';

const ACTION_LABELS = {
  CREATE_UNIT: 'Added a rental unit',
  UPDATE_UNIT: 'Updated a unit',
  DELETE_UNIT: 'Deleted a unit',
  PUBLISH_UNIT: 'Published a unit',
  UNPUBLISH_UNIT: 'Unpublished a unit',
  CREATE_ACQUISITION_LEAD: 'Added an owner lead',
  UPDATE_ACQUISITION_LEAD: 'Updated an owner lead',
  DELETE_ACQUISITION_LEAD: 'Deleted an owner lead',
  CREATE_UNIT_FROM_LEAD: 'Created a unit from a lead',
  LOG_ACQUISITION_NEGOTIATION: 'Logged a negotiation note',
  CREATE_ACQUISITION_CONTRACT: 'Added a contract',
};

function cairoToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

function formatDay(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function shiftDate(iso, days) {
  const dt = new Date(`${iso}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function entityLabel(event) {
  if (event.details?.title) return event.details.title;
  if (event.details?.owner_name) return event.details.owner_name;
  if (event.entity_type && event.entity_id) return `${event.entity_type} #${event.entity_id}`;
  return event.entity_id ? `#${event.entity_id}` : '';
}

export default function AcquisitionAudit() {
  const { user } = useAuth();
  const [date, setDate] = useState(cairoToday);

  const { data, isLoading } = useQuery({
    queryKey: ['acquisition-audit', date],
    queryFn: () =>
      api.get('/acquisition-audit', { params: { date: date || undefined } }).then((r) => r.data),
  });

  const totals = data?.totals || { events: 0, team_size: 0, agents_active: 0 };
  const byAgent = data?.by_agent || [];

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="page-header mb-0">
        <h1 className="page-title">Audit</h1>
        <p className="page-subtitle">
          {user?.role === 'admin'
            ? 'Daily unit acquisition activity across every agent and manager.'
            : 'What your agents did today — units added, leads updated, and other acquisition work.'}
        </p>
      </div>

      <div className="card p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="label text-xs">Day</label>
          <input
            type="date"
            className="input w-44"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <button type="button" className="btn-secondary" onClick={() => setDate(shiftDate(date, -1))}>
          Previous
        </button>
        <button type="button" className="btn-secondary" onClick={() => setDate(cairoToday())}>
          Today
        </button>
        <button type="button" className="btn-secondary" onClick={() => setDate(shiftDate(date, 1))}>
          Next
        </button>
        <p className="text-xs text-soul-muted pb-2">{formatDay(date)}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="flex items-center gap-3 text-soul-muted text-xs font-semibold uppercase tracking-wide">
            <ClipboardList className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
            Actions
          </div>
          <p className="mt-2 font-display text-3xl text-soul-blue">{totals.events}</p>
          <p className="mt-1 text-xs text-soul-muted">Logged this Cairo day</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 text-soul-muted text-xs font-semibold uppercase tracking-wide">
            <Activity className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
            Active
          </div>
          <p className="mt-2 font-display text-3xl text-soul-blue">{totals.agents_active}</p>
          <p className="mt-1 text-xs text-soul-muted">Agents with at least one action</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 text-soul-muted text-xs font-semibold uppercase tracking-wide">
            <Users className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
            Team
          </div>
          <p className="mt-2 font-display text-3xl text-soul-blue">{totals.team_size}</p>
          <p className="mt-1 text-xs text-soul-muted">Agents you manage, including you</p>
        </div>
      </div>

      {!byAgent.length ? (
        <EmptyState
          title="No team members yet"
          subtitle="Assign Unit Acquisition Agents to this manager in Users."
        />
      ) : (
        <div className="space-y-4">
          {byAgent.map((agent) => (
            <section key={agent.staff_id} className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-soul-line flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-soul-blue">{agent.full_name}</h2>
                  <p className="text-xs text-soul-muted">{ROLE_LABELS[agent.role] || agent.role}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-soul-blue">
                  {agent.count} {agent.count === 1 ? 'action' : 'actions'}
                </span>
              </div>
              {!agent.events.length ? (
                <p className="px-5 py-4 text-sm text-soul-muted">No activity on this day.</p>
              ) : (
                <ul className="divide-y divide-soul-line/70">
                  {agent.events.map((event) => (
                    <li key={event.id} className="px-5 py-3 flex items-start gap-4">
                      <span className="w-12 shrink-0 text-xs tabular-nums text-soul-muted pt-0.5">
                        {event.cairo_time || ''}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-soul-blue">
                          {ACTION_LABELS[event.action] || String(event.action || '').replace(/_/g, ' ')}
                        </p>
                        {entityLabel(event) ? (
                          <p className="text-xs text-soul-muted truncate">{entityLabel(event)}</p>
                        ) : null}
                      </div>
                      <span className="hidden sm:block text-[11px] text-soul-muted shrink-0">
                        {formatDateTime(event.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      <p className="flex items-center gap-2 text-[11px] text-soul-muted">
        <CalendarDays className="w-3.5 h-3.5" />
        Times are shown in Cairo.
      </p>
    </div>
  );
}
