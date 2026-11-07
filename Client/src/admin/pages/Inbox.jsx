import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CheckCircle2, ChevronLeft, Inbox as InboxIcon, Keyboard, MessageSquare, PanelRight, Sparkles, User, UserX, X } from 'lucide-react';
import { useInbox, useInboxEvents } from '../inbox/InboxContext';
import { inboxApi, errorMessage } from '../inbox/api';
import { CHANNELS, CONVERSATION_TYPES } from '../inbox/utils';
import { Avatar, ChannelDot, PresenceDot, SlaChip, useNow } from '../inbox/ui';
import GuestRail from '../inbox/GuestRail';
import ConversationList, { QUEUES, STATES } from '../inbox/ConversationList';
import Thread from '../inbox/Thread';
import Composer from '../inbox/Composer';
import { AssignButton, CloseButton, CloseDialog, MoreMenu, SnoozeButton, snoozeOptions } from '../inbox/ChatActions';

const SHORTCUTS = [
  ['J / K', 'Next / previous chat'],
  ['R', 'Reply (focus the box)'],
  ['N', 'Write an internal note'],
  ['/', 'Saved replies'],
  ['A', 'Take the chat yourself'],
  ['W', 'Waiting on the guest'],
  ['S', 'Snooze'],
  ['E', 'Close'],
  ['Esc', 'Leave the reply box'],
  ['?', 'Show these shortcuts'],
];

function parsePeople(conv) {
  if (!conv) return [];
  let rows = [];
  if (Array.isArray(conv.assignees)) rows = conv.assignees;
  else if (typeof conv.assignees === 'string') {
    try {
      rows = JSON.parse(conv.assignees);
    } catch {
      rows = [];
    }
  }
  if (rows.length) return rows;
  return conv.assigned_user_id ? [{ id: conv.assigned_user_id, name: conv.assigned_name }] : [];
}

function summaryText(s) {
  if (!s) return '';
  return [s.summary, s.next_action ? `Next: ${s.next_action}` : ''].filter(Boolean).join('\n');
}

