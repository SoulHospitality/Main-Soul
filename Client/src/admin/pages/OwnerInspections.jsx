import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { formatDateTime } from '../utils/formatters';

export default function OwnerInspections() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['owner-inspections'],
    queryFn: async () => (await api.get('/owner/inspections')).data,
  });

  const markSeen = useMutation({
    mutationFn: () => api.post('/owner/inspections/mark-seen'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['owner-inspections'] }),
  });

  const unread = data?.unread || 0;
  useEffect(() => {
    if (unread > 0 && !markSeen.isPending) markSeen.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread]);

  if (isLoading) return <LoadingSpinner />;

  const items = Array.isArray(data?.items) ? data.items : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Unit inspections</h1>
        <p className="mt-1 text-sm text-gray-500">
          Our operations team inspects every new unit before it starts hosting guests. Watch the walkthrough
          video and see what was checked.
        </p>
      </div>

      {isError ? (
        <div className="card p-10 text-center text-sm text-red-600">
          Could not load inspections: {error?.response?.data?.error || error?.message || 'Request failed'}
        </div>
      ) : !items.length ? (
        <div className="card p-10 text-center text-sm text-gray-500">
          <ClipboardCheck className="mx-auto mb-2 h-8 w-8 text-gray-300" />
          No inspections yet.
        </div>
      ) : (
        items.map((insp) => {
          const issues = insp.checklist.filter((it) => it.result === 'issue');
          return (
            <section key={insp.inspection_id} className="card p-5 space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    {insp.unit_number || insp.unit_title || 'Unit'}
                  </h2>
                  <p className="text-sm text-gray-500">
                    {[insp.project, `Inspected ${formatDateTime(insp.completed_at)}`].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                    issues.length ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {issues.length
                    ? `${issues.length} issue${issues.length === 1 ? '' : 's'} found`
                    : 'No issues found'}
                </span>
              </div>

              {insp.video_url ? (
                <video src={insp.video_url} controls className="w-full rounded-xl bg-black max-h-[60vh]" />
              ) : null}

              <ul className="divide-y border rounded-xl">
                {insp.checklist.map((item) => (
                  <li key={item.id} className="px-3 py-2 text-sm flex items-start gap-3">
                    <span
                      className={`mt-0.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        item.result === 'issue' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {item.result === 'issue' ? 'Issue' : 'OK'}
                    </span>
                    <div>
                      <div className="text-gray-900">{item.label}</div>
                      {item.note ? <div className="text-xs text-gray-600 mt-0.5">{item.note}</div> : null}
                    </div>
                  </li>
                ))}
              </ul>

              {insp.notes ? (
                <div>
                  <div className="text-[10px] uppercase text-gray-500 mb-1">Inspector notes</div>
                  <p className="text-sm text-gray-700 whitespace-pre-line">{insp.notes}</p>
                </div>
              ) : null}
            </section>
          );
        })
      )}
    </div>
  );
}
