import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import Modal from '../components/ui/Modal';
import { currency, formatDateTime } from '../utils/formatters';

function cairoToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

const KIND_LABELS = {
  checkin: 'Check-in handed over',
  checkout: 'Checkout / insurance',
  clean: 'Clean done',
  task: 'Task done',
  attendance_in: 'Clock in',
  attendance_out: 'Clock out',
};

function AgentHistoryModal({ agent, from, to, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ['ops-performance-history', agent?.id, from, to],
    queryFn: async () => (await api.get(`/ops/performance/${agent.id}/history`, { params: { from, to } })).data,
    enabled: !!agent,
  });
  const items = data?.items || [];
  return (
    <Modal open={!!agent} onClose={onClose} title={`${agent?.full_name || 'Agent'} · activity`} size="lg">
      {isLoading ? (
        <LoadingSpinner />
      ) : !items.length ? (
        <p className="text-sm text-gray-500">No activity in this period.</p>
      ) : (
        <ul className="divide-y">
          {items.map((it) => (
            <li key={`${it.kind}-${it.ref_id}`} className="py-2 flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium text-gray-900">{KIND_LABELS[it.kind] || it.kind}</div>
                {it.label ? <div className="text-xs text-gray-600 truncate">{it.label}</div> : null}
                <div className="text-[11px] text-gray-400">{formatDateTime(it.at)}</div>
              </div>
              {it.photo_url ? (
                <a href={it.photo_url} target="_blank" rel="noreferrer" className="shrink-0">
                  <img src={it.photo_url} alt="" className="h-12 w-12 rounded-lg object-cover border" />
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function PerformanceSection() {
  const today = cairoToday();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [agent, setAgent] = useState(null);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['ops-performance', from, to],
    queryFn: async () => (await api.get('/ops/performance', { params: { from, to } })).data,
  });
  const items = data?.items || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs space-y-1">
          <span className="text-gray-500">From</span>
          <input type="date" className="input text-sm py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-xs space-y-1">
          <span className="text-gray-500">To</span>
          <input type="date" className="input text-sm py-1.5" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {isLoading ? (
        <LoadingSpinner />
      ) : isError ? (
        <div className="card p-8 text-center text-sm text-red-600">
          {error?.response?.data?.error || 'Could not load performance'}
        </div>
      ) : !items.length ? (
        <div className="card p-8 text-center text-sm text-gray-500">No active operations agents.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-gray-500 border-b">
              <tr>
                <th className="py-3 px-4">Agent</th>
                <th className="py-3 px-4 text-right">Check-ins</th>
                <th className="py-3 px-4 text-right">Collected</th>
                <th className="py-3 px-4 text-right">Checkouts</th>
                <th className="py-3 px-4 text-right">Cleans</th>
                <th className="py-3 px-4 text-right">Tasks</th>
                <th className="py-3 px-4 text-right">Late / overdue</th>
                <th className="py-3 px-4 text-right">Days present</th>
                <th className="py-3 px-4 text-right">Reassigned away</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr
                  key={a.id}
                  className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setAgent(a)}
                  title="Open activity"
                >
                  <td className="py-3 px-4">
                    <div className="font-medium text-gray-900">{a.full_name}</div>
                    {a.staff_code ? <div className="text-[11px] text-gray-500">{a.staff_code}</div> : null}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {a.checkins_done} / {a.checkins_assigned}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">{currency(a.collected)}</td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {a.checkouts_done} / {a.checkouts_assigned}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">{a.cleans_done}</td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {a.tasks_done} / {a.tasks_due}
                  </td>
                  <td className={`py-3 px-4 text-right tabular-nums ${a.tasks_late || a.tasks_overdue ? 'text-rose-700' : ''}`}>
                    {a.tasks_late} / {a.tasks_overdue}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">{a.attendance_days}</td>
                  <td className="py-3 px-4 text-right tabular-nums">{a.reassigned_away}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-gray-400">
        Check-ins, checkouts and tasks show done / assigned. Click an agent to see the activity log with photos.
      </p>
      <AgentHistoryModal agent={agent} from={from} to={to} onClose={() => setAgent(null)} />
    </div>
  );
}
