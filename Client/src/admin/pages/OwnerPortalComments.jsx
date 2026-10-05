import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MessageSquareText, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import OwnerCommentThread, { CommentStatusBadge, unitLine } from '../components/OwnerCommentThread';
import { formatDateTime } from '../utils/formatters';

function NewCommentForm({ onCancel, onCreated }) {
  const [form, setForm] = useState({ unit_id: '', subject: '', body: '' });
  const { data: units = [] } = useQuery({
    queryKey: ['owner-units'],
    queryFn: async () => {
      const r = await api.get('/owner/units');
      return Array.isArray(r.data) ? r.data : [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post('/owner/comments', {
          unit_id: form.unit_id || null,
          subject: form.subject.trim(),
          body: form.body.trim(),
        })
      ).data,
    onSuccess: (payload) => {
      toast.success('Comment sent — our team will reply here');
      onCreated(payload);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not send comment'),
  });

  return (
    <div className="card p-5 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">New comment</h2>
      <div>
        <label className="text-xs font-medium text-gray-600">About</label>
        <select
          className="input text-sm mt-1"
          value={form.unit_id}
          onChange={(e) => setForm((f) => ({ ...f, unit_id: e.target.value }))}
        >
          <option value="">General (not about a specific unit)</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {[u.name, u.project].filter(Boolean).join(' · ')}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600">Subject</label>
        <input
          className="input text-sm mt-1"
          maxLength={200}
          placeholder="e.g. Question about last month's statement"
          value={form.subject}
          onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
        />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600">Comment</label>
        <textarea
          className="input text-sm mt-1 min-h-[8rem]"
          maxLength={4000}
          placeholder="Write your comment…"
          value={form.body}
          onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
        />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary text-sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-primary text-sm"
          disabled={!form.subject.trim() || !form.body.trim() || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending ? 'Sending…' : 'Send comment'}
        </button>
      </div>
    </div>
  );
}

export default function OwnerPortalComments() {
  const qc = useQueryClient();
  const [view, setView] = useState('list');
  const [selectedId, setSelectedId] = useState(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['owner-portal-comments'],
    queryFn: async () => (await api.get('/owner/comments')).data,
    refetchInterval: 60000,
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['owner-portal-comment', selectedId],
    queryFn: async () => {
      const payload = (await api.get(`/owner/comments/${selectedId}`)).data;
      qc.invalidateQueries({ queryKey: ['owner-portal-comments'] });
      return payload;
    },
    enabled: view === 'thread' && !!selectedId,
  });

  const replyMutation = useMutation({
    mutationFn: async (body) => (await api.post(`/owner/comments/${selectedId}/reply`, { body })).data,
    onSuccess: (payload) => {
      qc.setQueryData(['owner-portal-comment', selectedId], payload);
      qc.invalidateQueries({ queryKey: ['owner-portal-comments'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not send reply'),
  });

  const openThread = (id) => {
    setSelectedId(id);
    setView('thread');
  };

  const items = Array.isArray(data?.items) ? data.items : [];

  if (view === 'new') {
    return (
      <NewCommentForm
        onCancel={() => setView('list')}
        onCreated={(payload) => {
          qc.setQueryData(['owner-portal-comment', payload.thread.id], payload);
          qc.invalidateQueries({ queryKey: ['owner-portal-comments'] });
          openThread(payload.thread.id);
        }}
      />
    );
  }

  if (view === 'thread') {
    const thread = detail?.thread;
    return (
      <div className="space-y-4">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
          onClick={() => setView('list')}
        >
          <ArrowLeft className="w-4 h-4" /> All comments
        </button>
        <div className="card p-5">
          {detailLoading || !thread ? (
            <LoadingSpinner />
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3 border-b pb-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{thread.subject}</h2>
                  <p className="text-sm text-gray-500">{unitLine(thread)}</p>
                </div>
                <CommentStatusBadge status={thread.status} />
              </div>
              <OwnerCommentThread
                messages={detail.messages}
                viewer="owner"
                sending={replyMutation.isPending}
                onReply={(body) =>
                  replyMutation
                    .mutateAsync(body)
                    .then(() => true)
                    .catch(() => false)
                }
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Comments</h1>
          <p className="mt-1 text-sm text-gray-500">
            Leave a comment about one of your units or anything else. Our owner team will reply here.
          </p>
        </div>
        <button type="button" className="btn-primary text-sm inline-flex items-center gap-1.5" onClick={() => setView('new')}>
          <Plus className="w-4 h-4" /> New comment
        </button>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : isError ? (
        <div className="card p-10 text-center text-sm text-red-600">
          {error?.response?.data?.error || error?.message || 'Could not load comments'}
        </div>
      ) : !items.length ? (
        <div className="card p-10 text-center text-sm text-gray-500">
          <MessageSquareText className="mx-auto mb-2 h-8 w-8 text-gray-300" />
          You haven&apos;t left any comments yet.
        </div>
      ) : (
        <ul className="card p-0 divide-y overflow-hidden">
          {items.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => openThread(t.id)} className="w-full text-left px-5 py-4 hover:bg-gray-50">
                <div className="flex items-center justify-between gap-3">
                  <span className={`truncate ${t.unread ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}>
                    {t.subject}
                  </span>
                  <span className="flex items-center gap-2 flex-shrink-0">
                    {t.unread ? (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-500 text-white">
                        New reply
                      </span>
                    ) : null}
                    <CommentStatusBadge status={t.status} />
                  </span>
                </div>
                <div className="text-xs text-soul-blue mt-0.5">{unitLine(t)}</div>
                <div className="flex items-center justify-between gap-3 mt-1">
                  <span className="text-sm text-gray-500 truncate">
                    {t.last_message_from === 'owner' ? 'You: ' : 'Soul: '}
                    {t.last_message}
                  </span>
                  <span className="text-xs text-gray-400 whitespace-nowrap">{formatDateTime(t.last_message_at)}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
