import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Ban, Bot, Globe, Heart, Instagram, MessageCircle, Save, Star, Trash2 } from 'lucide-react';
import { inboxApi, errorMessage } from './api';

function Toggle({ checked, onChange, label, hint, disabled = false, icon: Icon }) {
  return (
    <label className={`flex items-start justify-between gap-4 rounded-xl border p-3.5 ${disabled ? 'border-slate-100 bg-slate-50 opacity-60' : 'border-slate-200 bg-white'}`}>
      <span className="flex min-w-0 items-start gap-2.5">
        {Icon ? <Icon className="mt-0.5 h-4 w-4 shrink-0 text-soul-blue" /> : null}
        <span>
          <span className="block font-bold text-slate-800">{label}</span>
          {hint ? <span className="mt-0.5 block text-[11px] text-slate-500">{hint}</span> : null}
        </span>
      </span>
      <input
        type="checkbox"
        className="mt-1 h-5 w-5 shrink-0 accent-soul-blue"
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function NumberField({ label, hint, value, onChange, min = 0, max = 10000 }) {
  return (
    <label className="block">
      <span className="mb-1 block font-bold text-slate-700">{label}</span>
      <input type="number" min={min} max={max} value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5" />
      {hint ? <span className="mt-1 block text-[11px] text-slate-400">{hint}</span> : null}
    </label>
  );
}

const Card = ({ icon: Icon, title, children, note }) => (
  <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <div>
      <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
        <Icon className="h-4 w-4 text-soul-blue" /> {title}
      </h2>
      {note ? <p className="mt-1 text-[11px] text-slate-500">{note}</p> : null}
    </div>
    {children}
  </section>
);

/** Live Inbox → Settings → Chatbot & guest care. */
export default function ChatbotSettings({ form, setForm, onSave, saving }) {
  const set = (patch) => setForm({ ...form, ...patch });
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');

  const { data: blockData, refetch: refetchBlocks } = useQuery({
    queryKey: ['inbox-blocklist'],
    queryFn: () => inboxApi.get('/admin/blocklist'),
  });
  const { data: care } = useQuery({ queryKey: ['inbox-guest-care'], queryFn: () => inboxApi.get('/admin/guest-care') });
  const blocked = blockData?.items || [];
  const reviews = care?.reviews || {};

  const addBlock = async (e) => {
    e.preventDefault();
    try {
      await inboxApi.post('/admin/blocklist', { phone, reason });
      toast.success('Blocked');
      setPhone('');
      setReason('');
      refetchBlocks();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not block'));
    }
  };
  const removeBlock = async (id) => {
    try {
      await inboxApi.delete(`/admin/blocklist/${id}`);
      toast.success('Unblocked');
      refetchBlocks();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not unblock'));
    }
  };

  return (
    <div className="max-w-4xl space-y-6 text-xs">
      <form onSubmit={onSave} className="space-y-6">
        <Card
          icon={Bot}
          title="Chatbot channels"
          note="When a channel is on, the chatbot answers every new customer message there within seconds, day and night: units, prices, availability, offers, voice notes and photos. It hands the chat to the team when it can't help."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle icon={Instagram} label="Instagram" checked={form.chatbot_instagram} onChange={(v) => set({ chatbot_instagram: v })} />
            <Toggle icon={MessageCircle} label="Messenger" checked={form.chatbot_messenger} onChange={(v) => set({ chatbot_messenger: v })} />
            <Toggle icon={Globe} label="Website chat" hint="A chat bubble on soulhospitality.co" checked={form.chatbot_website} onChange={(v) => set({ chatbot_website: v })} />
            <Toggle icon={MessageCircle} label="WhatsApp" hint="Available once the WhatsApp number is activated" checked={false} disabled onChange={() => {}} />
          </div>
        </Card>

        <Card
          icon={Bot}
          title="When a person replies"
          note="If anyone from the team replies (here, in Meta Business Suite or in the Instagram app), the bot stays quiet in that conversation only, for the time below. Other conversations are not affected. The bot's own messages never pause it."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField label="Instagram pause (minutes)" value={form.chatbot_pause_instagram_min ?? 60} onChange={(v) => set({ chatbot_pause_instagram_min: v })} />
            <NumberField label="Messenger pause (minutes)" value={form.chatbot_pause_messenger_min ?? 10} onChange={(v) => set({ chatbot_pause_messenger_min: v })} />
          </div>
        </Card>

        <Card
          icon={Heart}
          title="Guest care (by email)"
          note="Sent automatically to the guest email on the reservation. WhatsApp will be added when it is activated."
        >
          <div className="grid gap-3">
            <Toggle label="Reminder the day before arrival" hint="Sent at 12:00: check-in time, the location link and who will meet them." checked={form.guest_prearrival_enabled} onChange={(v) => set({ guest_prearrival_enabled: v })} />
            <Toggle label="Rating request after checkout" hint="Asks for a rating out of 5. A 5-star rating is offered your Google Reviews link; 3 stars or less alerts the operations leads." checked={form.guest_review_enabled} onChange={(v) => set({ guest_review_enabled: v })} />
            <label className="block">
              <span className="mb-1 block font-bold text-slate-700">Google Reviews link</span>
              <input type="url" value={form.google_review_url || ''} onChange={(e) => set({ google_review_url: e.target.value })} placeholder="https://g.page/r/…/review" className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5" />
              <span className="mt-1 block text-[11px] text-slate-400">From your Google Business Profile → Ask for reviews.</span>
            </label>
            <Toggle label="Invite guests back" hint="Weekly: guests who haven't returned within their usual gap get an invitation with the current promo code." checked={form.guest_reengage_enabled} onChange={(v) => set({ guest_reengage_enabled: v })} />
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField label="One-time guests: invite after (days)" min={30} value={form.guest_reengage_default_days ?? 180} onChange={(v) => set({ guest_reengage_default_days: v })} hint="Regular guests are invited after their own usual gap." />
              <NumberField label="Block after this many cancellations" value={form.auto_block_cancellations ?? 5} onChange={(v) => set({ auto_block_cancellations: v })} hint="0 turns automatic blocking off." />
            </div>
          </div>
        </Card>

        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-xl bg-soul-blue px-6 py-3 font-bold text-white shadow hover:bg-soul-blue-dark">
            <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>

      <Card icon={Star} title="Guest ratings (last 90 days)">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Requests sent', reviews.requested ?? 0],
            ['Ratings received', reviews.rated ?? 0],
            ['Average', reviews.average != null ? `${reviews.average} / 5` : '—'],
            ['Offered Google review', reviews.google_offered ?? 0],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-200 p-3">
              <div className="text-[11px] text-slate-500">{label}</div>
              <div className="text-lg font-bold text-slate-900">{value}</div>
            </div>
          ))}
        </div>
        {(care?.recent || []).length ? (
          <ul className="divide-y divide-slate-100">
            {care.recent.map((r, i) => (
              <li key={i} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-start sm:justify-between">
                <span>
                  <span className="font-bold text-slate-800">{r.guest_name || 'Guest'}</span>
                  <span className="text-slate-500"> · {r.unit_number || r.unit_title}</span>
                  {r.comment ? <span className="block text-slate-600">“{r.comment}”</span> : null}
                </span>
                <span className={`shrink-0 font-bold ${r.rating >= 4 ? 'text-emerald-600' : r.rating === 3 ? 'text-amber-600' : 'text-rose-600'}`}>
                  {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-400">No ratings yet.</p>
        )}
      </Card>

      <Card
        icon={Ban}
        title="Blocklist"
        note="Blocked customers get no replies from the chatbot on any channel. Customers with too many cancelled stays are added automatically; you can also block from a conversation in the Live Inbox."
      >
        <form onSubmit={addBlock} className="flex flex-col gap-2 sm:flex-row">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 sm:w-48" required />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="flex-1 rounded-xl border border-slate-200 bg-slate-50 p-2.5" />
          <button type="submit" className="rounded-xl bg-rose-600 px-4 py-2.5 font-bold text-white hover:bg-rose-700">Block</button>
        </form>
        {blocked.length ? (
          <ul className="divide-y divide-slate-100">
            {blocked.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="font-bold text-slate-800">{b.customer_name || (b.phone ? `…${b.phone}` : 'Customer')}</span>
                  {b.phone && b.customer_name ? <span className="text-slate-500"> · …{b.phone}</span> : null}
                  <span className="block text-[11px] text-slate-500">
                    {b.source === 'auto_cancellations' ? 'Automatic' : `By ${b.created_by_name || 'staff'}`}
                    {b.reason ? ` · ${b.reason}` : ''} · {new Date(b.created_at).toLocaleDateString('en-GB')}
                  </span>
                </span>
                <button type="button" onClick={() => removeBlock(b.id)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold text-slate-600 hover:bg-slate-50">
                  <Trash2 className="h-3.5 w-3.5" /> Unblock
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-400">Nobody is blocked.</p>
        )}
      </Card>
    </div>
  );
}
