import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Edit2, Percent, Plus, Trash2 } from 'lucide-react';
import api from '../api/axios';
import Modal from './ui/Modal';
import ScopePicker from './ScopePicker';
import { formatDate } from '../utils/formatters';

const EMPTY = {
  name: '',
  name_ar: '',
  description: '',
  description_ar: '',
  discount_percent: '',
  starts_on: '',
  ends_on: '',
  show_popup: true,
  image_url: '',
  active: true,
  scope: { destinations: [], projects: [], unit_ids: [] },
};

function toForm(o) {
  if (!o) return { ...EMPTY };
  return {
    name: o.name || '',
    name_ar: o.name_ar || '',
    description: o.description || '',
    description_ar: o.description_ar || '',
    discount_percent: String(o.discount_percent ?? ''),
    starts_on: o.starts_on || '',
    ends_on: o.ends_on || '',
    show_popup: o.show_popup !== false,
    image_url: o.image_url || '',
    active: o.active !== false,
    scope: { destinations: o.destinations || [], projects: o.projects || [], unit_ids: o.unit_ids || [] },
  };
}

function running(o) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  if (!o.active) return { label: 'Off', tone: 'bg-slate-100 text-slate-600' };
  if (o.starts_on && o.starts_on > today) return { label: 'Scheduled', tone: 'bg-blue-50 text-soul-blue' };
  if (o.ends_on && o.ends_on < today) return { label: 'Ended', tone: 'bg-slate-100 text-slate-600' };
  return { label: 'Running', tone: 'bg-emerald-50 text-emerald-700' };
}

/** Offers: a named percentage off the nightly price for chosen places, with a website popup. */
export default function OffersSection() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null); // null | 'new' | offer
  const [form, setForm] = useState(EMPTY);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const { data: offers = [] } = useQuery({ queryKey: ['offers'], queryFn: () => api.get('/offers').then((r) => r.data) });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        discount_percent: Number(form.discount_percent),
        starts_on: form.starts_on || null,
        ends_on: form.ends_on || null,
        destinations: form.scope.destinations,
        projects: form.scope.projects,
        unit_ids: form.scope.unit_ids,
      };
      delete body.scope;
      return editing === 'new' ? api.post('/offers', body) : api.put(`/offers/${editing.id}`, body);
    },
    onSuccess: () => {
      toast.success(editing === 'new' ? 'Offer created' : 'Offer saved');
      qc.invalidateQueries({ queryKey: ['offers'] });
      setEditing(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not save the offer'),
  });
  const remove = useMutation({
    mutationFn: (id) => api.delete(`/offers/${id}`),
    onSuccess: () => {
      toast.success('Offer deleted');
      qc.invalidateQueries({ queryKey: ['offers'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not delete the offer'),
  });

  const open = (o) => {
    setEditing(o || 'new');
    setForm(toForm(o));
  };

  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Offers</h2>
          <p className="text-sm text-gray-500">A percentage off the nightly price for chosen destinations, projects or units. Guests see a popup and the lower price.</p>
        </div>
        <button type="button" className="btn-primary shrink-0" onClick={() => open(null)}>
          <Plus className="h-4 w-4" /> New offer
        </button>
      </div>
      {offers.length ? (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Offer</th>
                  <th>Discount</th>
                  <th>Applies to</th>
                  <th>Dates</th>
                  <th>Popup</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => {
                  const st = running(o);
                  return (
                    <tr key={o.id}>
                      <td>
                        <div className="font-semibold text-soul-blue">{o.name}</div>
                        {o.name_ar ? <div dir="rtl" className="text-xs text-gray-500">{o.name_ar}</div> : null}
                      </td>
                      <td className="whitespace-nowrap font-medium">{o.discount_percent}% off</td>
                      <td className="max-w-[14rem] truncate text-xs text-gray-600" title={o.applies_to}>{o.applies_to}</td>
                      <td className="whitespace-nowrap text-xs">
                        {o.starts_on ? formatDate(o.starts_on) : 'Now'} → {o.ends_on ? formatDate(o.ends_on) : 'No end'}
                      </td>
                      <td className="text-xs">{o.show_popup ? 'Yes' : 'No'}</td>
                      <td><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${st.tone}`}>{st.label}</span></td>
                      <td>
                        <div className="flex gap-1">
                          <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => open(o)} title="Edit">
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs text-rose-700"
                            title="Delete"
                            onClick={() => window.confirm(`Delete the offer “${o.name}”?`) && remove.mutate(o.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-soul-line bg-white p-6 text-center text-sm text-gray-500">
          <Percent className="mx-auto mb-2 h-5 w-5 text-gray-400" />
          No offers yet.
        </div>
      )}

      {editing ? (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing === 'new' ? 'New offer' : 'Edit offer'}
          size="lg"
          footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? 'Saving…' : 'Save offer'}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="form-grid">
              <div>
                <label className="label">Name *</label>
                <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Summer escape" />
              </div>
              <div>
                <label className="label">Name (Arabic)</label>
                <input dir="rtl" className="input" value={form.name_ar} onChange={(e) => set({ name_ar: e.target.value })} />
              </div>
              <div>
                <label className="label">Discount (%) *</label>
                <input type="number" min="1" max="99" step="0.5" className="input" value={form.discount_percent} onChange={(e) => set({ discount_percent: e.target.value })} placeholder="15" />
                <p className="mt-1 text-[11px] text-gray-500">Taken off the nightly price, not the fees.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Starts</label>
                  <input type="date" className="input" value={form.starts_on} onChange={(e) => set({ starts_on: e.target.value })} />
                </div>
                <div>
                  <label className="label">Ends</label>
                  <input type="date" className="input" value={form.ends_on} onChange={(e) => set({ ends_on: e.target.value })} />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="label">Popup text</label>
                <textarea className="input min-h-[60px]" value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="15% off every night in Marassi until the end of the month" />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Popup text (Arabic)</label>
                <textarea dir="rtl" className="input min-h-[60px]" value={form.description_ar} onChange={(e) => set({ description_ar: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Popup image link (optional)</label>
                <input className="input" value={form.image_url} onChange={(e) => set({ image_url: e.target.value })} placeholder="https://…" />
              </div>
            </div>
            <ScopePicker value={form.scope} onChange={(scope) => set({ scope })} />
            <label className="flex items-start gap-3 rounded-xl border border-soul-line bg-slate-50 px-3 py-2.5">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.show_popup} onChange={(e) => set({ show_popup: e.target.checked })} />
              <span>
                <span className="block text-sm font-semibold text-gray-900">Show a popup on the website</span>
                <span className="block text-xs text-gray-500">Shown on the pages of the units, projects and destinations it covers (every page if it covers every unit).</span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-soul-line bg-slate-50 px-3 py-2.5">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
              <span>
                <span className="block text-sm font-semibold text-gray-900">Active</span>
                <span className="block text-xs text-gray-500">Turn off to stop the offer without deleting it.</span>
              </span>
            </label>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