export default function InboxPage() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const { me, can, setPresence, setViewing, userName, connected, viewers } = useInbox();
  const now = useNow(30000);
  const activeId = params.get('c') ? Number(params.get('c')) : null;
  const myId = me?.user?.id;

  const [queue, setQueue] = useState(() => {
    try {
      return localStorage.getItem('inbox-queue-v2') || 'open';
    } catch {
      return 'open';
    }
  });
  const [state, setState] = useState('');
  const [channel, setChannel] = useState('');
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  // Guest details stay closed until someone opens them, so the chat gets the room.
  const [showRail, setShowRail] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [closing, setClosing] = useState(null); // { ids: [...] }
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(null); // 'assign' | 'snooze'
  const [showKeys, setShowKeys] = useState(false);
  const endRef = useRef(null);
  const composerRef = useRef(null);
  const listTimer = useRef(null);
  const threadTimer = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem('inbox-queue-v2', queue);
    } catch {
      /* ignore */
    }
  }, [queue]);
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    setViewing(activeId);
    return () => setViewing(null);
  }, [activeId, setViewing]);

  const list = useQuery({
    queryKey: ['inbox-conversations', queue, state, channel, searchDebounced],
    queryFn: () => inboxApi.get('/conversations', { view: queue, state: state || undefined, channel: channel || undefined, search: searchDebounced || undefined }),
    refetchInterval: 45000,
    refetchOnWindowFocus: false,
    staleTime: 15000,
    placeholderData: (prev) => prev,
  });
  const conversations = useMemo(() => list.data?.items || [], [list.data]);
  const counts = list.data?.counts || {};
  const viewerMap = Object.keys(viewers || {}).length ? viewers : list.data?.viewers || {};
  const othersOn = useCallback(
    (id) => (viewerMap?.[id] || viewerMap?.[String(id)] || []).filter((uid) => Number(uid) !== Number(myId)),
    [viewerMap, myId]
  );

  const detail = useQuery({
    queryKey: ['inbox-conversation', activeId],
    queryFn: () => inboxApi.get(`/conversations/${activeId}`),
    enabled: Boolean(activeId),
    refetchInterval: 60000,
    refetchOnWindowFocus: false,
    staleTime: 10000,
  });
  const conv = detail.data?.conversation || null;
  const people = parsePeople(conv);

  const { data: quickReplies = [] } = useQuery({
    queryKey: ['inbox-quick-replies'],
    queryFn: () => inboxApi.get('/admin/quick-replies'),
    enabled: Boolean(me),
  });
  const replies = (Array.isArray(quickReplies) && quickReplies.length ? quickReplies : null) || me?.templates || [];

  const refreshAll = useCallback(() => {
    list.refetch();
    if (activeId) detail.refetch();
  }, [list, detail, activeId]);

  useInboxEvents((type, data) => {
    if (type === 'message' && data?.conversation_id === activeId) {
      clearTimeout(threadTimer.current);
      threadTimer.current = setTimeout(() => detail.refetch(), 1200);
    }
    if (type === 'conversation' || type === 'message') {
      clearTimeout(listTimer.current);
      listTimer.current = setTimeout(() => list.refetch(), 1200);
    }
  });

  // Opening a chat you're on clears its unread count.
  useEffect(() => {
    if (!conv?.id || !conv.unread_count) return;
    inboxApi.post(`/conversations/${conv.id}/read`).then(() => list.refetch()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv?.id, conv?.unread_count]);

  const thread = useMemo(() => {
    const messages = (detail.data?.messages || []).map((m) => ({ ...m, kind: 'message' }));
    const notes = (detail.data?.notes || []).map((n) => ({ id: `note-${n.id}`, kind: 'note', user_id: n.user_id, user_name: n.user_name, body: n.body, created_at: n.created_at }));
    return [...messages, ...notes].sort((a, b) => Number(a.created_at) - Number(b.created_at));
  }, [detail.data]);

  useEffect(() => {
    if (thread.length) endRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [thread.length, activeId]);

  const select = (id) => setParams({ c: id });
  const back = () =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('c');
      return next;
    });

  // ── actions ──
  const act = async (fn, ok) => {
    try {
      await fn();
      if (ok) toast.success(ok);
      refreshAll();
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    }
  };
  const assign = (id, userId) => act(() => inboxApi.post(`/conversations/${id}/assign`, { user_id: userId }), Number(userId) === Number(myId) ? 'You’re on this chat' : `Assigned to ${userName(userId)}`);
  const unassign = (id, userId) => act(() => inboxApi.post(`/conversations/${id}/assign`, { user_id: userId, remove: true }), 'Removed from the chat');
  const setStatus = (id, status, extra = {}) => act(() => inboxApi.post(`/conversations/${id}/status`, { status, ...extra }), null);
  const snooze = (id, at) =>
    act(() => inboxApi.post(`/conversations/${id}/status`, { status: 'snoozed', snooze_until: at }), `Snoozed until ${new Date(at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' })}`);
  // Classification shows at once; the server catches up in the background.
  const setType = async (type) => {
    if (!conv) return;
    const id = conv.id;
    const before = conv.type;
    const patch = (t) => {
      qc.setQueryData(['inbox-conversation', id], (old) => (old ? { ...old, conversation: { ...old.conversation, type: t } } : old));
      qc.setQueriesData({ queryKey: ['inbox-conversations'] }, (old) => (old?.items ? { ...old, items: old.items.map((c) => (c.id === id ? { ...c, type: t } : c)) } : old));
    };
    patch(type);
    try {
      await inboxApi.post(`/conversations/${id}/type`, { type });
      toast.success(`Marked as ${CONVERSATION_TYPES[type] || type}`);
    } catch (err) {
      patch(before);
      toast.error(errorMessage(err));
    }
  };

  // After a chat leaves the queue (closed or snoozed), open the next one, like working through tickets.
  const goNext = (doneIds) => {
    const idx = conversations.findIndex((c) => c.id === activeId);
    const rest = conversations.filter((c) => !doneIds.includes(c.id));
    const next = rest[Math.min(Math.max(idx, 0), rest.length - 1)];
    if (next && window.innerWidth >= 1024) select(next.id);
    else back();
  };

  const confirmClose = async ({ type, note }) => {
    setBusy(true);
    const ids = closing.ids;
    let done = 0;
    for (const id of ids) {
      try {
        await inboxApi.post(`/conversations/${id}/close`, { type, note: ids.length === 1 ? note : undefined });
        done += 1;
      } catch (err) {
        toast.error(errorMessage(err));
      }
    }
    setBusy(false);
    setClosing(null);
    setSelected(new Set());
    if (done) toast.success(done === 1 ? 'Chat closed' : `${done} chats closed`);
    if (ids.includes(activeId)) goNext(ids);
    refreshAll();
  };

  const summarize = async () => {
    if (!conv) return '';
    try {
      const res = await inboxApi.post(`/conversations/${conv.id}/ai/summary`);
      return summaryText(res?.summary);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not summarise'));
      return '';
    }
  };

  const send = (text, asNote, file) => {
    if ((!text && !file) || !activeId) return;
    const tempId = `local-${Date.now()}`;
    const stamp = Date.now();
    const mine = { id: myId, name: me?.user?.name };
    const localUrl = file ? URL.createObjectURL(file) : null;
    qc.setQueryData(['inbox-conversation', activeId], (old) => {
      if (!old) return old;
      if (asNote) return { ...old, notes: [...(old.notes || []), { id: tempId, body: text, user_id: mine.id, user_name: mine.name, created_at: stamp }] };
      return {
        ...old,
        messages: [
          ...(old.messages || []),
          {
            id: tempId, direction: 'out', sender_type: 'agent', body: text, user_id: mine.id, user_name: mine.name, created_at: stamp, delivery_status: 'pending',
            attachments: file ? [{ type: (file.type || 'file').split('/')[0] || 'file', url: localUrl, mime: file.type, filename: file.name }] : [],
          },
        ],
      };
    });
    let request;
    if (asNote) request = inboxApi.post(`/conversations/${activeId}/notes`, { body: text });
    else if (file) {
      const form = new FormData();
      form.append('file', file);
      if (text) form.append('caption', text);
      request = inboxApi.upload(`/conversations/${activeId}/attachments`, form);
    } else request = inboxApi.post(`/conversations/${activeId}/messages`, { text });
    const convId = activeId;
    request
      .then((res) => {
        if (localUrl) setTimeout(() => URL.revokeObjectURL(localUrl), 1500);
        if (!asNote && res?.message) {
          qc.setQueryData(['inbox-conversation', convId], (old) =>
            old ? { ...old, messages: (old.messages || []).map((m) => (m.id === tempId ? { ...res.message, user_name: mine.name, attachments: res.message.attachments || [] } : m)) } : old
          );
        }
        list.refetch();
      })
      .catch((err) => {
        qc.setQueryData(['inbox-conversation', convId], (old) => {
          if (!old) return old;
          if (asNote) return { ...old, notes: (old.notes || []).filter((n) => n.id !== tempId) };
          return { ...old, messages: (old.messages || []).map((m) => (m.id === tempId ? { ...m, delivery_status: 'failed', error: errorMessage(err, 'Not sent') } : m)) };
        });
        toast.error(errorMessage(err, 'Message not sent'));
      });
  };

  const suggest = async () => {
    if (!activeId) return '';
    const res = await inboxApi.post(`/conversations/${activeId}/ai/suggest`);
    return res?.text || res?.suggestion || '';
  };

  // ── bulk ──
  const toggleSelect = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const bulk = async (fn, label) => {
    const ids = [...selected];
    let ok = 0;
    for (const id of ids) {
      try {
        await fn(id);
        ok += 1;
      } catch (err) {
        toast.error(errorMessage(err));
      }
    }
    if (ok) toast.success(`${label}: ${ok} chat${ok === 1 ? '' : 's'}`);
    setSelected(new Set());
    refreshAll();
  };

  // ── keyboard ──
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
      if (closing) return;
      const k = e.key;
      if (k === 'j' || k === 'k') {
        e.preventDefault();
        const idx = conversations.findIndex((c) => c.id === activeId);
        const next = k === 'j' ? conversations[idx < 0 ? 0 : Math.min(conversations.length - 1, idx + 1)] : conversations[idx <= 0 ? 0 : idx - 1];
        if (next) select(next.id);
      } else if (k === '?') setShowKeys((v) => !v);
      else if (!conv) return;
      else if (k === 'r') {
        e.preventDefault();
        composerRef.current?.focus();
      } else if (k === 'n') {
        e.preventDefault();
        composerRef.current?.toggleNote();
      } else if (k === '/') {
        e.preventDefault();
        composerRef.current?.openReplies();
      } else if (k === 'a' && !people.some((p) => Number(p.id) === Number(myId))) assign(conv.id, myId);
      else if (k === 'w' && conv.status !== 'closed') setStatus(conv.id, 'waiting_customer');
      else if (k === 's') setMenu('snooze');
      else if (k === 'e' && conv.status !== 'closed') setClosing({ ids: [conv.id], type: conv.type });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const queueCount = (key) => (key === 'closed' ? null : counts[key]);
  const windowClosed = conv?.window && conv.window.open === false;

  return (
    <div className="inbox-shell flex-row bg-slate-50 font-sans">
      {/* Sidebar: one place to choose what you see. Queues (whose), status (what's needed), channel, then you. */}
      <aside className="hidden w-52 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
          <h1 className="text-base font-bold text-slate-900">Inbox</h1>
          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${connected ? 'text-emerald-700' : 'text-amber-700'}`} title={connected ? 'Live updates on' : 'Reconnecting'}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {connected ? 'Live' : 'Reconnecting'}
          </span>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3" aria-label="Inbox filters">
          <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Queues</p>
          <div className="space-y-0.5">
            {QUEUES.map((qd) => {
              const Icon = { open: InboxIcon, mine: User, unassigned: UserX, closed: CheckCircle2 }[qd.key];
              const on = queue === qd.key;
              const n = queueCount(qd.key);
              return (
                <button
                  key={qd.key}
                  type="button"
                  onClick={() => {
                    setQueue(qd.key);
                    setState('');
                    setSelected(new Set());
                  }}
                  className={`flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-medium ${on ? 'bg-soul-blue text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                >
                  <Icon className={`h-4 w-4 ${on ? 'text-white' : 'text-slate-400'}`} />
                  <span className="flex-1">{qd.label}</span>
                  {n ? <span className={`rounded-full px-1.5 text-[11px] font-bold ${on ? 'bg-white/20' : qd.key === 'unassigned' ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>{n}</span> : null}
                </button>
              );
            })}
          </div>

          {queue !== 'closed' ? (
            <>
              <p className="px-2 pb-1.5 pt-5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Status</p>
              <div className="space-y-0.5">
                {STATES.map((st) => {
                  const on = state === st.key;
                  const n = st.key ? counts.states?.[st.key] : counts.states?.total;
                  const alert = st.key === 'overdue' && n > 0;
                  return (
                    <button
                      key={st.key || 'all'}
                      type="button"
                      onClick={() => setState(st.key)}
                      className={`flex h-8 w-full items-center justify-between rounded-lg px-2.5 text-left text-[13px] ${on ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                      <span className={alert ? 'font-semibold text-rose-700' : ''}>{st.label}</span>
                      {n ? <span className={`text-[11px] font-semibold ${alert ? 'rounded-full bg-rose-100 px-1.5 text-rose-700' : 'text-slate-400'}`}>{n}</span> : null}
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          <p className="px-2 pb-1.5 pt-5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Channel</p>
          <div className="space-y-0.5">
            {[['', 'All channels'], ...Object.entries(CHANNELS).map(([k, c]) => [k, c.label])].map(([k, label]) => (
              <button key={k || 'all'} type="button" onClick={() => setChannel(k)} className={`flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] ${channel === k ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-600 hover:bg-slate-50'}`}>
                {k ? <ChannelDot kind={k} /> : <span className="h-2.5 w-2.5" />}
                {label}
              </button>
            ))}
          </div>
        </nav>
        <div className="space-y-1.5 border-t border-slate-200 p-2">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">You are</p>
          <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-[11px]" title="New chats are routed to people who are online">
            {['online', 'away', 'offline'].map((p) => (
              <button key={p} type="button" onClick={() => setPresence(p)} className={`flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 font-medium ${me?.user?.presence === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                <PresenceDot presence={p} />
                {p === 'online' ? 'Online' : p === 'away' ? 'Away' : 'Off'}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setShowKeys(true)} className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] text-slate-500 hover:bg-slate-50">
            <Keyboard className="h-3.5 w-3.5" /> Keyboard shortcuts <kbd className="rounded bg-slate-100 px-1">?</kbd>
          </button>
        </div>
      </aside>

      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* List */}
        <div className={`${activeId ? 'hidden lg:flex' : 'flex'} min-h-0 w-full flex-shrink-0 flex-col border-r border-slate-200 bg-white lg:w-[19rem] 2xl:w-[22rem]`}>
          <div className="flex items-center gap-2 border-b border-slate-200 p-2 lg:hidden">
            <select aria-label="Queue" value={queue} onChange={(e) => { setQueue(e.target.value); setState(''); }} className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm font-medium">
              {QUEUES.map((qd) => (
                <option key={qd.key} value={qd.key}>
                  {qd.label}
                  {queueCount(qd.key) ? ` (${queueCount(qd.key)})` : ''}
                </option>
              ))}
            </select>
            <select aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm">
              <option value="">All channels</option>
              {Object.entries(CHANNELS).map(([k, c]) => (
                <option key={k} value={k}>{c.label}</option>
              ))}
            </select>
            <select aria-label="My status" value={me?.user?.presence || 'offline'} onChange={(e) => setPresence(e.target.value)} className="h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm">
              <option value="online">On</option>
              <option value="away">Away</option>
              <option value="offline">Off</option>
            </select>
          </div>
          <ConversationList
            items={conversations}
            loading={list.isLoading}
            activeId={activeId}
            onSelect={select}
            queue={queue}
            state={state}
            onState={setState}
            stateCounts={counts.states}
            search={search}
            onSearch={setSearch}
            selected={selected}
            onToggleSelect={toggleSelect}
            peopleOn={parsePeople}
            myId={myId}
            othersOn={othersOn}
            userName={userName}
            now={now}
          />
          {selected.size ? (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200 bg-slate-900 px-3 py-2 text-white">
              <span className="text-xs font-semibold">{selected.size} selected</span>
              <button type="button" className="rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold hover:bg-white/20" onClick={() => bulk((id) => inboxApi.post(`/conversations/${id}/assign`, { user_id: myId }), 'Taken')}>
                Take
              </button>
              <button
                type="button"
                className="rounded-md bg-white/10 px-2 py-1 text-[11px] font-semibold hover:bg-white/20"
                onClick={() => {
                  const at = snoozeOptions(me?.rules?.business_start || '11:00').find((o) => o.key === 'morning').at;
                  bulk((id) => inboxApi.post(`/conversations/${id}/status`, { status: 'snoozed', snooze_until: at }), 'Snoozed till tomorrow');
                }}
              >
                Snooze
              </button>
              <button type="button" className="rounded-md bg-emerald-500 px-2 py-1 text-[11px] font-semibold hover:bg-emerald-600" onClick={() => setClosing({ ids: [...selected] })}>
                Close
              </button>
              <button type="button" className="ml-auto rounded p-1 hover:bg-white/10" onClick={() => setSelected(new Set())} aria-label="Clear selection">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </div>

        {/* Chat */}
        <div className={`${activeId ? 'flex' : 'hidden lg:flex'} min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-100`}>
          {activeId && conv ? (
            <>
              <div className="flex min-h-14 flex-shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-2 py-2 sm:px-4">
                <button type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Back" onClick={back}>
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <Avatar name={conv.customer_name} url={conv.avatar_url} kind={conv.channel_kind} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h2 className="truncate text-sm font-bold text-slate-900">{conv.customer_name || 'Guest'}</h2>
                    <span className="text-[10px] text-slate-400">#{conv.id}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                    <span>{CHANNELS[conv.channel_kind]?.label}</span>
                    {conv.type && conv.type !== 'unknown' ? <span>· {CONVERSATION_TYPES[conv.type]}</span> : null}
                    <SlaChip conversation={conv} now={now} />
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <AssignButton
                    users={me?.users}
                    people={people}
                    myId={myId}
                    canAssign={can('conv.assign')}
                    onAssign={(uid) => assign(conv.id, uid)}
                    onRemove={(uid) => unassign(conv.id, uid)}
                    open={menu === 'assign'}
                    setOpen={(v) => setMenu(v ? 'assign' : null)}
                  />
                  {conv.status !== 'closed' ? (
                    <SnoozeButton onSnooze={async (at) => { const id = conv.id; if ((await snooze(id, at)) && state !== 'snoozed') goNext([id]); }} businessStart={me?.rules?.business_start || '11:00'} open={menu === 'snooze'} setOpen={(v) => setMenu(v ? 'snooze' : null)} />
                  ) : null}
                  <MoreMenu
                    status={conv.status}
                    open={menu === 'more'}
                    setOpen={(v) => setMenu(v ? 'more' : null)}
                    aiAvailable={Boolean(me?.aiAvailable)}
                    onNeedsReply={() => setStatus(conv.id, 'needs_reply')}
                    onWaiting={() => setStatus(conv.id, 'waiting_customer')}
                    onSummary={async () => {
                      const t = toast.loading('Summarising…');
                      const text = await summarize();
                      toast.dismiss(t);
                      if (text) detail.refetch();
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowRail((v) => !v)}
                    className={`grid h-9 w-9 place-items-center rounded-lg border ${showRail ? 'border-soul-blue bg-soul-blue text-white' : 'border-slate-200 bg-white text-slate-600'}`}
                    aria-label="Guest details"
                    title="Guest details: who they are, their stays and the stay request"
                  >
                    <PanelRight className="h-4 w-4" />
                  </button>
                  <CloseButton
                    status={conv.status}
                    onReopen={() => setStatus(conv.id, 'needs_reply')}
                    onClose={() => setClosing({ ids: [conv.id], type: conv.type })}
                  />
                </div>
              </div>

              {othersOn(conv.id).length ? (
                <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-900">
                  👀 {othersOn(conv.id).map((id) => userName(id)).join(', ')} {othersOn(conv.id).length === 1 ? 'has' : 'have'} this chat open too. Check before you reply.
                </div>
              ) : null}
              {conv.status === 'snoozed' && conv.snooze_until ? (
                <div className="border-b border-indigo-200 bg-indigo-50 px-4 py-1.5 text-xs text-indigo-900">
                  Snoozed until {new Date(Number(conv.snooze_until)).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' })}. It comes back on its own, or when the guest writes.
                </div>
              ) : null}
              {conv.ai_summary?.summary ? (
                <details className="border-b border-slate-200 bg-white px-4 py-1.5 text-xs text-slate-600">
                  <summary className="cursor-pointer font-semibold text-indigo-700">
                    <Sparkles className="mr-1 inline h-3.5 w-3.5" />
                    Summary
                  </summary>
                  <p dir="auto" className="mt-1 whitespace-pre-wrap">{summaryText(conv.ai_summary)}</p>
                </details>
              ) : null}

              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-3 py-3 sm:px-5">
                <Thread items={thread} customerName={conv.customer_name} userName={userName} endRef={endRef} />
              </div>

              <Composer
                key={conv.id}
                ref={composerRef}
                conversationId={conv.id}
                customerName={conv.customer_name}
                agentName={me?.user?.name}
                replies={replies}
                aiAvailable={Boolean(me?.aiAvailable)}
                windowClosed={windowClosed}
                closed={conv.status === 'closed'}
                unassigned={!people.length}
                channelKind={conv.channel_kind}
                onSend={send}
                onSuggest={suggest}
              />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-slate-200 text-slate-400">
                <MessageSquare className="h-8 w-8" />
              </div>
              <h2 className="text-base font-bold text-slate-700">Pick a chat</h2>
              <p className="mt-1 max-w-sm text-xs text-slate-400">
                Oldest waiting guests are at the top. Press <kbd className="rounded bg-slate-200 px-1">J</kbd> to start, <kbd className="rounded bg-slate-200 px-1">?</kbd> for all shortcuts.
              </p>
            </div>
          )}
        </div>

        {/* Guest details */}
        {showRail && activeId && conv ? (
          <div className="absolute inset-0 z-20 overflow-y-auto bg-white p-4 pb-8 xl:static xl:z-auto xl:w-[19rem] xl:flex-shrink-0 xl:border-l xl:border-slate-200 xl:pb-4 2xl:w-80">
            <button type="button" className="mb-3 inline-flex h-10 items-center gap-1 text-sm font-semibold text-soul-blue xl:hidden" onClick={() => setShowRail(false)}>
              <ChevronLeft className="h-4 w-4" /> Back to chat
            </button>
            <GuestRail
              conversation={conv}
              customer={detail.data?.customer}
              leads={detail.data?.leads}
              onType={setType}
              onChanged={refreshAll}
            />
          </div>
        ) : null}
      </div>

      {closing ? (
        <CloseDialog
          count={closing.ids.length}
          currentType={closing.type}
          busy={busy}
          onCancel={() => setClosing(null)}
          onConfirm={confirmClose}
          onSummarize={closing.ids.length === 1 && me?.aiAvailable ? summarize : null}
        />
      ) : null}

      {showKeys ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowKeys(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-base font-bold text-slate-900">Keyboard shortcuts</h2>
            <dl className="space-y-1.5 text-sm">
              {SHORTCUTS.map(([k, d]) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <dt className="text-slate-600">{d}</dt>
                  <dd>
                    <kbd className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-semibold text-slate-700">{k}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      ) : null}
    </div>
  );
}
