import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ImagePlus, Plus, RotateCcw, Save, Shuffle, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import WebsitePopupSection from '../components/WebsitePopupSection';

const TABS = [
  { id: 'home', label: 'Homepage' },
  { id: 'partners', label: 'Partners' },
  { id: 'order', label: 'Property order' },
  { id: 'popup', label: 'Entry popup' },
];

const SECTION_LABELS = {
  compounds: 'Destinations & projects grid',
  marquee: 'Scrolling project names',
  featured: 'Featured properties rail',
  trust: 'Trust / why Soul',
  interlude: 'Full-width interlude image',
  host: 'Be a Part of Soul (owners) block',
  manifesto: 'Manifesto & stats',
  partners: 'Partners strip (bottom of page)',
};

const EMPTY_CONTENT = {
  hero: { slides: [], title_light_en: '', title_light_ar: '', title_em_en: '', title_em_ar: '', subtitle_en: '', subtitle_ar: '' },
  sections: Object.fromEntries(Object.keys(SECTION_LABELS).map((k) => [k, true])),
  partners: [],
  interlude: { image: '', lead_en: '', lead_ar: '', em_en: '', em_ar: '' },
  host: { image: '', title_en: '', title_ar: '' },
};

function move(list, index, dir) {
  const next = [...list];
  const target = index + dir;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

async function uploadImage(file) {
  const fd = new FormData();
  fd.append('image', file);
  const { data } = await api.post('/site-settings/upload', fd);
  return data.url;
}

function ImageField({ label, value, onChange }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      onChange(await uploadImage(file));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-3">
        <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg border bg-gray-50">
          {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : null}
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <input className="input w-full" value={value || ''} placeholder="https://… or leave empty for default" onChange={(e) => onChange(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className="btn-secondary text-xs" onClick={() => ref.current?.click()} disabled={busy}>
              <ImagePlus className="h-3.5 w-3.5" /> {busy ? 'Uploading…' : 'Upload'}
            </button>
            {value ? (
              <button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => onChange('')}>
                Use default
              </button>
            ) : null}
          </div>
        </div>
        <input ref={ref} type="file" accept="image/*" className="hidden" onChange={pick} />
      </div>
    </div>
  );
}

function BilingualField({ label, obj, base, onChange, textarea = false }) {
  const Field = textarea ? 'textarea' : 'input';
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {['en', 'ar'].map((lang) => (
        <div key={lang}>
          <label className="label">
            {label} ({lang.toUpperCase()})
          </label>
          <Field
            dir={lang === 'ar' ? 'rtl' : 'ltr'}
            className={`input w-full ${textarea ? 'min-h-[80px]' : ''}`}
            value={obj?.[`${base}_${lang}`] || ''}
            placeholder="Empty = default text"
            onChange={(e) => onChange(`${base}_${lang}`, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}

function useContentEditor() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['site-settings-content'],
    queryFn: () => api.get('/site-settings/content').then((r) => r.data),
  });
  const [draft, setDraft] = useState(EMPTY_CONTENT);
  useEffect(() => {
    if (data) setDraft({ ...EMPTY_CONTENT, ...data });
  }, [data]);
  const save = useMutation({
    mutationFn: (content) => api.put('/site-settings/content', content).then((r) => r.data),
    onSuccess: (saved) => {
      toast.success('Website updated');
      qc.setQueryData(['site-settings-content'], saved);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Save failed'),
  });
  return { draft, setDraft, isLoading, save };
}

function SaveBar({ onSave, saving }) {
  return (
    <div className="sticky bottom-4 z-10 flex justify-end">
      <button type="button" className="btn-primary shadow-lg" onClick={onSave} disabled={saving}>
        <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Publish changes'}
      </button>
    </div>
  );
}

function HomepageTab({ editor }) {
  const { draft, setDraft, save } = editor;
  const setHero = (key, value) => setDraft((d) => ({ ...d, hero: { ...d.hero, [key]: value } }));
  const setSlides = (slides) => setHero('slides', slides);
  const slides = draft.hero?.slides || [];
  const setPart = (part) => (key, value) => setDraft((d) => ({ ...d, [part]: { ...d[part], [key]: value } }));

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Hero</h2>
          <p className="text-sm text-gray-500">The first screen guests see. Leave fields empty to keep the built-in text and photos.</p>
        </div>
        <BilingualField label="Title (light)" obj={draft.hero} base="title_light" onChange={setHero} />
        <BilingualField label="Title (italic)" obj={draft.hero} base="title_em" onChange={setHero} />
        <BilingualField label="Subtitle" obj={draft.hero} base="subtitle" onChange={setHero} textarea />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-medium text-gray-800">Slideshow photos</p>
            <button type="button" className="btn-secondary text-sm" onClick={() => setSlides([...slides, { src: '', caption_en: '', caption_ar: '' }])}>
              <Plus className="h-4 w-4" /> Add slide
            </button>
          </div>
          {slides.length === 0 ? <p className="text-sm text-gray-500">Using the default 3 coast photos.</p> : null}
          {slides.map((slide, i) => (
            <div key={i} className="rounded-xl border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500">Slide {i + 1}</span>
                <div className="flex gap-1">
                  <button type="button" className="p-1 text-gray-500 hover:text-gray-900" onClick={() => setSlides(move(slides, i, -1))} aria-label="Move up">
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" className="p-1 text-gray-500 hover:text-gray-900" onClick={() => setSlides(move(slides, i, 1))} aria-label="Move down">
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <button type="button" className="p-1 text-rose-500 hover:text-rose-700" onClick={() => setSlides(slides.filter((_, j) => j !== i))} aria-label="Remove">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <ImageField label="Photo" value={slide.src} onChange={(v) => setSlides(slides.map((s, j) => (j === i ? { ...s, src: v } : s)))} />
              <BilingualField
                label="Caption"
                obj={slide}
                base="caption"
                onChange={(key, value) => setSlides(slides.map((s, j) => (j === i ? { ...s, [key]: value } : s)))}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="card space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Homepage sections</h2>
          <p className="text-sm text-gray-500">Turn sections on or off.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(SECTION_LABELS).map(([key, label]) => (
            <label key={key} className="flex items-center gap-3 rounded-xl border px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={draft.sections?.[key] !== false}
                onChange={(e) => setDraft((d) => ({ ...d, sections: { ...d.sections, [key]: e.target.checked } }))}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Interlude</h2>
        <ImageField label="Background image" value={draft.interlude?.image} onChange={(v) => setPart('interlude')('image', v)} />
        <BilingualField label="Headline" obj={draft.interlude} base="lead" onChange={setPart('interlude')} />
        <BilingualField label="Headline (italic)" obj={draft.interlude} base="em" onChange={setPart('interlude')} />
      </div>

      <div className="card space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Be a Part of Soul block</h2>
        <ImageField label="Image" value={draft.host?.image} onChange={(v) => setPart('host')('image', v)} />
        <BilingualField label="Title" obj={draft.host} base="title" onChange={setPart('host')} />
      </div>

      <SaveBar onSave={() => save.mutate(draft)} saving={save.isPending} />
    </div>
  );
}

function PartnersTab({ editor }) {
  const { draft, setDraft, save } = editor;
  const partners = draft.partners || [];
  const setPartners = (list) => setDraft((d) => ({ ...d, partners: list }));
  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Partner logos</h2>
            <p className="text-sm text-gray-500">Shown in the strip at the bottom of the homepage. Empty list = default developer logos.</p>
          </div>
          <button type="button" className="btn-secondary text-sm" onClick={() => setPartners([...partners, { label: '', src: '' }])}>
            <Plus className="h-4 w-4" /> Add logo
          </button>
        </div>
        {partners.map((p, i) => (
          <div key={i} className="rounded-xl border p-3 space-y-3">
            <div className="flex items-center gap-3">
              <input
                className="input flex-1"
                placeholder="Partner name"
                value={p.label}
                onChange={(e) => setPartners(partners.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              />
              <button type="button" className="p-1 text-gray-500" onClick={() => setPartners(move(partners, i, -1))} aria-label="Move up">
                <ArrowUp className="h-4 w-4" />
              </button>
              <button type="button" className="p-1 text-gray-500" onClick={() => setPartners(move(partners, i, 1))} aria-label="Move down">
                <ArrowDown className="h-4 w-4" />
              </button>
              <button type="button" className="p-1 text-rose-500" onClick={() => setPartners(partners.filter((_, j) => j !== i))} aria-label="Remove">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <ImageField label="Logo" value={p.src} onChange={(v) => setPartners(partners.map((x, j) => (j === i ? { ...x, src: v } : x)))} />
          </div>
        ))}
      </div>
      <SaveBar onSave={() => save.mutate(draft)} saving={save.isPending} />
    </div>
  );
}

function PropertyOrderTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['site-settings-unit-order'],
    queryFn: () => api.get('/site-settings/unit-order').then((r) => r.data),
  });
  const [destinations, setDestinations] = useState([]);
  const [open, setOpen] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    if (data) setDestinations(data.destinations || []);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api.put('/site-settings/unit-order', {
        destinations: destinations.map((d) => ({ name: d.name, unit_ids: d.units.map((u) => u.id) })),
      }),
    onSuccess: () => {
      toast.success('Property order published');
      qc.invalidateQueries({ queryKey: ['site-settings-unit-order'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Save failed'),
  });
  const reset = useMutation({
    mutationFn: () => api.post('/site-settings/unit-order/reset-random'),
    onSuccess: () => {
      toast.success('Order reset to random');
      setConfirmReset(false);
      qc.invalidateQueries({ queryKey: ['site-settings-unit-order'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Reset failed'),
  });

  if (isLoading) return <LoadingSpinner />;
  const setUnits = (di, units) => setDestinations((list) => list.map((d, j) => (j === di ? { ...d, units } : d)));

  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">How properties are ordered on the guest site</h2>
          <p className="text-sm text-gray-500">
            Currently:{' '}
            <span className="font-semibold text-gray-800">
              {data?.mode === 'custom' ? 'Custom order by destination' : 'Random (reshuffled daily)'}
            </span>
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => setConfirmReset(true)}>
          <Shuffle className="h-4 w-4" /> Reset to random
        </button>
      </div>

      <div className="card space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Destinations</h2>
          <p className="text-sm text-gray-500">Order destinations, then open one to order its properties. Publish to switch to the custom order.</p>
        </div>
        {destinations.map((d, di) => (
          <div key={d.name} className="rounded-xl border">
            <div className="flex items-center gap-3 px-3 py-2">
              <span className="w-6 text-xs font-semibold text-gray-400">{di + 1}</span>
              <button type="button" className="flex-1 text-start font-medium text-gray-900" onClick={() => setOpen(open === d.name ? null : d.name)}>
                {d.name} <span className="text-xs font-normal text-gray-500">· {d.units.length} properties</span>
              </button>
              <button type="button" className="p-1 text-gray-500" onClick={() => setDestinations(move(destinations, di, -1))} aria-label="Move up">
                <ArrowUp className="h-4 w-4" />
              </button>
              <button type="button" className="p-1 text-gray-500" onClick={() => setDestinations(move(destinations, di, 1))} aria-label="Move down">
                <ArrowDown className="h-4 w-4" />
              </button>
            </div>
            {open === d.name ? (
              <ul className="divide-y border-t">
                {d.units.map((u, ui) => (
                  <li key={u.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-6 text-xs text-gray-400">{ui + 1}</span>
                    <div className="h-9 w-12 shrink-0 overflow-hidden rounded bg-gray-100">
                      {u.cover_url ? <img src={u.cover_url} alt="" className="h-full w-full object-cover" /> : null}
                    </div>
                    <span className="min-w-0 flex-1 truncate">
                      {u.title}
                      {u.unit_number ? <span className="text-gray-400"> · {u.unit_number}</span> : null}
                      {u.compound ? <span className="text-gray-400"> · {u.compound}</span> : null}
                    </span>
                    <button type="button" className="p-1 text-gray-500" onClick={() => setUnits(di, move(d.units, ui, -1))} aria-label="Move up">
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button type="button" className="p-1 text-gray-500" onClick={() => setUnits(di, move(d.units, ui, 1))} aria-label="Move down">
                      <ArrowDown className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>

      <div className="sticky bottom-4 z-10 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => setDestinations(data?.destinations || [])}>
          <RotateCcw className="h-4 w-4" /> Undo changes
        </button>
        <button type="button" className="btn-primary shadow-lg" onClick={() => save.mutate()} disabled={save.isPending}>
          <Save className="h-4 w-4" /> {save.isPending ? 'Saving…' : 'Publish order'}
        </button>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => reset.mutate()}
        loading={reset.isPending}
        title="Reset to random order?"
        message="The custom destination and property order will be cleared and the guest site will show properties in a random order (reshuffled daily)."
      />
    </div>
  );
}

export default function WebsiteControl() {
  const [tab, setTab] = useState('home');
  const editor = useContentEditor();

  return (
    <div className="space-y-6">
      <div className="page-header mb-0">
        <h1 className="page-title">Website</h1>
        <p className="page-subtitle">Control what guests see on the website — photos, text, sections, partners and property order.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-1.5 text-sm ${tab === t.id ? 'bg-soul-blue text-white' : 'border bg-white text-gray-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'order' ? (
        <PropertyOrderTab />
      ) : tab === 'popup' ? (
        <WebsitePopupSection />
      ) : editor.isLoading ? (
        <LoadingSpinner />
      ) : tab === 'partners' ? (
        <PartnersTab editor={editor} />
      ) : (
        <HomepageTab editor={editor} />
      )}
    </div>
  );
}
