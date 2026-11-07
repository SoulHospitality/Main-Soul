import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { inboxApi } from './api';
import StayRequest from './StayRequest';
import { Avatar, ChannelDot } from './ui';
import { CHANNELS, CONVERSATION_TYPES, fmtDate, fmtMoney } from './utils';

function Label({ children }) {
  return <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{children}</p>;
}

/** Guest record beside the thread: who they are, their stays and the stay request. Chat actions live in the header. */
export default function GuestRail({
  conversation,
  customer,
  leads,
  onType,
  onChanged,
}) {
  const { data: history } = useQuery({
    queryKey: ['inbox-guest-history', conversation.id],
    queryFn: () => inboxApi.get(`/conversations/${conversation.id}/guest`),
    enabled: Boolean(conversation?.phone),
    staleTime: 60000,
  });

  const lead = (leads || []).find((item) => item.id === conversation.current_lead_id) || leads?.[0] || null;
  const unclassified = !conversation.type || conversation.type === 'unknown';
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
          <p className="mt-1 text-[11px] leading-snug text-amber-800">Not set yet: you’ll be asked when you close the chat.</p>
        ) : null}
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
        <StayRequest key={lead?.id || 'new'} conversationId={conversation.id} lead={lead} customer={customer} onChanged={onChanged} />
      </div>
    </div>
  );
}
