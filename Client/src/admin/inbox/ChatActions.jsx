import { useEffect, useRef, useState } from 'react';
import { AlarmClock, CheckCircle2, ChevronDown, MoreHorizontal, RotateCcw, UserPlus } from 'lucide-react';
import { PresenceDot } from './ui';
import { CONVERSATION_TYPES, nextCairoTime, toLocalInput, fromLocalInput } from './utils';

function useOutside(ref, onClose) {
  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, onClose]);
}

function Menu({ open, onClose, children, align = 'right' }) {
  const ref = useRef(null);
  useOutside(ref, onClose);
  if (!open) return null;
  return (
    <div ref={ref} className={`absolute top-full z-30 mt-1 w-60 rounded-xl border border-slate-200 bg-white p-1 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}>
      {children}
    </div>
  );
}

function MenuItem({ onClick, children, hint }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
      <span className="flex items-center gap-2">{children}</span>
      {hint ? <kbd className="text-[10px] text-slate-400">{hint}</kbd> : null}
    </button>
  );
}

/** Times that fit the team's day: soon, later today, the morning, next week, or any time. */
export function snoozeOptions(businessStart = '11:00') {
  const now = Date.now();
  const morning = nextCairoTime(businessStart);
  return [
    { key: '1h', label: 'In 1 hour', at: now + 3600000 },
    { key: '3h', label: 'In 3 hours', at: now + 3 * 3600000 },
    { key: 'morning', label: `Tomorrow ${businessStart}`, at: morning < now + 12 * 3600000 ? morning + 86400000 : morning },
    { key: 'week', label: `In a week, ${businessStart}`, at: morning + 6 * 86400000 },
  ];
}

export function SnoozeButton({ onSnooze, businessStart, open, setOpen, compact = false }) {
  const [custom, setCustom] = useState(() => toLocalInput(Date.now() + 2 * 3600000));
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50" title="Snooze (S)">
        <AlarmClock className="h-4 w-4" />
        {compact ? null : <span className="hidden 2xl:inline">Snooze</span>}
      </button>
      <Menu open={open} onClose={() => setOpen(false)}>
        <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Bring it back</p>
        {snoozeOptions(businessStart).map((o) => (
          <MenuItem key={o.key} onClick={() => { setOpen(false); onSnooze(o.at); }}>
            {o.label}
          </MenuItem>
        ))}
        <div className="flex items-center gap-1 border-t border-slate-100 p-1.5">
          <input type="datetime-local" className="input h-8 flex-1 py-0 text-xs" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <button
            type="button"
            className="h-8 rounded-lg bg-soul-blue px-2 text-xs font-semibold text-white"
            onClick={() => {
              const at = fromLocalInput(custom);
              if (at && at > Date.now()) {
                setOpen(false);
                onSnooze(at);
              }
            }}
          >
            Set
          </button>
        </div>
      </Menu>
    </div>
  );
}

export function AssignButton({ users, people, myId, canAssign, onAssign, onRemove, open, setOpen }) {
  const onIt = new Set(people.map((p) => Number(p.id)));
  const team = (users || []).filter((u) => u.active);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50" title="Assign (A = take it yourself)">
        <UserPlus className="h-4 w-4" />
        <span className="hidden max-w-[8rem] truncate sm:inline lg:hidden xl:inline">
          {people.length ? people.map((p) => (Number(p.id) === Number(myId) ? 'You' : p.name)).join(', ') : 'Unassigned'}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
      </button>
      <Menu open={open} onClose={() => setOpen(false)}>
        {!onIt.has(Number(myId)) ? (
          <MenuItem hint="A" onClick={() => { setOpen(false); onAssign(myId); }}>
            <span className="font-semibold text-soul-blue">Take it myself</span>
          </MenuItem>
        ) : null}
        {canAssign ? (
          <>
            <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Team</p>
            <div className="max-h-64 overflow-y-auto">
              {team.map((u) => (
                <MenuItem key={u.id} onClick={() => { setOpen(false); if (onIt.has(Number(u.id))) onRemove(u.id); else onAssign(u.id); }}>
                  <PresenceDot presence={u.presence} />
                  <span className={onIt.has(Number(u.id)) ? 'font-semibold' : ''}>{Number(u.id) === Number(myId) ? `${u.name} (you)` : u.name}</span>
                  {onIt.has(Number(u.id)) ? <span className="text-[10px] text-slate-400">on chat · remove</span> : null}
                </MenuItem>
              ))}
            </div>
          </>
        ) : onIt.has(Number(myId)) ? (
          <MenuItem onClick={() => { setOpen(false); onRemove(myId); }}>Leave this chat</MenuItem>
        ) : null}
      </Menu>
    </div>
  );
}

/** The main action: Close an open chat, or Reopen a closed one. */
export function CloseButton({ status, onReopen, onClose }) {
  if (status === 'closed') {
    return (
      <button type="button" onClick={onReopen} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50" title="Reopen this chat">
        <RotateCcw className="h-4 w-4" /> Reopen
      </button>
    );
  }
  return (
    <button type="button" onClick={onClose} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700" title="Close (E)">
      <CheckCircle2 className="h-4 w-4" /> Close
    </button>
  );
}

/** Less frequent actions, kept out of the way. Replying already marks a chat "waiting on guest". */
export function MoreMenu({ status, open, setOpen, onNeedsReply, onWaiting, onSummary, aiAvailable }) {
  const items = [
    status !== 'needs_reply' && status !== 'closed'
      ? { key: 'nr', label: 'Needs a reply', hint: 'Put it back at the top of the queue', onClick: onNeedsReply }
      : null,
    status === 'needs_reply' ? { key: 'w', label: 'Waiting on guest', hint: 'No reply needed from us now (W)', onClick: onWaiting } : null,
    aiAvailable ? { key: 'ai', label: 'AI summary', hint: 'Who they are and what they need', onClick: onSummary } : null,
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" aria-label="More actions" title="More">
        <MoreHorizontal className="h-4 w-4" />
      </button>
      <Menu open={open} onClose={() => setOpen(false)}>
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            onClick={() => {
              setOpen(false);
              it.onClick();
            }}
            className="flex w-full flex-col items-start rounded-lg px-2.5 py-2 text-left hover:bg-slate-50"
          >
            <span className="text-sm font-medium text-slate-800">{it.label}</span>
            <span className="text-[11px] text-slate-500">{it.hint}</span>
          </button>
        ))}
      </Menu>
    </div>
  );
}

const CLOSE_TYPES = Object.entries(CONVERSATION_TYPES).filter(([k]) => k !== 'unknown');

/** Close with a reason: who this was (required) and an optional closing note for the team. */
export function CloseDialog({ count = 1, currentType, onCancel, onConfirm, busy, onSummarize }) {
  const [type, setType] = useState(currentType && currentType !== 'unknown' ? currentType : '');
  const [note, setNote] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-slate-900">{count > 1 ? `Close ${count} chats` : 'Close this chat'}</h2>
        <p className="mt-0.5 text-xs text-slate-500">Pick who this was so reports stay accurate. If they write again, the chat reopens on its own.</p>
        <div className="mt-4 grid grid-cols-2 gap-1.5">
          {CLOSE_TYPES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setType(key)}
              className={`rounded-lg border px-2.5 py-2 text-left text-xs font-medium ${type === key ? 'border-soul-blue bg-soul-blue text-white' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {count === 1 ? (
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-600">Closing note (optional)</label>
              {onSummarize ? (
                <button
                  type="button"
                  disabled={summarizing}
                  className="text-[11px] font-semibold text-indigo-600 hover:underline disabled:opacity-50"
                  onClick={async () => {
                    setSummarizing(true);
                    try {
                      const text = await onSummarize();
                      if (text) setNote(text);
                    } finally {
                      setSummarizing(false);
                    }
                  }}
                >
                  {summarizing ? 'Writing…' : '✨ Write it with AI'}
                </button>
              ) : null}
            </div>
            <textarea className="input min-h-[80px] text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was agreed, what's next…" />
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn-primary bg-emerald-600 hover:bg-emerald-700" disabled={!type || busy} onClick={() => onConfirm({ type, note })}>
            {busy ? 'Closing…' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
