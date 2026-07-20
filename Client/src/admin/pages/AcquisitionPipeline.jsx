import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { currency } from '../utils/formatters';

const STAGES = [
  'lead',
  'under_evaluation',
  'pricing_recommended',
  'proposal_sent',
  'negotiation',
  'contract_signed',
  'content_pending',
  'ready',
  'live',
];

const EMPTY = {
  title: '',
  owner_name: '',
  owner_phone: '',
  owner_email: '',
  destination: 'North Coast',
  project: '',
  property_type: 'Apartment',
  beds: 2,
  baths: 1,
  expected_price: '',
  notes: '',
  unit_number: '',
  view: '',
  create_draft_unit: true,
};

function slaLabel(iso) {
  if (!iso) return null;
  const due = new Date(iso);
  const days = Math.ceil((due - Date.now()) / 86400000);
  if (Number.isNaN(days)) return null;
  if (days < 0) return `SLA overdue ${Math.abs(days)}d`;
  return `SLA ${days}d left`;
}

function reasoningOf(rec) {
  if (!rec?.reasoning) return {};
  return typeof rec.reasoning === 'string' ? JSON.parse(rec.reasoning) : rec.reasoning;
}

function LeadDetail({ lead, onClose }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [proposed, setProposed] = useState('');
  const [contractUrl, setContractUrl] = useState('');

  const { data: negotiations = [] } = useQuery({
    queryKey: ['acq-nego', lead.id],
    queryFn: () => api.get(`/acquisition-leads/${lead.id}/negotiations`).then((r) => r.data),
  });
  const { data: contracts = [] } = useQuery({
    queryKey: ['acq-contracts', lead.id],
    queryFn: () => api.get(`/acquisition-leads/${lead.id}/contracts`).then((r) => r.data),
  });
  const { data: recs = [] } = useQuery({
    queryKey: ['acq-recs', lead.unit_id],
    queryFn: () =>
      api
        .get('/pricing-recommendations', { params: { unit_id: lead.unit_id } })
        .then((r) => r.data),
    enabled: !!lead.unit_id,
  });

  const createUnit = useMutation({
    mutationFn: () => api.post(`/acquisition-leads/${lead.id}/create-unit`),
    onSuccess: () => {
      toast.success('Draft unit created & linked');
      qc.invalidateQueries({ queryKey: ['acquisition-leads'] });
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const genPrice = useMutation({
    mutationFn: () =>
      api.post('/pricing-recommendations/generate', {
        unit_id: lead.unit_id,
        lead_id: lead.id,
      }),
    onSuccess: () => {
      toast.success('Recommendation generated');
      qc.invalidateQueries({ queryKey: ['acq-recs'] });
      qc.invalidateQueries({ queryKey: ['acquisition-leads'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const patchRec = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/pricing-recommendations/${id}`, { status }),
    onSuccess: (_, v) => {
      toast.success(v.status === 'accepted' ? 'Accepted · prices seeded' : `Marked ${v.status}`);
      qc.invalidateQueries({ queryKey: ['acq-recs'] });
      qc.invalidateQueries({ queryKey: ['acquisition-leads'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const logNego = useMutation({
    mutationFn: () =>
      api.post(`/acquisition-leads/${lead.id}/negotiations`, {
        note,
        proposed_price: proposed === '' ? null : Number(proposed),
      }),
    onSuccess: () => {
      toast.success('Negotiation logged');
      setNote('');
      setProposed('');
      qc.invalidateQueries({ queryKey: ['acq-nego'] });
      qc.invalidateQueries({ queryKey: ['acquisition-leads'] });
    },
  });

  const addContract = useMutation({
    mutationFn: () =>
      api.post(`/acquisition-leads/${lead.id}/contracts`, {
        file_url: contractUrl || null,
        status: 'signed',
        signed_at: new Date().toISOString(),
        unit_id: lead.unit_id || undefined,
      }),
    onSuccess: () => {
      toast.success('Contract recorded · stage → contract_signed');
      setContractUrl('');
      qc.invalidateQueries({ queryKey: ['acq-contracts'] });
      qc.invalidateQueries({ queryKey: ['acquisition-leads'] });
    },
  });

  const latest = recs[0];
  const reasoning = reasoningOf(latest);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-5 space-y-5">
        <div className="flex justify-between items-start gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{lead.title}</h2>
            <p className="text-sm text-gray-500">
              {lead.stage} · {lead.project || '—'} · owner {lead.owner_name || '—'}
            </p>
          </div>
          <button type="button" className="text-gray-400 hover:text-gray-700" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {!lead.unit_id ? (
            <button type="button" className="btn-primary text-sm" onClick={() => createUnit.mutate()}>
              Create draft unit
            </button>
          ) : (
            <>
              <span className="text-xs bg-emerald-50 text-emerald-800 px-2 py-1 rounded-full">
                Unit linked
              </span>
              <button type="button" className="btn-secondary text-sm" onClick={() => genPrice.mutate()}>
                Generate pricing
              </button>
            </>
          )}
        </div>

        {latest && (
          <div className="border rounded-xl p-4 space-y-2 bg-slate-50">
            <h3 className="font-semibold text-gray-900">Pricing recommendation #{latest.id}</h3>
            <p className="text-sm text-gray-600">{reasoning.summary}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              <div>
                <p className="text-xs text-gray-500">Base</p>
                <p className="font-semibold">{currency(latest.base_price)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Weekend / Peak</p>
                <p className="font-semibold">
                  {currency(latest.weekend_price)} / {currency(latest.peak_price)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Negotiate</p>
                <p className="font-semibold">
                  {currency(latest.floor_price)} – {currency(latest.ceiling_price)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Confidence</p>
                <p className="font-semibold">{Math.round(Number(latest.confidence || 0) * 100)}%</p>
              </div>
            </div>
            {(reasoning.comparable_titles || []).length > 0 && (
              <p className="text-xs text-gray-500">
                Comps: {(reasoning.comparable_titles || []).slice(0, 5).join(', ')}
              </p>
            )}
            {latest.status !== 'accepted' && latest.status !== 'rejected' && (
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  className="btn-primary text-xs"
                  onClick={() => patchRec.mutate({ id: latest.id, status: 'accepted' })}
                >
                  Accept & seed prices
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs text-red-600"
                  onClick={() => patchRec.mutate({ id: latest.id, status: 'rejected' })}
                >
                  Reject
                </button>
              </div>
            )}
            <p className="text-xs text-gray-400">Status: {latest.status}</p>
          </div>
        )}

        <div className="border rounded-xl p-4 space-y-3">
          <h3 className="font-semibold">Negotiation log</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              className="border rounded-lg px-3 py-2 text-sm sm:col-span-2"
              placeholder="Note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <input
              className="border rounded-lg px-3 py-2 text-sm"
              placeholder="Proposed EGP"
              value={proposed}
              onChange={(e) => setProposed(e.target.value)}
            />
          </div>
          <button type="button" className="btn-secondary text-sm" disabled={!note} onClick={() => logNego.mutate()}>
            Log negotiation
          </button>
          <ul className="text-sm divide-y">
            {negotiations.map((n) => (
              <li key={n.id} className="py-2">
                <p className="font-medium text-gray-800">{n.note}</p>
                <p className="text-xs text-gray-500">
                  {n.proposed_price != null ? `Proposed ${currency(n.proposed_price)} · ` : ''}
                  {String(n.created_at || '').slice(0, 16)}
                </p>
              </li>
            ))}
            {!negotiations.length && <li className="text-gray-400 text-xs py-2">No notes yet</li>}
          </ul>
        </div>

        <div className="border rounded-xl p-4 space-y-3">
          <h3 className="font-semibold">Contracts</h3>
          <div className="flex gap-2 flex-wrap">
            <input
              className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
              placeholder="Contract file URL (Drive / Cloudinary)"
              value={contractUrl}
              onChange={(e) => setContractUrl(e.target.value)}
            />
            <button type="button" className="btn-primary text-sm" onClick={() => addContract.mutate()}>
              Mark signed
            </button>
          </div>
          <ul className="text-sm divide-y">
            {contracts.map((c) => (
              <li key={c.id} className="py-2 flex justify-between gap-2">
                <span>
                  {c.title} · {c.status}
                  {c.file_url ? (
                    <a className="text-primary-600 ml-2 text-xs" href={c.file_url} target="_blank" rel="noreferrer">
                      file
                    </a>
                  ) : null}
                </span>
                <span className="text-xs text-gray-400">{String(c.signed_at || c.created_at || '').slice(0, 10)}</span>
              </li>
            ))}
            {!contracts.length && <li className="text-gray-400 text-xs py-2">No contracts</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function AcquisitionPipeline() {
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [showIntake, setShowIntake] = useState(false);
  const [selected, setSelected] = useState(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ['acquisition-leads'],
    queryFn: () => api.get('/acquisition-leads').then((r) => r.data),
  });

  const create = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        expected_price: form.expected_price === '' ? null : Number(form.expected_price),
        beds: Number(form.beds) || 0,
        baths: Number(form.baths) || 0,
      };
      const { data: lead } = await api.post('/acquisition-leads', payload);
      if (form.create_draft_unit) {
        await api.post(`/acquisition-leads/${lead.id}/create-unit`);
      }
      return lead;
    },
    onSuccess: () => {
      toast.success(form.create_draft_unit ? 'Lead + draft unit created' : 'Lead created');
      setForm(EMPTY);
      setShowIntake(false);
      qc.invalidateQueries({ queryKey: ['acquisition-leads'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const advance = useMutation({
    mutationFn: ({ id, stage }) => api.patch(`/acquisition-leads/${id}`, { stage }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['acquisition-leads'] });
      toast.success('Stage updated · SLA refreshed');
    },
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6 p-1">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Acquisition Pipeline</h1>
          <p className="text-sm text-gray-500">
            Intake → draft unit → pricing recommendation → negotiation → contract → live
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setShowIntake((v) => !v)}>
          {showIntake ? 'Close intake' : 'New unit intake'}
        </button>
      </div>

      {showIntake && (
        <div className="bg-white border rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            ['title', 'Unit / lead title *'],
            ['unit_number', 'Unit number'],
            ['owner_name', 'Owner name'],
            ['owner_phone', 'Owner phone'],
            ['owner_email', 'Owner email'],
            ['destination', 'Destination'],
            ['project', 'Project / compound'],
            ['property_type', 'Property type'],
            ['view', 'View'],
            ['expected_price', 'Owner expected nightly (EGP)'],
            ['notes', 'Notes'],
          ].map(([key, label]) => (
            <div key={key} className={key === 'notes' ? 'sm:col-span-2' : ''}>
              <label className="text-xs text-gray-500">{label}</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm"
                value={form[key] ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              />
            </div>
          ))}
          <div>
            <label className="text-xs text-gray-500">Beds</label>
            <input
              type="number"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={form.beds}
              onChange={(e) => setForm((f) => ({ ...f, beds: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">Baths</label>
            <input
              type="number"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              value={form.baths}
              onChange={(e) => setForm((f) => ({ ...f, baths: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.create_draft_unit}
              onChange={(e) => setForm((f) => ({ ...f, create_draft_unit: e.target.checked }))}
            />
            Create draft unit immediately
          </label>
          <div className="sm:col-span-2 lg:col-span-3">
            <button
              type="button"
              className="btn-primary"
              disabled={!form.title || create.isPending}
              onClick={() => create.mutate()}
            >
              Submit intake
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Title</th>
              <th className="px-4 py-3 text-left">Owner</th>
              <th className="px-4 py-3 text-left">Project</th>
              <th className="px-4 py-3 text-left">Stage</th>
              <th className="px-4 py-3 text-left">SLA</th>
              <th className="px-4 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.map((lead) => {
              const idx = STAGES.indexOf(lead.stage);
              const next = STAGES[Math.min(idx + 1, STAGES.length - 1)];
              const sla = slaLabel(lead.sla_due_at);
              const overdue = lead.sla_due_at && new Date(lead.sla_due_at) < new Date();
              return (
                <tr key={lead.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">
                    <button type="button" className="text-left hover:text-primary-700" onClick={() => setSelected(lead)}>
                      {lead.title}
                    </button>
                    {lead.unit_id && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-700">unit</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{lead.owner_name || '—'}</td>
                  <td className="px-4 py-3">{lead.project || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-800">
                      {lead.stage}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-xs ${overdue ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                    {sla || '—'}
                  </td>
                  <td className="px-4 py-3 space-x-2 whitespace-nowrap">
                    <button type="button" className="text-xs text-gray-600 font-medium" onClick={() => setSelected(lead)}>
                      Open
                    </button>
                    {lead.stage !== 'live' && (
                      <button
                        type="button"
                        className="text-xs text-primary-600 font-medium"
                        onClick={() => advance.mutate({ id: lead.id, stage: next })}
                      >
                        → {next}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data.length && <p className="p-6 text-center text-gray-400 text-sm">No leads yet</p>}
      </div>

      {selected && (
        <LeadDetail
          lead={selected}
          onClose={() => {
            setSelected(null);
            qc.invalidateQueries({ queryKey: ['acquisition-leads'] });
          }}
        />
      )}
    </div>
  );
}
