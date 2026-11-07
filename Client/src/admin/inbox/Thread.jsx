import { Bot, Lock } from 'lucide-react';
import Attachment from './Attachment';
import { fmtTime, hideLinks } from './utils';

function dayKey(ts) {
  return new Date(Number(ts)).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

function dayLabel(ts) {
  const key = dayKey(ts);
  const today = dayKey(Date.now());
  const yesterday = dayKey(Date.now() - 86400000);
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  return new Date(Number(ts)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Cairo' });
}

/** Messages and internal notes in one timeline, grouped by day. */
export default function Thread({ items, customerName, userName, endRef }) {
  if (!items.length) return <div className="p-12 text-center text-xs text-slate-400">No messages in this chat yet.</div>;
  let lastDay = null;
  return (
    <>
      {items.map((msg) => {
        const day = dayKey(msg.created_at);
        const divider = day !== lastDay ? (
          <div key={`d-${day}`} className="my-2 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            {dayLabel(msg.created_at)}
            <span className="h-px flex-1 bg-slate-200" />
          </div>
        ) : null;
        lastDay = day;

        if (msg.kind === 'note') {
          return [
            divider,
            <div key={msg.id} className="mx-auto w-full max-w-lg rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 sm:text-xs">
              <div className="mb-0.5 flex items-center justify-between gap-2 text-[10px] font-bold text-amber-700">
                <span className="flex items-center gap-1">
                  <Lock className="h-3 w-3" /> Note · {msg.user_name || (msg.user_id ? userName(msg.user_id) : 'System')}
                </span>
                <span>{fmtTime(msg.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap">{msg.body}</p>
            </div>,
          ];
        }

        const inbound = msg.direction === 'in';
        const bot = msg.sender_type === 'ai';
        const external = msg.sender_type === 'external';
        const who = inbound ? customerName || 'Guest' : bot ? 'Chatbot' : external ? 'Sent from the phone app' : msg.user_name || userName(msg.user_id);
        return [
          divider,
          <div key={msg.id} className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-xl ${
                inbound
                  ? 'rounded-tl-sm border border-slate-200 bg-white text-slate-800'
                  : bot
                    ? 'rounded-tr-sm bg-indigo-50 text-indigo-950 ring-1 ring-indigo-200'
                    : 'rounded-tr-sm bg-soul-blue text-white'
              }`}
            >
              <div className={`mb-0.5 flex items-center justify-between gap-4 text-[10px] ${inbound || bot ? 'text-slate-400' : 'text-white/70'}`}>
                <span className="flex items-center gap-1 font-semibold">
                  {bot ? <Bot className="h-3 w-3" /> : null}
                  {who}
                </span>
                <span>{fmtTime(msg.created_at)}</span>
              </div>
              <p dir="auto" className="whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere]">{inbound ? hideLinks(msg.body) : msg.body}</p>
              {(Array.isArray(msg.attachments) ? msg.attachments : []).map((attachment, index) => (
                <Attachment key={`${msg.id}-${index}`} message={msg} index={index} attachment={attachment} />
              ))}
              {msg.delivery_status === 'pending' ? <p className="mt-0.5 text-[10px] text-white/70">Sending…</p> : null}
              {msg.delivery_status === 'failed' ? (
                <p className={`mt-0.5 text-[10px] font-semibold ${inbound ? 'text-rose-600' : 'text-rose-100'}`}>Not delivered{msg.error ? `: ${msg.error}` : ''}</p>
              ) : null}
            </div>
          </div>,
        ];
      })}
      <div ref={endRef} />
    </>
  );
}
