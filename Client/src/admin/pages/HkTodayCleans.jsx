import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../utils/formatters';

export default function HkTodayCleans() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canAssign =
    user?.role === 'admin' || user?.role === 'housekeeping_supervisor';
  const isAgent = user?.role === 'housekeeping';

  const { data: rows = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['hk-today-cleans'],
    queryFn: async () => {
      const r = await api.get('/housekeeping/today-cleans');
      return Array.isArray(r.data) ? r.data : [];
    },
    refetchInterval: 20000,
  });

  const { data: agents = [] } = useQuery({
    queryKey: ['hk-agents'],
    queryFn: async () => {
      const r = await api.get('/housekeeping/agents');
      return Array.isArray(r.data) ? r.data : [];
    },
    enabled: canAssign,
  });

  const cleanMutation = useMutation({
    mutationFn: (taskId) => api.post(`/housekeeping/today-cleans/${taskId}/cleaned`),
    onSuccess: () => {
      toast.success('Marked cleaned — Operations can see it now');
      qc.invalidateQueries({ queryKey: ['hk-today-cleans'] });
      qc.invalidateQueries({ queryKey: ['ops-checkins-today'] });
      qc.invalidateQueries({ queryKey: ['housekeeping-tasks'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not mark cleaned'),
  });

  const assignMutation = useMutation({
    mutationFn: ({ taskId, staff_id }) =>
      api.post(`/housekeeping/today-cleans/${taskId}/assign`, { staff_id: staff_id || null }),
    onSuccess: () => {
      toast.success('Assignment updated');
      qc.invalidateQueries({ queryKey: ['hk-today-cleans'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Assign failed'),
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Today&apos;s cleans</h1>
          <p className="mt-1 text-sm text-gray-500">
            {canAssign
              ? 'Assign each clean to a housekeeping agent, then track when units are ready.'
              : isAgent
                ? 'Your assigned cleans — mark cleaned when the unit is ready for Operations.'
                : 'Units with check-in today. Mark cleaned when ready for Operations handover.'}
          </p>
        </div>
        <button type="button" className="btn-secondary text-sm" onClick={() => refetch()}>
          Refresh
        </button>
      </div>

      {isError ? (
        <div className="card p-10 text-center text-sm text-red-600">
          Could not load cleans: {error?.response?.data?.error || error?.message || 'Request failed'}
        </div>
      ) : !rows.length ? (
        <div className="card p-10 text-center text-sm text-gray-500">
          {isAgent
            ? 'No cleans assigned to you yet. Ask your Housekeeping Supervisor to assign units.'
            : 'No check-in cleans for today.'}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <div
              key={r.reservation_id}
              className={`card p-4 border ${
                r.cleaned ? 'border-emerald-200 bg-emerald-50/40' : 'border-soul-line'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-bold text-soul-blue">{r.unit_number || '—'}</div>
                  <div className="text-xs text-gray-500 truncate max-w-[14rem]">
                    {r.unit_title || r.project || ''}
                  </div>
                </div>
                {r.cleaned ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[11px] font-semibold">
                    <Sparkles className="w-3 h-3" /> Cleaned
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[11px] font-semibold">
                    To clean
                  </span>
                )}
              </div>

              <div className="mt-3 space-y-1 text-sm">
                <div>
                  <span className="text-xs uppercase text-gray-500">Guest</span>
                  <div className="font-semibold text-gray-900">{r.guest_name || '—'}</div>
                </div>
                <div className="text-xs text-gray-600">
                  Check-in {formatDate(r.check_in)}
                  {r.guest_phone ? ` · ${r.guest_phone}` : ''}
                </div>
                {!canAssign && r.assignee_name ? (
                  <div className="text-[11px] text-sky-800">Assigned: {r.assignee_name}</div>
                ) : null}
              </div>

              {canAssign && r.task_id ? (
                <div className="mt-3">
                  <label className="text-[10px] uppercase text-gray-500">Assign agent</label>
                  <select
                    className="input text-sm py-1.5 mt-1"
                    value={r.assigned_to || ''}
                    disabled={assignMutation.isPending}
                    onChange={(e) =>
                      assignMutation.mutate({
                        taskId: r.task_id,
                        staff_id: e.target.value ? Number(e.target.value) : null,
                      })
                    }
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
              ) : null}

              <div className="mt-4">
                {r.cleaned ? (
                  <div className="text-xs font-medium text-emerald-700">Ready for Operations</div>
                ) : r.task_id ? (
                  <button
                    type="button"
                    className="btn-primary text-xs w-full justify-center"
                    disabled={cleanMutation.isPending}
                    onClick={() => cleanMutation.mutate(r.task_id)}
                  >
                    <Check className="w-3.5 h-3.5" /> Mark cleaned
                  </button>
                ) : (
                  <div className="text-xs text-rose-600">No housekeeping task yet — refresh</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
