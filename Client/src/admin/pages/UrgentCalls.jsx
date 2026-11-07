import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { MessageSquare, Phone, PhoneCall, Plus } from 'lucide-react';
import { inboxApi, errorMessage } from '../inbox/api';
import { useInboxEvents } from '../inbox/InboxContext';
import Modal from '../components/ui/Modal';

const TABS = [
  { key: 'open', label: 'To call' },
  { key: 'called', label: 'Called' },
  { key: 'done', label: 'Done' },
];

const fmt = (iso) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function ago(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

/** Customers who asked for a manager or a person: call them back, then mark it. */
export default function UrgentCallsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('open');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', notes: '' });
  const [outcomes, setOutcomes] = useState({});

  const { data, isLoading } = useQuery({
    queryKey: ['urgent-calls', tab],
    queryFn: () => inboxApi.get('/urgent-calls', { status: tab }),
    refetchInterval: 30000,
  });
  useInboxEvents((type) => {
    if (type === 'urgent_call') qc.invalidateQueries({ queryKey: ['urgent-calls'] });
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }) => inboxApi.patch(`/urgent-calls/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['urgent-calls'] }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const create = useMutation({
    mutationFn: () => inboxApi.post('/urgent-calls', form),
    onSuccess: () => {
      toast.success('Added to urgent calls');
      setAdding(false);
      setForm({ name: '', phone: '', notes: '' });
      setTab('open');
      qc.invalidateQueries({ queryKey: ['urgent-calls'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const items = data?.items || [];
  const counts = data?.counts || {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="page-header mb-0">
          <h1 className="page-title">Urgent calls</h1>
          <p className="page-subtitle">Customers who asked for a manager or a person. Call them back as soon as you can.</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Add call
        </button>
      </div>

      <div className="inline-flex rounded-xl border border-soul-line bg-white p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-soul-blue text-white' : 'text-gray-600 hover:bg-slate-50'}`}
          >
            {t.label}
            {counts[t.key] ? <span className={`ml-1.5 rounded-full px-1.5 text-[11px] font-bold ${t.key === 'open' && tab !== 'open' ? 'bg-rose-600 text-white' : 'bg-black/10'}`}>{counts[t.key]}</span> : null}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="py-10 text-center text-sm text-gray-400">Loading…</p>
      ) : !items.length ? (
        <div className="rounded-2xl border border-dashed border-soul-line bg-white py-12 text-center text-sm text-gray-500">
          {tab === 'open' ? 'Nobody is waiting for a call.' : 'Nothing here yet.'}
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map((c) => (
            <div key={c.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${c.status === 'open' ? 'border-rose-200' : 'border-soul-line'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-soul-blue">{c.name}</p>
                  <a href={`tel:${c.phone}`} className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-800 hover:text-soul-blue" dir="ltr">
                    <Phone className="h-3.5 w-3.5" /> {c.phone}
                  </a>
                  <p className="mt-1 text-[11px] text-gray-400">
                    {c.source === 'chatbot' ? 'From the chatbot' : `Added by ${c.created_by_name || 'staff'}`} · {fmt(c.created_at)} ({ago(c.created_at)})
                    {c.handled_by_name ? ` · ${c.status === 'done' ? 'closed' : 'called'} by ${c.handled_by_name}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {c.inbox_conversation_id ? (
                    <Link to={`/admin/inbox?c=${c.inbox_conversation_id}`} className="btn-secondary !px-3 !py-1.5 text-xs">
                      <MessageSquare className="h-3.5 w-3.5" /> Chat
                    </Link>
                  ) : null}
                  <a href={`tel:${c.phone}`} className="btn-secondary !px-3 !py-1.5 text-xs">
                    <PhoneCall className="h-3.5 w-3.5" /> Call
                  </a>
                  {c.status !== 'called' ? (
                    <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => update.mutate({ id: c.id, status: 'called', outcome: outcomes[c.id] ?? c.outcome })}>
                      Mark called
                    </button>
                  ) : null}
                  {c.status !== 'done' ? (
                    <button type="button" className="btn-primary !px-3 !py-1.5 text-xs" onClick={() => update.mutate({ id: c.id, status: 'done', outcome: outcomes[c.id] ?? c.outcome })}>
                      Done
                    </button>
                  ) : (
                    <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => update.mutate({ id: c.id, status: 'open' })}>
                      Reopen
                    </button>
                  )}
                </div>
              </div>
              {c.notes ? <p className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-2 text-sm text-gray-700">{c.notes}</p> : null}
              <div className="mt-2 flex gap-2">
                <input
                  className="input h-9 flex-1 text-sm"
                  placeholder="What happened on the call (optional)"
                  value={outcomes[c.id] ?? c.outcome ?? ''}
                  onChange={(e) => setOutcomes((o) => ({ ...o, [c.id]: e.target.value }))}
                />
                {outcomes[c.id] !== undefined && outcomes[c.id] !== (c.outcome ?? '') ? (
                  <button type="button" className="btn-secondary !py-1 text-xs" onClick={() => update.mutate({ id: c.id, outcome: outcomes[c.id] })}>
                    Save
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <Modal
          open
          onClose={() => setAdding(false)}
          title="Add an urgent call"
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setAdding(false)}>Cancel</button>
              <button type="button" className="btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>Add</button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="label">Name *</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Phone number *</label>
              <input className="input" dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="01xxxxxxxxx" />
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea className="input min-h-[90px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="What the customer needs" />
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
