import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardCheck, Plus, Trash2, Upload, Video } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import Modal from '../components/ui/Modal';
import InspectionVideo from '../components/InspectionVideo';
import { useAuth } from '../context/AuthContext';
import { formatDate, formatDateTime } from '../utils/formatters';

const STATUS_META = {
  unassigned: { label: 'Not assigned', className: 'bg-gray-100 text-gray-700' },
  assigned: { label: 'Waiting for checklist', className: 'bg-amber-100 text-amber-800' },
  checklist_submitted: { label: 'Checklist to approve', className: 'bg-blue-100 text-blue-800' },
  checklist_approved: { label: 'Ready to inspect', className: 'bg-indigo-100 text-indigo-800' },
  completed: { label: 'Inspected', className: 'bg-emerald-100 text-emerald-800' },
};

const FILTERS = [
  { id: 'open', label: 'Not inspected yet' },
  { id: 'unassigned', label: 'Not assigned', supervisorOnly: true },
  { id: 'assigned', label: 'Waiting for checklist' },
  { id: 'checklist_submitted', label: 'Checklist to approve' },
  { id: 'checklist_approved', label: 'Ready to inspect' },
  { id: 'completed', label: 'Inspected' },
  { id: 'all', label: 'All' },
];

const CHUNK_BYTES = 20 * 1024 * 1024;

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.unassigned;
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${meta.className}`}>
      {meta.label}
    </span>
  );
}

function postChunk(url, formData, headers, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {
        data = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data?.error?.message || `Video upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Video upload failed — check your connection'));
    xhr.send(formData);
  });
}

/** Chunked direct upload so long walkthrough videos don't pass through the API server. */
async function uploadVideo(file, sig, onProgress) {
  const url = `https://api.cloudinary.com/v1_1/${sig.cloud_name}/video/upload`;
  const uploadId = `${sig.public_id}-${Math.random().toString(36).slice(2, 10)}`;
  let result = null;
  for (let start = 0; start < file.size; start += CHUNK_BYTES) {
    const end = Math.min(start + CHUNK_BYTES, file.size);
    const fd = new FormData();
    fd.append('file', file.slice(start, end), file.name);
    fd.append('api_key', sig.api_key);
    fd.append('timestamp', String(sig.timestamp));
    fd.append('signature', sig.signature);
    fd.append('folder', sig.folder);
    fd.append('public_id', sig.public_id);
    if (sig.eager) {
      fd.append('eager', sig.eager);
      fd.append('eager_async', String(sig.eager_async));
    }
    result = await postChunk(
      url,
      fd,
      {
        'X-Unique-Upload-Id': uploadId,
        'Content-Range': `bytes ${start}-${end - 1}/${file.size}`,
      },
      (loaded) => onProgress(Math.min(99, Math.round(((start + loaded) / file.size) * 100)))
    );
  }
  onProgress(100);
  return result;
}

function defaultSectionsFor(unit) {
  const beds = Math.max(0, Math.min(20, Number(unit?.beds) || 0));
  const baths = Math.max(0, Math.min(20, Math.ceil(Number(unit?.baths) || 0)));
  const sections = [];
  for (let i = 1; i <= beds; i += 1) sections.push(`Bedroom ${i}`);
  for (let i = 1; i <= baths; i += 1) sections.push(`Bathroom ${i}`);
  sections.push('Kitchen');
  if (unit?.has_nanny_room) sections.push('Nanny room');
  sections.push('General');
  return sections;
}

function groupBySection(items, defaults = []) {
  const order = [...defaults];
  items.forEach((it) => {
    const s = it.section || 'General';
    if (!order.includes(s)) order.push(s);
  });
  return order.map((section) => [
    section,
    items.map((it, idx) => ({ it, idx })).filter(({ it }) => (it.section || 'General') === section),
  ]);
}

function itemText(item) {
  const qty = Number(item.qty) > 1 ? `${item.qty} × ` : '';
  return `${qty}${item.label}`;
}

const EMPTY_DRAFT = { label: '', qty: '1', brand: '' };

