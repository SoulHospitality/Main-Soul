import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareText } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import OwnerCommentThread, { CommentStatusBadge, unitLine } from '../components/OwnerCommentThread';
import { formatDateTime } from '../utils/formatters';

const FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'all', label: 'All' },
];

export default function OwnerComments() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedThread = searchParams.get('thread');
  const [filter, setFilter] = useState(linkedThread ? 'all' : 'open');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(linkedThread ? Number(linkedThread) : null);

  useEffect(() => {
    if (!linkedThread) return;
    setFilter('all');
    setSelectedId(Number(linkedThread));
    const next = new URLSearchParams(searchParams);
    next.delete('thread');
    setSearchParams(next, { replace: true });
  }, [linkedThread, searchParams, setSearchParams]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['owner-comments', filter, search],
    queryFn: async () =>
      (await api.get('/owner-comments', { params: { status: filter, q: search || undefined } })).data,
    refetchInterval: 30000,
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['owner-comment', selectedId],
    queryFn: async () => (await api.get(`/owner-comments/${selectedId}`)).data,
    enabled: !!selectedId,
  });

  useEffect(() => {
    if (detail?.thread) {
      qc.invalidateQueries({ queryKey: ['owner-comments'] });
      qc.invalidateQueries({ queryKey: ['owner-comments-unread'] });
    }
  }, [detail?.thread?.id, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshAll = (payload) => {
    if (payload) qc.setQueryData(['owner-comment', selectedId], payload);
    qc.invalidateQueries({ queryKey: ['owner-comments'] });
    qc.invalidateQueries({ queryKey: ['owner-comments-unread'] });
  };

  const replyMutation = useMutation({
    mutationFn: async ({ body, resolve }) =>
      (await api.post(`/owner-comments/${selectedId}/reply`, { body, resolve })).data,
    onSuccess: (payload, vars) => {
      toast.success(vars.resolve ? 'Reply sent and comment resolved' : 'Reply sent to the owner');
      refreshAll(payload);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not send reply'),
  });

  const statusMutation = useMutation({
    mutationFn: async (status) => (await api.post(`/owner-comments/${selectedId}/status`, { status })).data,
    onSuccess: (thread) => {
      toast.success(thread.status === 'resolved' ? 'Marked as resolved' : 'Reopened');
      qc.invalidateQueries({ queryKey: ['owner-comment', selectedId] });
      refreshAll();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not update status'),
  });

  const items = Array.isArray(data?.items) ? data.items : [];
  const counts = data?.counts || {};
  const thread = detail?.thread;

  return (
    <div className="space-y-6">
      <div className="page-header mb-0">
        <h1 className="page-title">Owner comments</h1>
        <p className="page-subtitle">
          Comments owners leave from the owner portal about their units or in general. Reply here — the owner sees
          your reply in their portal.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                filter === f.id ? 'bg-soul-blue text-white border-soul-blue' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {f.label}
              {f.id !== 'all' ? (
                <span className="ml-1 opacity-70 tabular-nums">{counts[f.id] || 0}</span>
              ) : null}
            </button>
          ))}
          {counts.unread ? (
            <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-red-50 text-red-700">
              {counts.unread} unread
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            className="input text-sm py-1.5 w-56"
            placeholder="Owner, unit, or subject"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setSearch(q.trim());
            }}
          />
          <button type="button" className="btn-secondary text-sm" onClick={() => setSearch(q.trim())}>
            Search
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="card p-0 overflow-hidden">
          {isLoading ? (
            <LoadingSpinner />
          ) : isError ? (
            <p className="p-6 text-sm text-red-600">
              {error?.response?.data?.error || error?.message || 'Could not load comments'}
            </p>
          ) : !items.length ? (
            <div className="p-10 text-center text-sm text-gray-500">
              <MessageSquareText className="mx-auto mb-2 h-8 w-8 text-gray-300" />
              No comments here.
            </div>
          ) : (
            <ul className="divide-y max-h-[70vh] overflow-y-auto">
              {items.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${selectedId === t.id ? 'bg-blue-50/60' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-sm truncate ${t.unread ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}>
                        {t.owner_name}
                      </span>
                      <span className="text-[11px] text-gray-400 whitespace-nowrap">
                        {formatDateTime(t.last_message_at)}
                      </span>
                    </div>
                    <div className="text-xs text-soul-blue truncate">{unitLine(t)}</div>
                    <div className="text-sm text-gray-700 truncate">{t.subject}</div>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <span className="text-xs text-gray-500 truncate">
                        {t.last_message_from === 'staff' ? 'You: ' : ''}
                        {t.last_message}
                      </span>
                      <span className="flex items-center gap-1.5 flex-shrink-0">
                        {t.unread ? <span className="w-2 h-2 rounded-full bg-red-500" /> : null}
                        <CommentStatusBadge status={t.status} />
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-5">
          {!selectedId ? (
            <div className="py-16 text-center text-sm text-gray-500">Select a comment to read and reply.</div>
          ) : detailLoading || !thread ? (
            <LoadingSpinner />
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3 flex-wrap border-b pb-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{thread.subject}</h2>
                  <p className="text-sm text-gray-500">
                    {thread.owner_name}
                    {thread.owner_email ? ` · ${thread.owner_email}` : ''} · {unitLine(thread)}
                  </p>
                  {thread.status === 'resolved' && thread.resolved_by_name ? (
                    <p className="text-xs text-emerald-700 mt-1">
                      Resolved by {thread.resolved_by_name} · {formatDateTime(thread.resolved_at)}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <CommentStatusBadge status={thread.status} />
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate(thread.status === 'resolved' ? 'open' : 'resolved')}
                  >
                    {thread.status === 'resolved' ? 'Reopen' : 'Mark resolved'}
                  </button>
                </div>
              </div>
              <OwnerCommentThread
                messages={detail.messages}
                viewer="staff"
                sending={replyMutation.isPending}
                onReply={(body, opts) =>
                  replyMutation
                    .mutateAsync({ body, resolve: !!opts?.resolve })
                    .then(() => true)
                    .catch(() => false)
                }
                replyLabel="Reply"
                extraActions={({ draft, submit, sending }) =>
                  thread.status !== 'resolved' ? (
                    <button
                      type="button"
                      className="btn-secondary text-sm"
                      disabled={sending || !draft.trim()}
                      onClick={() => submit({ resolve: true })}
                    >
                      Reply & resolve
                    </button>
                  ) : null
                }
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
