import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CalendarPlus, X } from 'lucide-react';
import { inboxApi } from './api';
import LeadPanel from './LeadPanel';
import { Avatar, ChannelDot, SlaChip } from './ui';
import { CHANNELS, CONVERSATION_TYPES, STATUS_LABELS, fmtDate, fmtMoney } from './utils';

function Label({ children }) {
  return <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{children}</p>;
}

/** Guest record beside the thread: who they are, the stay, and how to close the chat. */
export default function GuestRail({
  conversation,
  customer,
  leads,
  followUps,
  me,
  can,
  now,
  people,
  onType,
  onStatus,
  onRemove,
  onClaim,
  onSnooze,
  onChanged,
  onStartLead,
}) {
  const { data: history } = useQuery({
    queryKey: ['inbox-guest-history', conversation.id],
    queryFn: () => inboxApi.get(`/conversations/${conversation.id}/guest`),
    enabled: Boolean(conversation?.phone),
    staleTime: 60000,
  });

  const lead = (leads || []).find((item) => item.id === conversation.current_lead_id) || leads?.[0] || null;
  const unclassified = !conversation.type || conversation.type === 'unknown';
  const onChat = people.some((person) => Number(person.id) === Number(me?.user?.id));
  const stays = [...(history?.reservations || []), ...(history?.bookings || [])].slice(0, 4);
  const channelLabel = CHANNELS[conversation.channel_kind]?.label || conversation.channel_kind;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Avatar name={conversation.customer_name} url={conversation.avatar_url} kind={conversation.channel_kind} />
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold text-slate-900">{conversation.customer_name || 'Guest'}</h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
            <ChannelDot kind={conversation.channel_kind} />
            {channelLabel}
            {conversation.phone ? ` · ${conversation.phone}` : ''}
          </p>
        </div>
      </div>

      <div>
        <Label>Who is this</Label>
        <select
          aria-label="Conversation type"
          value={conversation.type || 'unknown'}
          onChange={(event) => onType(event.target.value)}
          className={`h-10 w-full rounded-lg border px-2 text-sm font-medium text-slate-800 focus:outline-none ${
            unclassified ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'
          }`}
        >
          {Object.entries(CONVERSATION_TYPES).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        {unclassified ? (
          <p className="mt-1 text-[11px] leading-snug text-amber-800">Choose a type before this chat can be closed.</p>
        ) : null}
      </div>

      <div>
        <Label>Status</Label>
        <select
          aria-label="Chat status"
          value={conversation.status}
          onChange={(event) => onStatus(event.target.value)}
          className="h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-800 focus:outline-none"
        >
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <SlaChip conversation={conversation} now={now} />
        {!onChat ? (
          <button type="button" onClick={onClaim} className="h-8 rounded-lg bg-soul-blue px-2.5 text-xs font-bold text-white">
            {people.length ? 'Join' : 'Take'}
          </button>
        ) : null}
        <button type="button" onClick={onSnooze} className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700">
          Snooze till 11
        </button>
      </div>

      <div>
        <Label>On this chat</Label>
        <div className="flex flex-wrap gap-1.5">
          {people.length === 0 ? <span className="text-xs text-slate-500">Unassigned</span> : null}
          {people.map((person) => (
            <span key={person.id} className="inline-flex h-8 items-center gap-1 rounded-full bg-slate-100 px-2.5 text-[11px] font-medium text-slate-700">
              {Number(person.id) === Number(me?.user?.id) ? 'You' : person.name}
              {(can('conv.assign') || Number(person.id) === Number(me?.user?.id)) && (
                <button type="button" className="text-slate-400 hover:text-rose-600" aria-label={`Remove ${person.name}`} onClick={() => onRemove(person.id)}>
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      </div>

      {stays.length > 0 ? (
        <div>
          <Label>Stays on this number</Label>
          <div className="space-y-1.5">
            {stays.map((stay) => (
              <Link
                key={`${stay.id}-${stay.check_in}`}
                to={stay.unit_id ? `/admin/reservations?view=${stay.id}` : '/admin/website-bookings'}
                className="block rounded-lg border border-slate-200 px-2.5 py-2 hover:bg-slate-50"
              >
                <p className="truncate text-xs font-semibold text-slate-800">{stay.unit_title || stay.compound || 'Stay'}</p>
                <p className="text-[11px] text-slate-500">
                  {fmtDate(stay.check_in)} – {fmtDate(stay.check_out)}
                  {stay.status ? ` · ${stay.status}` : ''}
                  {stay.total_amount ? ` · ${fmtMoney(stay.total_amount)}` : stay.total_egp ? ` · ${fmtMoney(stay.total_egp)}` : ''}
                </p>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <div className="border-t border-slate-200 pt-3">
        <Label>Stay request</Label>
        {lead ? (
          <LeadPanel lead={lead} followUps={followUps} customer={customer} onChanged={onChanged} />
        ) : (
          <button type="button" onClick={onStartLead} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700">
            <CalendarPlus className="h-3.5 w-3.5" />
            Open a stay request
          </button>
        )}
      </div>
    </div>
  );
}
