import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, LogIn, LogOut, Play, Plus, Sparkles, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import Modal from '../components/ui/Modal';
import { useAuth } from '../context/AuthContext';
import { unitSelectLabel } from '../utils/formatters';
import { OpsDateRangeFilter, formatOpsDay } from '../components/OpsDateRangeFilter';
import { ReassignReasonModal } from '../components/OpsCheckinActions';

const PHASES = {
  checkout_in: { label: 'Checkout / in', className: 'bg-rose-100 text-rose-800', hint: 'Guest checks out and the next one checks in the same day' },
  checkout: { label: 'Checkout', className: 'bg-amber-100 text-amber-800', hint: 'Not cleaned since the last checkout' },
  reclean: { label: 'Reclean', className: 'bg-sky-100 text-sky-800', hint: 'Already cleaned, no stay since the last checkout' },
  in_progress: { label: 'In progress', className: 'bg-indigo-100 text-indigo-800', hint: 'Housekeeping is cleaning now' },
  cleaned: { label: 'Cleaned', className: 'bg-emerald-100 text-emerald-800', hint: 'Ready for check-in' },
};

const RANGE_LABEL = { today: 'today', tomorrow: 'tomorrow', week: 'this week', month: 'this month' };

function todayIso() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

function AddCleanModal({ open, onClose, agents }) {
  const qc = useQueryClient();
  const [unitId, setUnitId] = useState('');
  const [cleanDate, setCleanDate] = useState(todayIso());
  const [staffId, setStaffId] = useState('');
  const [notes, setNotes] = useState('');
  const { data: units = [] } = useQuery({
    queryKey: ['units'],
    queryFn: () => api.get('/units').then((r) => r.data),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  const mutation = useMutation({
    mutationFn: () =>
      api.post('/housekeeping/cleans', {
        unit_id: unitId,
        clean_date: cleanDate,
        staff_id: staffId ? Number(staffId) : null,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Clean added');
      qc.invalidateQueries({ queryKey: ['hk-today-cleans'] });
      setUnitId('');
      setNotes('');
      setStaffId('');
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not add clean'),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add unit to clean"
      size="md"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={mutation.isPending || !unitId || !cleanDate}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Adding…' : 'Add clean'}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-gray-700">Unit *</span>
          <select className="input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">Choose a unit</option>
            {(Array.isArray(units) ? units : []).map((u) => (
              <option key={u.id} value={u.id}>
                {unitSelectLabel(u)}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs font-medium text-gray-700">Date to clean *</span>
            <input type="date" className="input" value={cleanDate} onChange={(e) => setCleanDate(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-gray-700">Assign to</span>
            <select className="input" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">Unassigned</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name || a.username}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-gray-700">Notes</span>
          <textarea className="input min-h-[4rem]" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}

export function TodayCleansSection({ embedded = false }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canAssign = user?.role === 'admin' || user?.role === 'operations_supervisor';
  const isAgent = user?.role === 'operations';
  const [range, setRange] = useState('today');
  const [adding, setAdding] = useState(false);
  const [pendingAssign, setPendingAssign] = useState(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['hk-today-cleans', range],
    queryFn: async () => {
      const r = await api.get('/housekeeping/today-cleans', { params: { range } });
      if (Array.isArray(r.data)) return { items: r.data };
      return { items: Array.isArray(r.data?.items) ? r.data.items : [], from: r.data?.from, to: r.data?.to };
    },
    refetchInterval: 20000,
  });
  const rows = data?.items || [];

  const { data: agents = [] } = useQuery({
    queryKey: ['hk-agents'],
    queryFn: async () => {
      const r = await api.get('/housekeeping/agents');
      return Array.isArray(r.data) ? r.data : [];
    },
    enabled: canAssign,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['hk-today-cleans'] });
    qc.invalidateQueries({ queryKey: ['ops-checkins-today'] });
    qc.invalidateQueries({ queryKey: ['housekeeping-tasks'] });
  };

  const startMutation = useMutation({
    mutationFn: (taskId) => api.post(`/housekeeping/today-cleans/${taskId}/start`),
    onSuccess: () => {
      toast.success('Marked in progress');
      invalidate();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not start the clean'),
  });

  const cleanMutation = useMutation({
    mutationFn: (taskId) => api.post(`/housekeeping/today-cleans/${taskId}/cleaned`),
    onSuccess: () => {
      toast.success('Marked cleaned — Operations can see it now');
      invalidate();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not mark cleaned'),
  });

  const assignMutation = useMutation({
    mutationFn: ({ taskId, staff_id, reason }) =>
      api.post(`/housekeeping/today-cleans/${taskId}/assign`, { staff_id: staff_id || null, reason }),
    onSuccess: () => {
      toast.success('Assignment updated');
      setPendingAssign(null);
      invalidate();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Assign failed'),
  });

  const dateMutation = useMutation({
    mutationFn: ({ taskId, clean_date }) => api.patch(`/housekeeping/cleans/${taskId}/date`, { clean_date }),
    onSuccess: () => {
      toast.success('Cleaning date updated');
      invalidate();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not update cleaning date'),
  });

  const removeMutation = useMutation({
    mutationFn: (taskId) => api.delete(`/housekeeping/cleans/${taskId}`),
    onSuccess: () => {
      toast.success('Clean removed');
      invalidate();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not remove clean'),
  });

  if (isLoading) return <LoadingSpinner />;

  const toolbar = (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <OpsDateRangeFilter value={range} onChange={setRange} />
      {canAssign ? (
        <button type="button" className="btn-primary text-sm" onClick={() => setAdding(true)}>
          <Plus className="w-4 h-4" /> Add unit to clean
        </button>
      ) : null}
      <button type="button" className="btn-secondary text-sm" onClick={() => refetch()}>
        Refresh
      </button>
    </div>
  );

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-6'}>
      {!embedded ? (
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Cleaning</h1>
            <p className="mt-1 text-sm text-gray-500">
              {canAssign
                ? 'Assign each clean, add units manually and track them from checkout to ready.'
                : isAgent
                  ? 'Your assigned cleans — start the clean, then mark it cleaned when the unit is ready.'
                  : 'Units to clean for the selected period.'}
            </p>
          </div>
          {toolbar}
        </div>
      ) : (
        toolbar
      )}

      <div className="flex flex-wrap gap-2 text-[11px]">
        {Object.entries(PHASES).map(([key, p]) => (
          <span key={key} className={`rounded-full px-2 py-0.5 font-semibold ${p.className}`} title={p.hint}>
            {p.label}
          </span>
        ))}
      </div>

      {isError ? (
        <div className="card p-10 text-center text-sm text-red-600">
          Could not load cleans: {error?.response?.data?.error || error?.message || 'Request failed'}
        </div>
      ) : !rows.length ? (
        <div className="card p-10 text-center text-sm text-gray-500">
          {isAgent
            ? `No cleans assigned to you for ${RANGE_LABEL[range]}.`
            : `No cleans for ${RANGE_LABEL[range]}.`}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => {
            const phase = PHASES[r.phase] || PHASES.checkout;
            return (
              <div
                key={r.task_id}
                className={`card p-4 border ${r.cleaned ? 'border-emerald-200 bg-emerald-50/40' : 'border-soul-line'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-lg font-bold text-soul-blue">{r.unit_number || '—'}</div>
                    <div className="text-xs text-gray-500 truncate max-w-[14rem]">{r.unit_title || r.project || ''}</div>
                  </div>
                  <div className="text-right space-y-1">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${phase.className}`}
                      title={phase.hint}
                    >
                      {r.cleaned ? <Sparkles className="w-3 h-3" /> : null}
                      {phase.label}
                    </span>
                    <div className="text-[11px] text-gray-500">Clean {formatOpsDay(r.clean_date)}</div>
                    {r.source === 'manual' ? (
                      <div className="text-[10px] uppercase text-violet-700">Manual</div>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex items-start gap-2">
                    <LogIn className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
                    <div>
                      <div className="text-[10px] uppercase text-gray-500">Check-in</div>
                      {r.check_in ? (
                        <>
                          <div className="font-semibold text-gray-900">{r.guest_name || '—'}</div>
                          <div className="text-xs text-gray-600">
                            {formatOpsDay(r.check_in)}
                            {r.guest_phone ? ` · ${r.guest_phone}` : ''}
                          </div>
                        </>
                      ) : (
                        <div className="text-xs text-gray-400">No upcoming check-in</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <LogOut className="w-4 h-4 mt-0.5 text-rose-600 shrink-0" />
                    <div>
                      <div className="text-[10px] uppercase text-gray-500">Checkout</div>
                      {r.prev_check_out ? (
                        <>
                          <div className="font-medium text-gray-800">{r.prev_guest_name || '—'}</div>
                          <div className="text-xs text-gray-600">{formatOpsDay(r.prev_check_out)}</div>
                        </>
                      ) : (
                        <div className="text-xs text-gray-400">No previous stay</div>
                      )}
                    </div>
                  </div>
                  {!canAssign && r.assignee_name ? (
                    <div className="text-[11px] text-sky-800">Assigned: {r.assignee_name}</div>
                  ) : null}
                  {r.created_by_name ? (
                    <div className="text-[11px] text-gray-500">Added by {r.created_by_name}</div>
                  ) : null}
                </div>

                {canAssign && !r.cleaned ? (
                  <div className="mt-3 space-y-2">
                    <div>
                      <label className="text-[10px] uppercase text-gray-500">Assign agent</label>
                      <select
                        className="input text-sm py-1.5 mt-1"
                        value={r.assigned_to || ''}
                        disabled={assignMutation.isPending}
                        onChange={(e) => {
                          const staffId = e.target.value ? Number(e.target.value) : null;
                          if (r.assigned_to && Number(r.assigned_to) !== Number(staffId || 0)) {
                            setPendingAssign({ taskId: r.task_id, staff_id: staffId });
                            return;
                          }
                          assignMutation.mutate({ taskId: r.task_id, staff_id: staffId });
                        }}
                      >
                        <option value="">Unassigned</option>
                        {agents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.full_name || a.username}
                            {a.staff_code ? ` (${a.staff_code})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <label className="text-[10px] uppercase text-gray-500">Cleaning date</label>
                        <input
                          type="date"
                          className="input text-sm py-1.5 mt-1"
                          value={String(r.clean_date || '').slice(0, 10)}
                          disabled={dateMutation.isPending}
                          onChange={(e) =>
                            e.target.value && dateMutation.mutate({ taskId: r.task_id, clean_date: e.target.value })
                          }
                        />
                      </div>
                      {r.source === 'manual' ? (
                        <button
                          type="button"
                          className="btn-secondary text-xs text-red-700"
                          disabled={removeMutation.isPending}
                          onClick={() => {
                            if (window.confirm('Remove this manual clean?')) removeMutation.mutate(r.task_id);
                          }}
                          title="Remove manual clean"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="mt-4">
                  {r.cleaned ? (
                    <div className="text-xs font-medium text-emerald-700">Ready for Operations</div>
                  ) : r.in_progress ? (
                    <button
                      type="button"
                      className="btn-primary text-xs w-full justify-center"
                      disabled={cleanMutation.isPending}
                      onClick={() => cleanMutation.mutate(r.task_id)}
                    >
                      <Check className="w-3.5 h-3.5" /> Mark cleaned
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-secondary text-xs w-full justify-center"
                      disabled={startMutation.isPending}
                      onClick={() => startMutation.mutate(r.task_id)}
                    >
                      <Play className="w-3.5 h-3.5" /> Start cleaning (In progress)
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canAssign ? <AddCleanModal open={adding} onClose={() => setAdding(false)} agents={agents} /> : null}
      <ReassignReasonModal
        open={!!pendingAssign}
        busy={assignMutation.isPending}
        onClose={() => setPendingAssign(null)}
        onConfirm={(reason) => assignMutation.mutate({ ...pendingAssign, reason })}
        title="Change cleaning agent"
      />
    </div>
  );
}

export default function HkTodayCleans() {
  return <TodayCleansSection />;
}
