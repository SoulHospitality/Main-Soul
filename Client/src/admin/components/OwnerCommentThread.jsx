import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { formatDateTime } from '../utils/formatters';

export function unitLine(thread) {
  const unit = thread.unit_number || thread.unit_title;
  if (!unit) return 'General';
  return [unit, thread.project].filter(Boolean).join(' · ');
}

export function CommentStatusBadge({ status }) {
  return status === 'resolved' ? (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800">
      Resolved
    </span>
  ) : (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">Open</span>
  );
}

/**
 * Chat-style message list plus a reply box.
 * `viewer` is 'owner' or 'staff' — the viewer's own messages sit on the right.
 */
export default function OwnerCommentThread({ messages, viewer, onReply, sending, replyLabel = 'Send', extraActions }) {
  const [draft, setDraft] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages?.length]);

  const submit = async (opts) => {
    const body = draft.trim();
    if (!body) return;
    const ok = await onReply(body, opts);
    if (ok !== false) setDraft('');
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
        {(messages || []).map((m) => {
          const mine = viewer === 'owner' ? m.from_owner : !m.from_owner;
          const who = m.from_owner
            ? m.author_name || 'Owner'
            : viewer === 'owner'
              ? `${m.author_name || 'Soul team'} · Soul`
              : m.author_name || 'Staff';
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm ${
                  mine ? 'bg-soul-blue text-white rounded-br-md' : 'bg-gray-100 text-gray-900 rounded-bl-md'
                }`}
              >
                <div className={`text-[11px] mb-1 ${mine ? 'text-white/70' : 'text-gray-500'}`}>
                  {who} · {formatDateTime(m.created_at)}
                </div>
                <div className="whitespace-pre-line break-words">{m.body}</div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="space-y-2">
        <textarea
          className="input text-sm min-h-[5rem]"
          placeholder="Write a reply…"
          value={draft}
          maxLength={4000}
          disabled={sending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="flex items-center justify-end gap-2 flex-wrap">
          {extraActions ? extraActions({ draft, submit, sending }) : null}
          <button
            type="button"
            className="btn-primary text-sm inline-flex items-center gap-1.5"
            disabled={sending || !draft.trim()}
            onClick={() => submit()}
          >
            <Send className="w-4 h-4" />
            {sending ? 'Sending…' : replyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
