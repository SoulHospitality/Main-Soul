import { useState } from 'react';
import toast from 'react-hot-toast';
import { Check, Pencil } from 'lucide-react';
import { useInbox } from './InboxContext';
import { inboxApi, errorMessage } from './api';
import { CHANNELS, phoneDisplay } from './utils';

/** The lead behind a chat: who (name + contact), its status, and the destination when interested. */
export default function LeadBox({ conversation, customer, lead, onChanged }) {
  const { me } = useInbox();
  const stages = (me?.stages || []).filter((s) => s.active !== 0 && s.active !== false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState({ name: customer?.name || conversation.customer_name || '', phone: customer?.phone ? phoneDisplay(customer.phone) : '' });
  const [destination, setDestination] = useState(lead?.project || '');
  const [newStatus, setNewStatus] = useState('interested');

  const channel = CHANNELS[conversation.channel_kind]?.label || conversation.channel_kind;
  const run = async (fn, ok) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveContact = () =>
    run(async () => {
      await inboxApi.patch(`/customers/${customer.id}`, { name: contact.name, phone: contact.phone || null });
      setEditing(false);
    }, 'Contact saved');

  const stageName = (key) => stages.find((s) => s.key === key)?.name_en || key;

  return (
    <div className="space-y-2.5">
      <div className="rounded-lg border border-slate-200 p-2.5">
        {editing ? (
          <div className="space-y-1.5">
            <input className="input h-9 py-1 text-xs" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} placeholder="Name" />
            <input className="input h-9 py-1 text-xs" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} placeholder="Phone, e.g. 01012345678" inputMode="tel" />
            <div className="flex gap-1.5">
              <button type="button" className="btn-primary btn-sm flex-1 justify-center" disabled={busy} onClick={saveContact}>
                <Check className="h-3.5 w-3.5" /> Save
              </button>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 text-xs">
              <p className="truncate font-semibold text-slate-800">{customer?.name || conversation.customer_name || 'No name yet'}</p>
              <p className="text-slate-600">{customer?.phone ? phoneDisplay(customer.phone) : <span className="text-amber-700">No phone yet</span>}</p>
              <p className="text-[11px] text-slate-400">{channel} account</p>
            </div>
            {customer?.id ? (
              <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Edit contact" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        )}
      </div>

      {lead ? (
        <div className="space-y-1.5">
          <select
            aria-label="Lead status"
            className="input h-9 py-1 text-sm font-medium"
            value={lead.stage_key}
            disabled={busy}
            onChange={(e) => run(() => inboxApi.post(`/leads/${lead.id}/stage`, { stage: e.target.value }), `Lead: ${stageName(e.target.value)}`)}
          >
            {!stages.some((s) => s.key === lead.stage_key) ? <option value={lead.stage_key}>{stageName(lead.stage_key)}</option> : null}
            {stages.map((s) => (
              <option key={s.key} value={s.key}>{s.name_en}</option>
            ))}
          </select>
          {['interested', 'different_project'].includes(lead.stage_key) ? (
            <div className="flex gap-1.5">
              <input className="input h-9 flex-1 py-1 text-xs" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder={lead.stage_key === 'interested' ? 'Destination, e.g. North Coast' : 'Which project they asked for'} />
              {destination !== (lead.project || '') ? (
                <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => run(() => inboxApi.patch(`/leads/${lead.id}`, { project: destination }), 'Saved')}>
                  Save
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            <select aria-label="New lead status" className="input h-9 flex-1 py-1 text-xs" value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
              {stages.map((s) => (
                <option key={s.key} value={s.key}>{s.name_en}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn-primary btn-sm shrink-0"
              disabled={busy}
              onClick={() => run(() => inboxApi.post(`/conversations/${conversation.id}/leads`, { stage_key: newStatus, project: destination || undefined }), 'Lead created')}
            >
              Create lead
            </button>
          </div>
          {newStatus === 'interested' ? (
            <input className="input h-9 py-1 text-xs" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Destination, e.g. North Coast" />
          ) : null}
        </div>
      )}
    </div>
  );
}
