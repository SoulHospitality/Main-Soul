import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, ExternalLink, Headset, Instagram, MessageCircle, Plus, Send, Trash2, User } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';

const STARTERS = [
  'عايز شاليه في الساحل لـ ٦ أفراد أول أسبوع في أغسطس',
  'Looking for a villa in El Gouna for 8 people next weekend, budget 15k a night',
  '3ayez sha2a 2 bedrooms fel Sokhna',
  'I want to change the dates of my booking',
  'مين صاحب الشقة دي وبتكسبوا منها كام؟',
];

function timeOf(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Turns plain URLs into links, keeping the rest as text. */
function Linkified({ text }) {
  const parts = String(text || '').split(/(https?:\/\/[^\s)]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer" className="break-all underline">
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function UnitCards({ units }) {
  if (!Array.isArray(units) || !units.length) return null;
  return (
    <div className="-mx-1 mt-2 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
      {units.map((u) => (
        <a
          key={u.id}
          href={u.link}
          target="_blank"
          rel="noreferrer"
          className="w-44 shrink-0 snap-start overflow-hidden rounded-xl border border-soul-line bg-white text-left shadow-sm hover:shadow"
        >
          {u.image ? <img src={u.image} alt="" className="h-24 w-full object-cover" loading="lazy" /> : <div className="h-24 bg-slate-100" />}
          <div className="space-y-0.5 p-2">
            <p className="line-clamp-2 text-xs font-semibold text-soul-blue">{u.title}</p>
            <p className="truncate text-[11px] text-soul-muted">{u.destination}</p>
            <p className="text-[11px] text-soul-muted">
              {u.bedrooms ? `${u.bedrooms} BR` : ''}
              {u.max_guests ? ` · ${u.max_guests} guests` : ''}
            </p>
            <p className="text-[11px] font-semibold text-soul-blue">
              {u.stay_total
                ? `EGP ${Number(u.stay_total).toLocaleString('en-EG')} · ${u.nights} nights`
                : u.price_per_night
                  ? `from EGP ${Number(u.price_per_night).toLocaleString('en-EG')}/night`
                  : ''}
            </p>
          </div>
        </a>
      ))}
    </div>
  );
}

function Bubble({ m, channel }) {
  if (m.role === 'system') {
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-full bg-amber-50 px-3 py-1 text-[11px] font-medium text-amber-800">{m.body}</span>
      </div>
    );
  }
  const mine = m.role === 'customer';
  const tone = mine
    ? channel === 'messenger'
      ? 'bg-[#0084ff] text-white'
      : 'bg-gradient-to-br from-[#7b3fe4] to-[#d6297f] text-white'
    : m.role === 'agent'
      ? 'bg-emerald-50 text-emerald-950 ring-1 ring-emerald-200'
      : 'bg-slate-100 text-slate-900';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
        {!mine ? (
          <span className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-soul-muted">
            {m.role === 'agent' ? <Headset className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
            {m.role === 'agent' ? 'Team (Live Inbox)' : 'Soul assistant'}
          </span>
        ) : null}
        <div dir="auto" className={`whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${tone}`}>
          <Linkified text={m.body} />
        </div>
        {m.role === 'bot' ? <UnitCards units={m.units} /> : null}
        <span className="mt-0.5 text-[10px] text-soul-muted">{timeOf(m.created_at)}</span>
      </div>
    </div>
  );
}

function NewChatForm({ onCreate, pending }) {
  const [name, setName] = useState('Test customer');
  const [channel, setChannel] = useState('instagram');
  return (
    <form
      className="space-y-2 rounded-xl border border-soul-line bg-white p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onCreate({ customer_name: name, channel_kind: channel });
      }}
    >
      <p className="text-sm font-semibold text-soul-blue">New test chat</p>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" />
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-0.5">
        {[
          { id: 'instagram', label: 'Instagram', icon: Instagram },
          { id: 'messenger', label: 'Messenger', icon: MessageCircle },
        ].map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setChannel(c.id)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium ${channel === c.id ? 'bg-white text-soul-blue shadow-sm' : 'text-slate-500'}`}
          >
            <c.icon className="h-3.5 w-3.5" /> {c.label}
          </button>
        ))}
      </div>
      <button type="submit" className="btn-primary w-full justify-center" disabled={pending}>
        <Plus className="h-4 w-4" /> Start chat
      </button>
    </form>
  );
}

export default function ChatbotTest() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState(null);
  const [draft, setDraft] = useState('');
  const [pendingText, setPendingText] = useState(null);
  const endRef = useRef(null);

  const status = useQuery({ queryKey: ['chatbot-status'], queryFn: () => api.get('/chatbot/status').then((r) => r.data) });
  const sessions = useQuery({ queryKey: ['chatbot-sessions'], queryFn: () => api.get('/chatbot/sessions').then((r) => r.data) });
  const chat = useQuery({
    queryKey: ['chatbot-session', activeId],
    queryFn: () => api.get(`/chatbot/sessions/${activeId}`).then((r) => r.data),
    enabled: Boolean(activeId),
    // After a hand-off, keep checking for agent replies from the Live Inbox.
    // While the bot is writing, check often; after a hand-off, keep checking for agent replies.
    refetchInterval: (q) => (q.state.data?.bot_typing ? 1500 : q.state.data?.status === 'handed_off' ? 4000 : false),
  });

  useEffect(() => {
    if (!activeId && sessions.data?.length) setActiveId(sessions.data[0].id);
  }, [sessions.data, activeId]);

  const create = useMutation({
    mutationFn: (body) => api.post('/chatbot/sessions', body).then((r) => r.data),
    onSuccess: (view) => {
      qc.setQueryData(['chatbot-session', view.id], view);
      qc.invalidateQueries({ queryKey: ['chatbot-sessions'] });
      setActiveId(view.id);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not start a chat'),
  });
  const send = useMutation({
    mutationFn: (text) => api.post(`/chatbot/sessions/${activeId}/messages`, { text }).then((r) => r.data),
    onMutate: (text) => {
      setPendingText(text);
      setDraft('');
    },
    onSuccess: (view) => {
      qc.setQueryData(['chatbot-session', view.id], view);
      qc.invalidateQueries({ queryKey: ['chatbot-sessions'] });
    },
    onError: (e, text) => {
      setDraft(text);
      toast.error(e.response?.data?.error || 'The assistant did not answer');
    },
    onSettled: () => setPendingText(null),
  });
  const remove = useMutation({
    mutationFn: (id) => api.delete(`/chatbot/sessions/${id}`),
    onSuccess: (_r, id) => {
      if (id === activeId) setActiveId(null);
      qc.invalidateQueries({ queryKey: ['chatbot-sessions'] });
    },
  });

  const view = chat.data;
  const messages = useMemo(() => view?.messages || [], [view]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, pendingText]);

  const submit = (text) => {
    const t = String(text || '').trim();
    if (!t || send.isPending || view?.bot_typing || !activeId) return;
    send.mutate(t);
  };

  return (
    <div className="space-y-4">
      <div className="page-header mb-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-soul-muted">Inbox & CRM · test only</p>
        <h1 className="page-title mt-1">Guest chatbot</h1>
        <p className="page-subtitle">
          Chat as a customer to test the assistant before it goes live on Instagram and Messenger. It answers about units, prices and
          availability in English and Egyptian Arabic, suggests up to 5 units at a time, and hands anything else to the Live Inbox.
        </p>
      </div>

      {status.data && !status.data.ai_configured ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">
          No AI key is set on the server. Add GEMINI_API_KEY (or ANTHROPIC_API_KEY) and the chatbot will start answering.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[17rem_1fr]">
        <aside className="space-y-3">
          <NewChatForm onCreate={(b) => create.mutate(b)} pending={create.isPending} />
          <div className="space-y-1.5">
            {(sessions.data || []).map((s) => (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onClick={() => setActiveId(s.id)}
                onKeyDown={(e) => (e.key === 'Enter' ? setActiveId(s.id) : null)}
                className={`group flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 ${s.id === activeId ? 'border-soul-blue bg-soul-blue-50/50' : 'border-soul-line bg-white hover:bg-slate-50'}`}
              >
                {s.channel_kind === 'messenger' ? <MessageCircle className="mt-0.5 h-4 w-4 text-[#0084ff]" /> : <Instagram className="mt-0.5 h-4 w-4 text-[#d6297f]" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-soul-blue">{s.customer_name}</p>
                  <p dir="auto" className="truncate text-[11px] text-soul-muted">{s.last_message || 'No messages yet'}</p>
                  {s.status === 'handed_off' ? <p className="text-[10px] font-semibold text-amber-700">With the team</p> : null}
                </div>
                <button
                  type="button"
                  aria-label="Delete chat"
                  className="hidden rounded p-1 text-soul-muted hover:text-rose-700 group-hover:block"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove.mutate(s.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="flex h-[72vh] min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-soul-line bg-white">
          {!activeId ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState icon={MessageCircle} title="Start a test chat on the left" />
            </div>
          ) : chat.isLoading ? (
            <LoadingSpinner />
          ) : view ? (
            <>
              <header className="flex items-center gap-3 border-b border-soul-line px-4 py-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100">
                  <User className="h-4 w-4 text-soul-muted" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-soul-blue">{view.customer_name}</p>
                  <p className="text-[11px] text-soul-muted">
                    {view.channel_kind === 'messenger' ? 'Messenger' : 'Instagram'} ·{' '}
                    {view.status === 'handed_off' ? (
                      <span className="font-medium text-amber-700">with the team in the Live Inbox</span>
                    ) : (
                      <span className="font-medium text-emerald-700">the assistant is answering</span>
                    )}
                    {view.shown_units ? ` · ${view.shown_units} units suggested` : ''}
                  </p>
                </div>
                {view.inbox_conversation_id ? (
                  <Link to={`/admin/inbox?c=${view.inbox_conversation_id}`} className="btn-secondary !py-1.5 text-xs">
                    <ExternalLink className="h-3.5 w-3.5" /> Open in inbox
                  </Link>
                ) : null}
              </header>

              <div className="flex-1 space-y-3 overflow-y-auto bg-[#fafafa] px-3 py-4 sm:px-5">
                {!messages.length && !pendingText ? (
                  <div className="space-y-2 py-6 text-center">
                    <p className="text-sm text-soul-muted">Write as the customer, or try one of these:</p>
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {STARTERS.map((s) => (
                        <button key={s} type="button" dir="auto" onClick={() => submit(s)} className="rounded-full border border-soul-line bg-white px-3 py-1 text-xs text-soul-blue hover:bg-slate-50">
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {messages.map((m) => (
                  <Bubble key={m.id} m={m} channel={view.channel_kind} />
                ))}
                {pendingText ? (
                  <Bubble m={{ id: 'pending', role: 'customer', body: pendingText, created_at: new Date().toISOString() }} channel={view.channel_kind} />
                ) : null}
                {pendingText || view.bot_typing ? (
                  <>
                    {view.status !== 'handed_off' ? (
                      <div className="flex items-center gap-1 pl-1 text-soul-muted">
                        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:120ms]" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:240ms]" />
                      </div>
                    ) : null}
                  </>
                ) : null}
                <div ref={endRef} />
              </div>

              <form
                className="flex items-end gap-2 border-t border-soul-line p-2.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit(draft);
                }}
              >
                <textarea
                  dir="auto"
                  rows={1}
                  className="input max-h-32 min-h-[2.5rem] flex-1 resize-none"
                  placeholder={view.status === 'handed_off' ? 'Message (goes to the team in the Live Inbox)…' : 'Message as the customer…'}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submit(draft);
                    }
                  }}
                />
                <button type="submit" className="btn-primary h-10 px-3" disabled={send.isPending || view.bot_typing || !draft.trim()} aria-label="Send">
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </>
          ) : null}
        </section>
      </div>

      {view?.tokens?.input ? (
        <p className="text-right text-[11px] text-soul-muted">
          This chat used {view.tokens.input.toLocaleString()} input and {view.tokens.output.toLocaleString()} output tokens
          {status.data?.model ? ` · ${status.data.provider === 'gemini' ? 'Gemini' : 'Claude'} ${status.data.model}${status.data.backup_model ? ` (backup ${status.data.backup_model})` : ''}${status.data.effort ? `, effort ${status.data.effort}` : ''}` : ''}.
        </p>
      ) : null}
    </div>
  );
}
