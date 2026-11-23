import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Ban, Bot, Pause, Play } from 'lucide-react';
import { inboxApi, errorMessage } from './api';
import { useInbox } from './InboxContext';

const time = (v) =>
  new Date(v).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' });

/** What the chatbot is doing in this conversation, with resume / stop / block. */
export default function BotBar({ conversationId, refreshKey }) {
  const { can } = useInbox();
  const { data, refetch } = useQuery({
    queryKey: ['inbox-bot', conversationId, refreshKey],
    queryFn: () => inboxApi.get(`/conversations/${conversationId}/bot`),
    staleTime: 5000,
  });
  if (!data) return null;
  if (!data.supported && !data.blocked) return null;

  const act = async (path, body, ok) => {
    try {
      await inboxApi.post(`/conversations/${conversationId}/${path}`, body);
      toast.success(ok);
      refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const tone = {
    active: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    paused: 'border-amber-200 bg-amber-50 text-amber-900',
    handed_off: 'border-sky-200 bg-sky-50 text-sky-900',
    blocked: 'border-rose-200 bg-rose-50 text-rose-900',
    off: 'border-slate-200 bg-slate-50 text-slate-600',
  }[data.state];
  const text = {
    active: 'The chatbot is answering this chat. Reply yourself any time: it steps back here when you do.',
    paused: `The chatbot is quiet here until ${data.paused_until ? time(data.paused_until) : 'later'} because a person replied.`,
    handed_off: `The chatbot handed this chat to the team${data.handoff_reason ? `: ${data.handoff_reason}` : ''}.`,
    blocked: 'This customer is blocked: the chatbot never answers them.',
    off: 'The chatbot is off for this channel (Settings → Chatbot & Guest Care).',
  }[data.state];

  const btn = 'inline-flex items-center gap-1 rounded-md border border-current/20 bg-white/70 px-2 py-1 font-semibold hover:bg-white';
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-1.5 text-xs ${tone}`}>
      <span className="flex items-center gap-1.5">
        {data.state === 'blocked' ? <Ban className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
        {text}
      </span>
      <span className="flex flex-wrap gap-1.5">
        {data.channel_on && ['paused', 'handed_off'].includes(data.state) ? (
          <button type="button" className={btn} onClick={() => act('bot', { action: 'resume' }, 'The chatbot will answer again')}>
            <Play className="h-3 w-3" /> Let the bot answer
          </button>
        ) : null}
        {data.state === 'active' ? (
          <button type="button" className={btn} onClick={() => act('bot', { action: 'pause', minutes: 1440 }, 'The chatbot is quiet here for 24 hours')}>
            <Pause className="h-3 w-3" /> Stop bot here (24h)
          </button>
        ) : null}
        {can('conv.assign') ? (
          data.blocked ? (
            <button type="button" className={btn} onClick={() => act('block', { blocked: false }, 'Unblocked')}>Unblock</button>
          ) : (
            <button
              type="button"
              className={btn}
              onClick={() => {
                if (window.confirm('Block this customer? The chatbot will never answer them on any channel.')) act('block', { blocked: true }, 'Blocked');
              }}
            >
              <Ban className="h-3 w-3" /> Block
            </button>
          )
        ) : null}
      </span>
    </div>
  );
}
