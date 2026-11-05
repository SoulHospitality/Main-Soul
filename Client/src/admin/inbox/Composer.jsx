import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Paperclip, Send, Sparkles, X, MessageSquareText, Lock } from 'lucide-react';
import { errorMessage } from './api';

function fillReply(text, agentName, customerName) {
  return String(text || '')
    .replace(/\{\{\s*agent_name\s*\}\}/gi, () => agentName || '')
    .replace(/\{\{\s*customer_name\s*\}\}/gi, () => customerName || '');
}

// Drafts survive switching chats (and reloads) so nothing half-written is lost.
const DRAFT_KEY = (id) => `inbox-draft:${id}`;
function readDraft(id) {
  try {
    return localStorage.getItem(DRAFT_KEY(id)) || '';
  } catch {
    return '';
  }
}
function writeDraft(id, text) {
  try {
    if (text) localStorage.setItem(DRAFT_KEY(id), text);
    else localStorage.removeItem(DRAFT_KEY(id));
  } catch {
    /* private mode */
  }
}

const Composer = forwardRef(function Composer({ conversationId, customerName, agentName, replies, aiAvailable, windowClosed, channelKind, onSend, onSuggest }, ref) {
  const [body, setBody] = useState(() => readDraft(conversationId));
  const [note, setNote] = useState(false);
  const [openReplies, setOpenReplies] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [file, setFile] = useState(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const slash = body.startsWith('/') ? body.slice(1).trim().toLowerCase() : null;
  const matches = slash === null ? replies : replies.filter((r) => `${r.shortcut || ''} ${r.title || ''} ${r.body || ''}`.toLowerCase().includes(slash));

  // The page mounts one Composer per chat (key = chat id), so the draft always belongs to this chat.
  useEffect(() => {
    writeDraft(conversationId, body);
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [body, conversationId]);

  useImperativeHandle(ref, () => ({
    focus() {
      inputRef.current?.focus();
    },
    toggleNote() {
      setNote((v) => !v);
      inputRef.current?.focus();
    },
    openReplies() {
      setNote(false);
      setOpenReplies(true);
      setBody((v) => (v.startsWith('/') ? v : '/'));
      inputRef.current?.focus();
    },
  }), []);

  const apply = (text) => fillReply(text, agentName, customerName);

  const submit = (e) => {
    e?.preventDefault();
    const text = apply(body).trim();
    if (!text && !file) return;
    if (note && !text) return;
    setBody('');
    setOpenReplies(false);
    const sending = note ? null : file;
    setFile(null);
    onSend(text, note, sending);
  };

  const suggest = async () => {
    setSuggesting(true);
    try {
      const text = await onSuggest();
      if (text) {
        setNote(false);
        setBody(text);
        inputRef.current?.focus();
      } else toast.error('The AI had no suggestion');
    } catch (err) {
      toast.error(errorMessage(err, 'AI draft failed'));
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <div className={`flex-shrink-0 border-t bg-white px-2 py-2 sm:px-3 ${note ? 'border-amber-300' : 'border-slate-200'}`}>
      {windowClosed && !note && channelKind !== 'whatsapp' ? (
        <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
          The guest’s last message was over 24 hours ago, so Meta may not deliver this reply. Keep it short and relevant to their request.
        </p>
      ) : null}
      {(openReplies || slash !== null) && matches.length > 0 ? (
        <div className="mb-2 max-h-44 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-1">
          {matches.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                setBody(apply(r.body));
                setOpenReplies(false);
                inputRef.current?.focus();
              }}
              className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left hover:bg-white"
            >
              <span className="text-xs font-semibold text-slate-800">
                {r.shortcut ? <span className="mr-1 text-slate-400">/{r.shortcut}</span> : null}
                {r.title}
              </span>
              <span dir="auto" className="line-clamp-1 text-[11px] text-slate-500">{apply(r.body)}</span>
            </button>
          ))}
        </div>
      ) : null}
      {file ? (
        <div className="mb-2 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">
          <Paperclip className="h-3.5 w-3.5" />
          <span className="max-w-[16rem] truncate">{file.name}</span>
          <button type="button" onClick={() => setFile(null)} aria-label="Remove attachment" className="text-slate-400 hover:text-rose-600">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      <form onSubmit={submit} className={`rounded-xl border ${note ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-slate-50'} focus-within:ring-2 ${note ? 'focus-within:ring-amber-300/40' : 'focus-within:ring-soul-blue/20'}`}>
        <textarea
          ref={inputRef}
          rows={1}
          dir="auto"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && slash !== null && matches[0]) {
              e.preventDefault();
              setBody(apply(matches[0].body));
              setOpenReplies(false);
              return;
            }
            if (e.key === 'Escape') {
              e.currentTarget.blur();
              return;
            }
            const coarse = window.matchMedia('(pointer: coarse)').matches;
            if (e.key === 'Enter' && !e.shiftKey && !coarse) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={note ? 'Internal note: only the team sees this. @name to mention.' : `Reply to ${customerName || 'guest'} · / for saved replies`}
          className="max-h-40 min-h-[44px] w-full resize-none bg-transparent px-3 pt-2.5 text-base focus:outline-none sm:text-sm"
        />
        <div className="flex items-center gap-1 px-1.5 pb-1.5">
          <div className="flex rounded-lg bg-white p-0.5 text-[11px] ring-1 ring-slate-200">
            <button type="button" onClick={() => setNote(false)} className={`rounded-md px-2 py-1 font-semibold ${!note ? 'bg-soul-blue text-white' : 'text-slate-500'}`}>
              Reply
            </button>
            <button type="button" onClick={() => setNote(true)} className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold ${note ? 'bg-amber-500 text-white' : 'text-slate-500'}`} title="Note (N)">
              <Lock className="h-3 w-3" /> Note
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,audio/mpeg,audio/ogg,audio/aac,audio/mp4,application/pdf"
            onChange={(e) => {
              const next = e.target.files?.[0];
              e.target.value = '';
              if (!next) return;
              if (next.size > 16 * 1024 * 1024) return toast.error('File must be under 16 MB');
              setNote(false);
              return setFile(next);
            }}
          />
          <button type="button" onClick={() => fileRef.current?.click()} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-800" aria-label="Attach a file" title="Image, video, audio or PDF, up to 16 MB">
            <Paperclip className="h-4 w-4" />
          </button>
          {replies.length ? (
            <button type="button" onClick={() => setOpenReplies((v) => !v)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-800" aria-label="Saved replies" title="Saved replies (/)">
              <MessageSquareText className="h-4 w-4" />
            </button>
          ) : null}
          {aiAvailable ? (
            <button type="button" disabled={suggesting} onClick={suggest} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-indigo-600 hover:bg-white disabled:opacity-50" title="Draft a reply with AI">
              <Sparkles className="h-3.5 w-3.5" />
              {suggesting ? 'Writing…' : 'AI draft'}
            </button>
          ) : null}
          <button
            type="submit"
            aria-label={note ? 'Save note' : 'Send'}
            disabled={(!body.trim() && !file) || (note && !body.trim())}
            className={`ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold text-white disabled:opacity-40 ${note ? 'bg-amber-500' : 'bg-soul-blue'}`}
          >
            <Send className="h-3.5 w-3.5" />
            {note ? 'Save note' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
});

export default Composer;