function ChecklistEditor({ items, onChange, disabled, defaultSections = ['General'] }) {
  const [drafts, setDrafts] = useState({});
  const [extraSections, setExtraSections] = useState([]);
  const [newSection, setNewSection] = useState('');
  const groups = groupBySection(items, [...defaultSections, ...extraSections]);

  const update = (idx, patch) => onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const add = (section) => {
    const d = drafts[section] || EMPTY_DRAFT;
    const label = d.label.trim();
    if (!label) return;
    onChange([
      ...items,
      { id: null, section, label, qty: Math.max(1, Number(d.qty) || 1), brand: d.brand.trim(), added_by: null },
    ]);
    setDrafts((prev) => ({ ...prev, [section]: EMPTY_DRAFT }));
  };
  const setDraft = (section, patch) =>
    setDrafts((prev) => ({ ...prev, [section]: { ...(prev[section] || EMPTY_DRAFT), ...patch } }));

  return (
    <div className="space-y-4">
      {groups.map(([section, entries]) => {
        const d = drafts[section] || EMPTY_DRAFT;
        return (
          <div key={section} className="rounded-xl border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-900">{section}</h4>
              <span className="text-[11px] text-gray-400">{entries.length} item{entries.length === 1 ? '' : 's'}</span>
            </div>
            {entries.length ? (
              <div className="space-y-1.5">
                <div className="hidden sm:grid grid-cols-[1fr_4.5rem_9rem_2rem] gap-2 text-[10px] uppercase text-gray-400">
                  <span>Item</span>
                  <span>Qty</span>
                  <span>Brand</span>
                  <span />
                </div>
                {entries.map(({ it, idx }) => (
                  <div key={it.id || `new-${idx}`} className="grid grid-cols-[1fr_4.5rem_9rem_2rem] gap-2 items-center">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <input
                        className="input text-sm py-1.5 flex-1 min-w-0"
                        value={it.label}
                        disabled={disabled}
                        onChange={(e) => update(idx, { label: e.target.value })}
                      />
                      {it.added_by === 'manager' ? (
                        <span className="text-[10px] uppercase text-indigo-600 font-semibold">Mgr</span>
                      ) : null}
                    </div>
                    <input
                      type="number"
                      min="1"
                      className="input text-sm py-1.5"
                      value={it.qty ?? 1}
                      disabled={disabled}
                      onChange={(e) => update(idx, { qty: e.target.value })}
                    />
                    <input
                      className="input text-sm py-1.5"
                      value={it.brand || ''}
                      placeholder="Brand"
                      disabled={disabled}
                      onChange={(e) => update(idx, { brand: e.target.value })}
                    />
                    {!disabled ? (
                      <button
                        type="button"
                        className="p-1.5 text-gray-400 hover:text-red-600"
                        onClick={() => onChange(items.filter((_, i) => i !== idx))}
                        aria-label="Remove item"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">No items yet.</p>
            )}
            {!disabled ? (
              <div className="grid grid-cols-[1fr_4.5rem_9rem_auto] gap-2 items-center pt-1">
                <input
                  className="input text-sm py-1.5"
                  placeholder={section.startsWith('Bedroom') ? 'e.g. King bed' : section.startsWith('Bathroom') ? 'e.g. Water heater' : 'e.g. Fridge'}
                  value={d.label}
                  onChange={(e) => setDraft(section, { label: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      add(section);
                    }
                  }}
                />
                <input
                  type="number"
                  min="1"
                  className="input text-sm py-1.5"
                  value={d.qty}
                  onChange={(e) => setDraft(section, { qty: e.target.value })}
                />
                <input
                  className="input text-sm py-1.5"
                  placeholder="Brand"
                  value={d.brand}
                  onChange={(e) => setDraft(section, { brand: e.target.value })}
                />
                <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1" onClick={() => add(section)}>
                  <Plus className="w-4 h-4" /> Add
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
      {!disabled ? (
        <div className="flex items-center gap-2">
          <input
            className="input text-sm py-1.5 flex-1"
            placeholder="Add another area (e.g. Living room, Balcony)"
            value={newSection}
            onChange={(e) => setNewSection(e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => {
              const name = newSection.trim();
              if (!name) return;
              if (!groups.some(([s]) => s.toLowerCase() === name.toLowerCase())) {
                setExtraSections((prev) => [...prev, name]);
              }
              setNewSection('');
            }}
          >
            <Plus className="w-4 h-4" /> Area
          </button>
        </div>
      ) : null}
    </div>
  );
}

const DETAIL_FIELDS = [
  ['unit_number', 'Unit code'],
  ['title', 'Title'],
  ['project', 'Project'],
  ['compound', 'Compound'],
  ['area', 'Area'],
  ['city', 'City'],
  ['property_type', 'Type'],
  ['listing_type', 'Listing'],
  ['beds', 'Bedrooms'],
  ['baths', 'Bathrooms'],
  ['guests', 'Max guests'],
  ['size_m2', 'Size (m²)'],
  ['floor', 'Floor'],
  ['view', 'View'],
  ['min_nights', 'Min nights'],
  ['access_card_count_included', 'Access cards'],
  ['status', 'Website status'],
  ['owner_name', 'Owner'],
  ['owner_phone', 'Owner phone'],
  ['owner_email', 'Owner email'],
];

const TEXT_FIELDS = [
  ['short_description', 'Description'],
  ['the_property', 'The property'],
  ['guest_access', 'Guest access'],
  ['neighborhood', 'Neighborhood'],
  ['getting_around', 'Getting around'],
  ['other_details', 'Other details'],
  ['notes', 'Internal notes'],
];

function displayValue(key, value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key === 'listing_type') return value === 'long_term' ? 'Long-term rent' : 'Short-term rent';
  return String(value);
}

function UnitDetails({ unit, portalOwners }) {
  const photos = [unit.cover_url, ...(Array.isArray(unit.photo_urls) ? unit.photo_urls : [])].filter(
    (url, i, arr) => url && arr.indexOf(url) === i
  );
  const lists = [
    ['Amenities', unit.amenities],
    ['Facilities', unit.facilities],
  ].filter(([, v]) => Array.isArray(v) && v.length);

  return (
    <div className="space-y-4">
      {photos.length ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((url) => (
            <a key={url} href={url} target="_blank" rel="noreferrer" className="flex-shrink-0">
              <img src={url} alt="" className="h-28 w-40 object-cover rounded-lg border" loading="lazy" />
            </a>
          ))}
        </div>
      ) : null}

      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
        {DETAIL_FIELDS.map(([key, label]) => {
          const v = displayValue(key, unit[key]);
          if (!v) return null;
          return (
            <div key={key}>
              <dt className="text-[10px] uppercase text-gray-500">{label}</dt>
              <dd className="text-gray-900 break-words">{v}</dd>
            </div>
          );
        })}
        {unit.has_nanny_room ? (
          <div>
            <dt className="text-[10px] uppercase text-gray-500">Nanny room</dt>
            <dd className="text-gray-900">Yes</dd>
          </div>
        ) : null}
        {portalOwners?.length ? (
          <div>
            <dt className="text-[10px] uppercase text-gray-500">Owner portal accounts</dt>
            <dd className="text-gray-900">{portalOwners.map((o) => o.full_name).join(', ')}</dd>
          </div>
        ) : null}
        {unit.location_link ? (
          <div>
            <dt className="text-[10px] uppercase text-gray-500">Location</dt>
            <dd>
              <a href={unit.location_link} target="_blank" rel="noreferrer" className="text-soul-blue underline">
                Open map
              </a>
            </dd>
          </div>
        ) : null}
      </dl>

      {lists.map(([label, values]) => (
        <div key={label}>
          <div className="text-[10px] uppercase text-gray-500 mb-1">{label}</div>
          <div className="flex flex-wrap gap-1.5">
            {values.map((v) => (
              <span key={v} className="px-2 py-0.5 rounded-full bg-gray-100 text-xs text-gray-700">
                {v}
              </span>
            ))}
          </div>
        </div>
      ))}

      {TEXT_FIELDS.map(([key, label]) =>
        unit[key] ? (
          <div key={key}>
            <div className="text-[10px] uppercase text-gray-500 mb-1">{label}</div>
            <p className="text-sm text-gray-700 whitespace-pre-line">{unit[key]}</p>
          </div>
        ) : null
      )}
    </div>
  );
}

function InspectionResults({ inspection }) {
  return (
    <div className="space-y-4">
      <InspectionVideo url={inspection.video_url} />
      {groupBySection(inspection.checklist).filter(([, entries]) => entries.length).map(([section, entries]) => (
        <div key={section} className="space-y-1">
          <div className="text-xs font-semibold text-gray-700">{section}</div>
          <ul className="divide-y border rounded-xl">
            {entries.map(({ it: item }) => (
              <li key={item.id} className="px-3 py-2 text-sm flex items-start gap-3">
                <span
                  className={`mt-0.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                    item.result === 'issue' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {item.result === 'issue' ? 'Issue' : 'OK'}
                </span>
                <div>
                  <div className="text-gray-900">
                    {itemText(item)}
                    {item.brand ? <span className="text-gray-500"> · {item.brand}</span> : null}
                  </div>
                  {item.note ? <div className="text-xs text-gray-600 mt-0.5">{item.note}</div> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {inspection.agent_notes ? (
        <div>
          <div className="text-[10px] uppercase text-gray-500 mb-1">Agent notes</div>
          <p className="text-sm text-gray-700 whitespace-pre-line">{inspection.agent_notes}</p>
        </div>
      ) : null}
      <p className="text-xs text-gray-500">
        Inspected by {inspection.completed_by_name || '—'} on {formatDateTime(inspection.completed_at)}
      </p>
    </div>
  );
}

function InspectionModal({ unitId, onClose, agents, isSupervisor, isAgent }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['unit-inspection', unitId],
    queryFn: async () => (await api.get(`/ops/inspections/unit/${unitId}`)).data,
    enabled: !!unitId,
  });
  const inspection = data?.inspection;
  const status = inspection?.status;

  const [assignee, setAssignee] = useState('');
  const [items, setItems] = useState([]);
  const [managerNote, setManagerNote] = useState('');
  const [results, setResults] = useState({});
  const [agentNotes, setAgentNotes] = useState('');
  const [uploadPct, setUploadPct] = useState(null);

  useEffect(() => {
    if (!inspection) return;
    setAssignee(inspection.assigned_to ? String(inspection.assigned_to) : '');
    setItems(
      inspection.checklist.map((it) => ({
        id: it.id,
        section: it.section || 'General',
        label: it.label,
        qty: it.qty || 1,
        brand: it.brand || '',
        added_by: it.added_by,
      }))
    );
    setManagerNote(inspection.manager_note || '');
    setResults(
      Object.fromEntries(
        inspection.checklist.map((it) => [it.id, { result: it.result || null, note: it.note || '' }])
      )
    );
    setAgentNotes(inspection.agent_notes || '');
  }, [inspection]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['unit-inspection', unitId] });
    qc.invalidateQueries({ queryKey: ['unit-inspections'] });
  };
  const onError = (fallback) => (e) => toast.error(e.response?.data?.error || e.message || fallback);
  const payloadItems = () =>
    items
      .filter((it) => it.label.trim())
      .map((it) => ({
        id: it.id,
        section: it.section || 'General',
        label: it.label.trim(),
        qty: Math.max(1, Number(it.qty) || 1),
        brand: String(it.brand || '').trim() || null,
      }));
  const defaultSections = defaultSectionsFor(data?.unit || inspection);

  const assignMutation = useMutation({
    mutationFn: () => api.post(`/ops/inspections/unit/${unitId}/assign`, { staff_id: Number(assignee) }),
    onSuccess: () => {
      toast.success('Inspection assigned');
      refresh();
    },
    onError: onError('Assign failed'),
  });

  const submitChecklistMutation = useMutation({
    mutationFn: () =>
      api.put(`/ops/inspections/${inspection.inspection_id}/checklist`, { items: payloadItems() }),
    onSuccess: () => {
      toast.success('Checklist sent to the operations manager');
      refresh();
    },
    onError: onError('Could not submit checklist'),
  });

  const approveMutation = useMutation({
    mutationFn: () =>
      api.post(`/ops/inspections/${inspection.inspection_id}/approve-checklist`, {
        items: payloadItems(),
        note: managerNote,
      }),
    onSuccess: () => {
      toast.success('Checklist approved');
      refresh();
    },
    onError: onError('Could not approve checklist'),
  });

  const videoMutation = useMutation({
    mutationFn: async (file) => {
      const sig = (await api.post(`/ops/inspections/${inspection.inspection_id}/video-upload`)).data;
      setUploadPct(0);
      const uploaded = await uploadVideo(file, sig, setUploadPct);
      return api.post(`/ops/inspections/${inspection.inspection_id}/video`, { video_url: uploaded.secure_url });
    },
    onSuccess: () => {
      toast.success('Video uploaded and saved');
      setUploadPct(null);
      refresh();
    },
    onError: (e) => {
      setUploadPct(null);
      onError('Video upload failed')(e);
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!inspection.video_url) throw new Error('Upload the inspection video first');
      const missing = inspection.checklist.filter((it) => !results[it.id]?.result);
      if (missing.length) throw new Error(`Mark every item as OK or Issue (${missing.length} left)`);
      return api.post(`/ops/inspections/${inspection.inspection_id}/complete`, {
        notes: agentNotes,
        results: inspection.checklist.map((it) => ({
          id: it.id,
          result: results[it.id]?.result || null,
          note: results[it.id]?.note || '',
        })),
      });
    },
    onSuccess: () => {
      toast.success('Inspection finished — video sent to the owner and the operations manager');
      refresh();
    },
    onError: onError('Could not finish inspection'),
  });

  const title = inspection
    ? `Inspection · ${inspection.unit_number || inspection.unit_title || 'Unit'}`
    : 'Inspection';

  const canEditChecklist = isAgent && ['assigned', 'checklist_submitted'].includes(status);
  const canApprove = isSupervisor && status === 'checklist_submitted';
  const canInspect = status === 'checklist_approved';
  const canUploadVideo = isAgent && ['assigned', 'checklist_submitted', 'checklist_approved'].includes(status);
  const uploading = videoMutation.isPending;
  const finishing = completeMutation.isPending;
  const busy = finishing || uploading;

  return (
    <Modal open={!!unitId} onClose={busy ? () => {} : onClose} title={title} size="xl">
      {isLoading ? (
        <LoadingSpinner />
      ) : isError ? (
        <p className="text-sm text-red-600">
          {error?.response?.data?.error || error?.message || 'Could not load the unit'}
        </p>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <StatusBadge status={status} />
            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
              {inspection.unit_added_by_name ? (
                <span>
                  Unit added by <span className="font-medium">{inspection.unit_added_by_name}</span>
                </span>
              ) : null}
              {inspection.assignee_name ? (
                <span>
                  Assigned to <span className="font-medium">{inspection.assignee_name}</span>
                </span>
              ) : null}
            </div>
          </div>

          {isSupervisor && status !== 'completed' ? (
            <section className="card p-4 space-y-2">
              <h3 className="font-semibold text-gray-900">
                {inspection.assigned_to ? 'Reassign inspection' : 'Assign for inspection'}
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  className="input text-sm py-1.5 min-w-[14rem]"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                >
                  <option value="">Select an operations agent</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.full_name || a.username}
                      {a.staff_code ? ` (${a.staff_code})` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-primary text-sm"
                  disabled={!assignee || String(inspection.assigned_to) === assignee || assignMutation.isPending}
                  onClick={() => assignMutation.mutate()}
                >
                  {assignMutation.isPending ? 'Saving…' : 'Assign'}
                </button>
              </div>
            </section>
          ) : null}

          {status === 'assigned' && !isAgent ? (
            <p className="text-sm text-gray-600">Waiting for the agent to send the inspection checklist.</p>
          ) : null}

          {canUploadVideo ? (
            <section className="card p-4 space-y-3">
              <div>
                <h3 className="flex items-center gap-2 font-semibold text-gray-900">
                  <Video className="w-4 h-4" /> Inspection video
                </h3>
                <p className="text-xs text-gray-500">
                  You can upload the walkthrough video anytime — while preparing or doing the checklist. It is saved
                  right away and shared with the owner when you finish.
                </p>
              </div>
              {inspection.video_url && !uploading ? <InspectionVideo url={inspection.video_url} /> : null}
              {uploading ? (
                <div className="space-y-1">
                  <p className="text-xs text-gray-600">
                    {uploadPct != null && uploadPct < 100 ? `Uploading ${uploadPct}%…` : 'Saving video…'}
                  </p>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-soul-blue transition-all" style={{ width: `${uploadPct ?? 0}%` }} />
                  </div>
                </div>
              ) : (
                <label className="btn-secondary text-sm inline-flex items-center gap-2 cursor-pointer w-fit">
                  <Upload className="w-4 h-4" />
                  {inspection.video_url ? 'Replace video' : 'Upload video'}
                  <input
                    type="file"
                    accept="video/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) videoMutation.mutate(file);
                    }}
                  />
                </label>
              )}
            </section>
          ) : !isAgent && status !== 'completed' && inspection.video_url ? (
            <section className="card p-4 space-y-3">
              <h3 className="flex items-center gap-2 font-semibold text-gray-900">
                <Video className="w-4 h-4" /> Inspection video (in progress)
              </h3>
              <InspectionVideo url={inspection.video_url} />
            </section>
          ) : null}

          {canEditChecklist ? (
            <section className="card p-4 space-y-3">
              <div>
                <h3 className="font-semibold text-gray-900">Inspection checklist</h3>
                <p className="text-xs text-gray-500">
                  List what is in each room — item, how many and the brand. The operations manager approves it
                  before you inspect.
                  {status === 'checklist_submitted' ? ' Sent — you can still edit it until it is approved.' : ''}
                </p>
              </div>
              <ChecklistEditor items={items} onChange={setItems} defaultSections={defaultSections} />
              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn-primary text-sm"
                  disabled={!payloadItems().length || submitChecklistMutation.isPending}
                  onClick={() => submitChecklistMutation.mutate()}
                >
                  {submitChecklistMutation.isPending
                    ? 'Sending…'
                    : status === 'checklist_submitted'
                      ? 'Update checklist'
                      : 'Send for approval'}
                </button>
              </div>
            </section>
          ) : null}

          {canApprove ? (
            <section className="card p-4 space-y-3">
              <div>
                <h3 className="font-semibold text-gray-900">Approve checklist</h3>
                <p className="text-xs text-gray-500">
                  Submitted by {inspection.assignee_name || 'the agent'} on{' '}
                  {formatDateTime(inspection.checklist_submitted_at)}. Edit, remove, or add items before approving.
                </p>
              </div>
              <ChecklistEditor items={items} onChange={setItems} defaultSections={defaultSections} />
              <textarea
                className="input text-sm min-h-[4rem]"
                placeholder="Note for the agent (optional)"
                value={managerNote}
                onChange={(e) => setManagerNote(e.target.value)}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn-primary text-sm"
                  disabled={!payloadItems().length || approveMutation.isPending}
                  onClick={() => approveMutation.mutate()}
                >
                  {approveMutation.isPending ? 'Approving…' : 'Approve checklist'}
                </button>
              </div>
            </section>
          ) : null}

          {canInspect ? (
            <section className="card p-4 space-y-4">
              <div>
                <h3 className="font-semibold text-gray-900">Inspect the unit</h3>
                <p className="text-xs text-gray-500">
                  Checklist approved by {inspection.approved_by_name || 'the operations manager'}. Mark each item
                  and upload the walkthrough video (above), then finish.
                </p>
                {inspection.manager_note ? (
                  <p className="mt-2 text-sm bg-indigo-50 text-indigo-900 rounded-lg px-3 py-2">
                    <span className="font-semibold">Manager note:</span> {inspection.manager_note}
                  </p>
                ) : null}
              </div>

              {groupBySection(inspection.checklist).filter(([, entries]) => entries.length).map(([section, entries]) => (
                <div key={section} className="space-y-2">
                  <h4 className="text-sm font-semibold text-gray-800">{section}</h4>
                  <ul className="space-y-2">
                    {entries.map(({ it: item }) => {
                      const r = results[item.id] || {};
                      const setR = (patch) => setResults((prev) => ({ ...prev, [item.id]: { ...r, ...patch } }));
                      return (
                        <li key={item.id} className="border rounded-xl p-3 space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="text-sm text-gray-900">
                              {itemText(item)}
                              {item.brand ? <span className="text-gray-500"> · {item.brand}</span> : null}
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                              {['ok', 'issue'].map((value) => (
                                <button
                                  key={value}
                                  type="button"
                                  disabled={finishing}
                                  onClick={() => setR({ result: value })}
                                  className={`px-3 py-1 rounded-lg text-xs font-semibold border ${
                                    r.result === value
                                      ? value === 'ok'
                                        ? 'bg-emerald-600 text-white border-emerald-600'
                                        : 'bg-red-600 text-white border-red-600'
                                      : 'bg-white text-gray-600 hover:bg-gray-50'
                                  }`}
                                >
                                  {value === 'ok' ? 'OK' : 'Issue'}
                                </button>
                              ))}
                            </div>
                          </div>
                          {r.result === 'issue' ? (
                            <input
                              className="input text-sm py-1.5"
                              placeholder="Describe the issue"
                              value={r.note || ''}
                              disabled={finishing}
                              onChange={(e) => setR({ note: e.target.value })}
                            />
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}

              <textarea
                className="input text-sm min-h-[4rem]"
                placeholder="General notes (optional)"
                value={agentNotes}
                disabled={finishing}
                onChange={(e) => setAgentNotes(e.target.value)}
              />

              <div className="flex items-center justify-end gap-3 flex-wrap">
                {!inspection.video_url ? (
                  <span className="text-xs text-amber-700">
                    {uploading ? `Video uploading ${uploadPct ?? 0}% — you can keep filling the checklist` : 'Upload the inspection video to finish'}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="btn-primary text-sm inline-flex items-center gap-2"
                  disabled={finishing || uploading || !inspection.video_url}
                  onClick={() => completeMutation.mutate()}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {finishing ? 'Finishing…' : 'Finish inspection'}
                </button>
              </div>
            </section>
          ) : null}

          {status === 'checklist_submitted' && !canApprove && !canEditChecklist ? (
            <p className="text-sm text-gray-600">The checklist is waiting for the operations manager's approval.</p>
          ) : null}

          {status === 'completed' ? (
            <section className="space-y-2">
              <h3 className="font-semibold text-gray-900">Inspection result</h3>
              <InspectionResults inspection={inspection} />
            </section>
          ) : null}

          <section className="space-y-2">
            <h3 className="font-semibold text-gray-900">Unit details</h3>
            <UnitDetails unit={data.unit} portalOwners={data.portal_owners} />
          </section>
        </div>
      )}
    </Modal>
  );
}

export function UnitInspectionsSection() {
  const { user } = useAuth();
  const isSupervisor = user?.role === 'admin' || user?.role === 'operations_supervisor';
  const isAgent = user?.role === 'operations';
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedInspection = searchParams.get('inspection');
  const [filter, setFilter] = useState(linkedInspection ? 'all' : 'open');
  const [openUnitId, setOpenUnitId] = useState(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['unit-inspections', filter],
    queryFn: async () => (await api.get('/ops/inspections', { params: { status: filter } })).data,
  });

  const { data: agents = [] } = useQuery({
    queryKey: ['ops-agents'],
    queryFn: async () => {
      const r = await api.get('/ops/agents');
      return Array.isArray(r.data) ? r.data : [];
    },
    enabled: isSupervisor,
  });

  const rows = useMemo(() => (Array.isArray(data?.items) ? data.items : []), [data]);
  const counts = data?.counts || {};

  useEffect(() => {
    if (linkedInspection) setFilter('all');
  }, [linkedInspection]);

  useEffect(() => {
    if (!linkedInspection || filter !== 'all' || !rows.length) return;
    const match = rows.find((r) => String(r.inspection_id) === linkedInspection);
    if (match) setOpenUnitId(match.unit_id);
    const next = new URLSearchParams(searchParams);
    next.delete('inspection');
    setSearchParams(next, { replace: true });
  }, [linkedInspection, filter, rows, searchParams, setSearchParams]);

  const countFor = (id) => {
    if (id === 'all') return Object.values(counts).reduce((a, b) => a + b, 0);
    if (id === 'open') {
      return Object.entries(counts)
        .filter(([k]) => k !== 'completed')
        .reduce((a, [, b]) => a + b, 0);
    }
    return counts[id] || 0;
  };

  const filters = FILTERS.filter((f) => !f.supervisorOnly || isSupervisor);

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                filter === f.id
                  ? 'bg-soul-blue text-white border-soul-blue'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {f.label}
              <span className="ml-1 opacity-70 tabular-nums">{countFor(f.id)}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn-secondary text-sm" onClick={() => refetch()} disabled={isFetching}>
          Refresh
        </button>
      </div>

      <p className="text-xs text-gray-500">
        {isSupervisor
          ? `Units added since ${formatDate(data?.start_date)} must be inspected. Assign each one to an agent, approve the agent's checklist, then review the video.`
          : 'Units assigned to you for inspection. Send your checklist for approval, then inspect the unit and upload a video.'}
      </p>

      {isError ? (
        <div className="card p-10 text-center text-sm text-red-600">
          Could not load inspections: {error?.response?.data?.error || error?.message || 'Request failed'}
        </div>
      ) : !rows.length ? (
        <div className="card p-10 text-center text-sm text-gray-500">
          <ClipboardCheck className="mx-auto mb-2 h-8 w-8 text-gray-300" />
          No units here.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-gray-500 border-b">
              <tr>
                <th className="py-3 px-4">Unit</th>
                <th className="py-3 px-4">Added</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Assigned to</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.unit_id} className="border-t align-top">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      {r.cover_url ? (
                        <img src={r.cover_url} alt="" className="h-10 w-14 object-cover rounded-md border" loading="lazy" />
                      ) : null}
                      <div>
                        <div className="font-semibold text-soul-blue">{r.unit_number || r.unit_title || '—'}</div>
                        <div className="text-xs text-gray-500 truncate max-w-[14rem]">
                          {[r.project, r.property_type, r.beds != null ? `${r.beds} BR` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    {formatDate(r.unit_created_at)}
                    {r.unit_added_by_name ? (
                      <div className="text-[11px] text-gray-500">by {r.unit_added_by_name}</div>
                    ) : null}
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={r.status} />
                    {r.status === 'completed' ? (
                      <div className="text-[11px] text-gray-500 mt-1">{formatDateTime(r.completed_at)}</div>
                    ) : null}
                  </td>
                  <td className="py-3 px-4">
                    {r.assignee_name ? (
                      <>
                        <div className="font-medium">{r.assignee_name}</div>
                        {r.assignee_code ? (
                          <div className="text-[11px] text-gray-500 font-mono">{r.assignee_code}</div>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button type="button" className="btn-secondary text-sm" onClick={() => setOpenUnitId(r.unit_id)}>
                      {isSupervisor && r.status === 'unassigned'
                        ? 'Assign'
                        : isSupervisor && r.status === 'checklist_submitted'
                          ? 'Review checklist'
                          : 'Open'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openUnitId ? (
        <InspectionModal
          unitId={openUnitId}
          onClose={() => setOpenUnitId(null)}
          agents={agents}
          isSupervisor={isSupervisor}
          isAgent={isAgent}
        />
      ) : null}
    </div>
  );
}
