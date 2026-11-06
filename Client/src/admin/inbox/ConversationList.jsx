import { Search, X } from 'lucide-react';
import { Avatar, Chip, SlaChip } from './ui';
import { CONVERSATION_TYPES, timeAgo } from './utils';

/** Queues answer "whose chats"; states answer "what do they need". */
export const QUEUES = [
  { key: 'open', label: 'All open' },
  { key: 'mine', label: 'Mine' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'closed', label: 'Closed' },
];

export const STATES = [
  { key: '', label: 'Everything' },
  { key: 'needs_reply', label: 'Needs reply' },
  { key: 'overdue', label: 'Overdue', tone: 'text-rose-700' },
  { key: 'waiting', label: 'Waiting on guest' },
  { key: 'snoozed', label: 'Snoozed' },
  { key: 'hot', label: 'Hot' },
];

function waitingFor(conv, now) {
  if (conv.status !== 'needs_reply' || !conv.awaiting_since) return null;
  const mins = Math.max(0, Math.round((now - Number(conv.awaiting_since)) / 60000));
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

export default function ConversationList({
  items,
  loading,
  activeId,
  onSelect,
  queue,
  state,
  onState,
  stateCounts,
  search,
  onSearch,
  selected,
  onToggleSelect,
  peopleOn,
  myId,
  othersOn,
  userName,
  now,
  showStates = true,
}) {
  const selecting = selected.size > 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b border-slate-200 bg-white p-2.5 lg:flex lg:h-14 lg:flex-col lg:justify-center lg:space-y-0 lg:py-0">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search name, phone or chat #"
            className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-8 text-base focus:bg-white focus:outline-none focus:ring-2 focus:ring-soul-blue/20 sm:text-sm"
          />
          {search ? (
            <button type="button" onClick={() => onSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" aria-label="Clear search">
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        {showStates && queue !== 'closed' ? (
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 lg:hidden">
            {STATES.map((s) => {
              const n = s.key ? stateCounts?.[s.key] : stateCounts?.total;
              const on = state === s.key;
              return (
                <button
                  key={s.key || 'all'}
                  type="button"
                  onClick={() => onState(s.key)}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                    on ? 'border-soul-blue bg-soul-blue text-white' : `border-slate-200 bg-white hover:bg-slate-50 ${s.tone || 'text-slate-600'}`
                  }`}
                >
                  {s.label}
                  {n ? <span className={`rounded-full px-1 text-[10px] font-bold ${on ? 'bg-white/20' : 'bg-slate-100'}`}>{n}</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loading ? (
          <p className="p-8 text-center text-xs text-slate-400">Loading chats…</p>
        ) : !items.length ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-slate-600">{queue === 'mine' && !state ? 'You’re all caught up 🎉' : 'Nothing here'}</p>
            <p className="mt-1 text-xs text-slate-400">{queue === 'mine' ? 'Chats you’re on show here. Check Unassigned for new ones.' : 'Try another filter.'}</p>
          </div>
        ) : (
          items.map((conv) => {
            const active = conv.id === activeId;
            const overdue = conv.status === 'needs_reply' && conv.sla_due_at && Number(conv.sla_due_at) <= now && !(conv.sla_start_at && now < Number(conv.sla_start_at));
            const people = peopleOn(conv);
            const watching = othersOn(conv.id);
            const wait = waitingFor(conv, now);
            const isSelected = selected.has(conv.id);
            return (
              <div
                key={conv.id}
                role="button"
                tabIndex={0}
                onClick={() => (selecting ? onToggleSelect(conv.id) : onSelect(conv.id))}
                onKeyDown={(e) => (e.key === 'Enter' ? onSelect(conv.id) : null)}
                className={`group relative flex cursor-pointer gap-3 border-b border-l-4 border-slate-100 px-3 py-3 transition-colors ${
                  active ? 'border-l-soul-blue bg-blue-50/70' : isSelected ? 'border-l-soul-blue/40 bg-blue-50/40' : overdue ? 'border-l-rose-500 hover:bg-slate-50' : conv.unread_count > 0 ? 'border-l-amber-400 hover:bg-slate-50' : 'border-l-transparent hover:bg-slate-50'
                }`}
              >
                <div className="relative">
                  <span className={`${selecting || isSelected ? 'hidden' : 'group-hover:hidden'}`}>
                    <Avatar name={conv.customer_name} url={conv.avatar_url} kind={conv.channel_kind} size="md" />
                  </span>
                  <span
                    className={`${selecting || isSelected ? 'flex' : 'hidden group-hover:flex'} h-10 w-10 items-center justify-center`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSelect(conv.id);
                    }}
                  >
                    <input type="checkbox" readOnly checked={isSelected} className="h-4 w-4 cursor-pointer" aria-label="Select chat" />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`truncate text-sm ${conv.unread_count > 0 ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>
                      {conv.customer_name || 'Guest'}
                    </p>
                    <span className="shrink-0 text-[10px] text-slate-400">{timeAgo(conv.last_message_at, now)}</span>
                  </div>
                  <p className={`mt-0.5 truncate text-xs ${conv.unread_count > 0 ? 'text-slate-700' : 'text-slate-500'}`}>{conv.last_message_preview || 'No messages yet'}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {overdue || conv.status === 'needs_reply' ? <SlaChip conversation={conv} now={now} /> : null}
                    {conv.status === 'waiting_customer' ? <Chip className="bg-slate-100 text-slate-600">Waiting on guest</Chip> : null}
                    {conv.status === 'snoozed' ? <Chip className="bg-indigo-50 text-indigo-700">Snoozed</Chip> : null}
                    {conv.temperature === 'hot' ? <Chip className="bg-rose-50 text-rose-700">Hot</Chip> : null}
                    {conv.type && conv.type !== 'unknown' ? <Chip className="bg-slate-100 text-slate-600">{CONVERSATION_TYPES[conv.type]}</Chip> : null}
                    {queue !== 'mine' ? (
                      <Chip className={people.length ? 'bg-slate-100 text-slate-600' : 'bg-orange-50 text-orange-700'}>
                        {people.length ? people.map((p) => (Number(p.id) === Number(myId) ? 'You' : p.name)).join(', ') : 'Unassigned'}
                      </Chip>
                    ) : null}
                    {watching.length ? <Chip className="bg-amber-50 text-amber-800" title="Open by a teammate right now">👀 {watching.map((id) => userName(id)).join(', ')}</Chip> : null}
                    {wait && !overdue ? <span className="text-[10px] text-slate-400">waiting {wait}</span> : null}
                  </div>
                </div>
                {conv.unread_count > 0 ? (
                  <span className="mt-1 flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-soul-blue px-1 text-[10px] font-bold text-white">{conv.unread_count}</span>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
