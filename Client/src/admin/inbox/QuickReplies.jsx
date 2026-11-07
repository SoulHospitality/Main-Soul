import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { inboxApi, errorMessage } from './api';

const BLANK = { title: '', shortcut: '', body: '' };

/** Add, edit and remove saved replies. Everyone can add; you change your own (managers: all). */
export default function QuickRepliesManager({ replies, onClose }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null); // null | 'new' | id
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['inbox-quick-replies'] });
    qc.invalidateQueries({ queryKey: ['inbox-me'] });
  };

  const start = (reply) => {
    setEditing(reply ? reply.id : 'new');
    setForm(reply ? { title: reply.title || '', shortcut: reply.shortcut || '', body: reply.body || '' } : BLANK);
  };

  const save = async () => {
    if (!form.title.trim() || !form.body.trim()) return toast.error('Give the reply a title and text');
    setBusy(true);
    try {
      if (editing === 'new') await inboxApi.post('/admin/quick-replies', form);
      else await inboxApi.patch(`/admin/quick-replies/${editing}`, form);
      toast.success(editing === 'new' ? 'Saved reply added' : 'Saved reply updated');
      setEditing(null);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (reply) => {
    if (!window.confirm(`Remove the saved reply “${reply.title}”?`)) return;
    try {
      await inboxApi.delete(`/admin/quick-replies/${reply.id}`);
      toast.success('Saved reply removed');
      if (editing === reply.id) setEditing(null);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[220] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Saved replies</h2>
            <p className="text-[11px] text-slate-500">Type / in the reply box to use one. {'{{customer_name}}'} and {'{{agent_name}}'} fill in by themselves.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {editing ? (
            <div className="space-y-2.5 rounded-xl border border-soul-blue/30 bg-blue-50/40 p-3">
              <div className="grid grid-cols-[1fr_8rem] gap-2">
                <input className="input h-9 text-sm" placeholder="Title, e.g. Ask for dates" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                <input className="input h-9 text-sm" placeholder="Shortcut" value={form.shortcut} onChange={(e) => setForm({ ...form, shortcut: e.target.value })} />
              </div>
              <textarea dir="auto" className="input min-h-[110px] text-sm" placeholder="The message" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => setEditing(null)}>Cancel</button>
                <button type="button" className="btn-primary !py-1.5 text-xs" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => start(null)} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-2.5 text-sm font-semibold text-soul-blue hover:bg-slate-50">
              <Plus className="h-4 w-4" /> Add a saved reply
            </button>
          )}

          {replies.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">
                  {r.shortcut ? <span className="mr-1 text-slate-400">/{r.shortcut}</span> : null}
                  {r.title}
                </p>
                {r.can_edit ? (
                  <div className="flex shrink-0 gap-0.5">
                    <button type="button" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Edit" onClick={() => start(r)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-700" aria-label="Remove" onClick={() => remove(r)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
              </div>
              <p dir="auto" className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-slate-500">{r.body}</p>
              {r.created_by_name ? <p className="mt-1 text-[10px] text-slate-400">Added by {r.created_by_name}</p> : null}
            </div>
          ))}
          {!replies.length && !editing ? <p className="py-6 text-center text-xs text-slate-400">No saved replies yet.</p> : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
