import { useMemo } from 'react';
import { ArrowDown, ArrowUp, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { PORTFOLIO_DEFAULTS } from '../../pages/portfolio/portfolioContent';

const SECTION_NAMES = {
  standard: 'The Soul Standard (three promises)',
  destinations: 'Destinations grid',
  partners: 'Partner logos strip',
  owners: 'For owners block',
};

function move(list, index, dir) {
  const next = [...list];
  const target = index + dir;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function Text({ label, value, placeholder, onChange, textarea = false }) {
  const Field = textarea ? 'textarea' : 'input';
  return (
    <div>
      <label className="label">{label}</label>
      <Field
        className={`input w-full ${textarea ? 'min-h-[80px]' : ''}`}
        value={value || ''}
        placeholder={placeholder || ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** Small label / headline / second line / paragraph: the same four fields head every section. */
function Heading({ part, value, onChange, introLabel = 'Paragraph' }) {
  const def = PORTFOLIO_DEFAULTS[part];
  const set = (key) => (v) => onChange({ ...value, [key]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Text label="Small label" value={value.eyebrow} placeholder={def.eyebrow} onChange={set('eyebrow')} />
      <Text label="Headline" value={value.title} placeholder={def.title} onChange={set('title')} />
      <Text label="Headline, second line (lighter)" value={value.title_light} placeholder={def.title_light} onChange={set('title_light')} />
      <div className="sm:col-span-2">
        <Text label={introLabel} value={value.intro} placeholder={def.intro} onChange={set('intro')} textarea />
      </div>
    </div>
  );
}

function ListControls({ list, index, onChange }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button type="button" className="p-1 text-gray-500" onClick={() => onChange(move(list, index, -1))} aria-label="Move up">
        <ArrowUp className="h-4 w-4" />
      </button>
      <button type="button" className="p-1 text-gray-500" onClick={() => onChange(move(list, index, 1))} aria-label="Move down">
        <ArrowDown className="h-4 w-4" />
      </button>
      <button type="button" className="p-1 text-rose-500" onClick={() => onChange(list.filter((_, j) => j !== index))} aria-label="Remove">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function Card({ title, hint, action, children }) {
  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          {hint ? <p className="text-sm text-gray-500">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * Website › Portfolio page. Empty text keeps the built-in wording (shown greyed as a placeholder);
 * lists start from what the page shows today, so editing changes exactly what guests see.
 */
export default function PortfolioEditor({ draft, setDraft, ImageField, SaveBar, onSave, saving }) {
  const saved = draft.portfolio || {};
  const pf = useMemo(() => {
    const part = (key) => ({ ...(saved[key] || {}) });
    const out = {
      sections: { ...PORTFOLIO_DEFAULTS.sections, ...(saved.sections || {}) },
      hero: part('hero'),
      standard: part('standard'),
      destinations: part('destinations'),
      partners: part('partners'),
      owners: part('owners'),
      footer: part('footer'),
    };
    const listOr = (value, fallback) => (Array.isArray(value) && value.length ? value : fallback.map((x) => ({ ...x })));
    out.standard.pillars = listOr(out.standard.pillars, PORTFOLIO_DEFAULTS.standard.pillars);
    out.destinations.cards = listOr(out.destinations.cards, PORTFOLIO_DEFAULTS.destinations.cards);
    out.partners.logos = listOr(out.partners.logos, PORTFOLIO_DEFAULTS.partners.logos);
    out.owners.points = listOr(out.owners.points, PORTFOLIO_DEFAULTS.owners.points);
    return out;
  }, [saved]);

  const setPart = (key) => (value) => setDraft((d) => ({ ...d, portfolio: { ...pf, ...(d.portfolio || {}), [key]: value } }));
  const setList = (key, field) => (list) => setPart(key)({ ...pf[key], [field]: list });
  const setItem = (key, field, index, patch) =>
    setList(key, field)(pf[key][field].map((x, j) => (j === index ? { ...x, ...patch } : x)));

  return (
    <div className="space-y-6">
      <Card
        title="Portfolio page"
        hint="The brand page shared by link at /portfolio. Empty fields keep today’s wording; photos and lists start from what the page shows now."
        action={
          <a href="/portfolio" target="_blank" rel="noreferrer" className="btn-secondary text-sm">
            <ExternalLink className="h-4 w-4" /> Open the page
          </a>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(SECTION_NAMES).map(([key, label]) => (
            <label key={key} className="flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm">
              <input
                type="checkbox"
                checked={pf.sections[key] !== false}
                onChange={(e) => setPart('sections')({ ...pf.sections, [key]: e.target.checked })}
              />
              <span>Show {label}</span>
            </label>
          ))}
        </div>
      </Card>

      <Card title="Opening screen" hint="The first screen, over the moving sea lines.">
        <Heading part="hero" value={pf.hero} onChange={setPart('hero')} introLabel="Line under the headline" />
      </Card>

      <Card
        title="The Soul Standard"
        hint="Numbered automatically in the order shown."
        action={
          <button type="button" className="btn-secondary text-sm" onClick={() => setList('standard', 'pillars')([...pf.standard.pillars, { title: '', body: '' }])} disabled={pf.standard.pillars.length >= 6}>
            <Plus className="h-4 w-4" /> Add promise
          </button>
        }
      >
        <Heading part="standard" value={pf.standard} onChange={setPart('standard')} />
        {pf.standard.pillars.map((p, i) => (
          <div key={i} className="rounded-xl border p-3 space-y-3">
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-gray-500">{String(i + 1).padStart(2, '0')}</span>
              <input className="input flex-1" placeholder="Title" value={p.title} onChange={(e) => setItem('standard', 'pillars', i, { title: e.target.value })} />
              <ListControls list={pf.standard.pillars} index={i} onChange={setList('standard', 'pillars')} />
            </div>
            <textarea className="input w-full min-h-[64px]" placeholder="Text" value={p.body} onChange={(e) => setItem('standard', 'pillars', i, { body: e.target.value })} />
          </div>
        ))}
      </Card>

      <Card
        title="Destinations"
        hint="Cards sit two to a row (wide and narrow, alternating). The property count is live: it adds the published stays of every project whose name contains one of the keywords."
        action={
          <button type="button" className="btn-secondary text-sm" onClick={() => setList('destinations', 'cards')([...pf.destinations.cards, { name: '', location: '', match: '', image: '' }])} disabled={pf.destinations.cards.length >= 12}>
            <Plus className="h-4 w-4" /> Add destination
          </button>
        }
      >
        <Heading part="destinations" value={pf.destinations} onChange={setPart('destinations')} />
        {pf.destinations.cards.map((c, i) => (
          <div key={i} className="rounded-xl border p-3 space-y-3">
            <div className="flex items-start gap-3">
              <div className="grid flex-1 gap-3 sm:grid-cols-3">
                <Text label="Name" value={c.name} onChange={(v) => setItem('destinations', 'cards', i, { name: v })} />
                <Text label="Location" value={c.location} onChange={(v) => setItem('destinations', 'cards', i, { location: v })} />
                <Text label="Count projects named (comma-separated)" value={c.match} placeholder={c.name} onChange={(v) => setItem('destinations', 'cards', i, { match: v })} />
              </div>
              <ListControls list={pf.destinations.cards} index={i} onChange={setList('destinations', 'cards')} />
            </div>
            <ImageField label="Photo (required)" value={c.image} onChange={(v) => setItem('destinations', 'cards', i, { image: v })} />
          </div>
        ))}
      </Card>

      <Card
        title="Partners"
        hint="Logos only: the logo already carries the name. White backgrounds are made transparent automatically."
        action={
          <button type="button" className="btn-secondary text-sm" onClick={() => setList('partners', 'logos')([...pf.partners.logos, { name: '', logo: '', size: 'm' }])} disabled={pf.partners.logos.length >= 20}>
            <Plus className="h-4 w-4" /> Add logo
          </button>
        }
      >
        <Heading part="partners" value={pf.partners} onChange={setPart('partners')} />
        {pf.partners.logos.map((l, i) => (
          <div key={i} className="rounded-xl border p-3 space-y-3">
            <div className="flex items-center gap-3">
              <input className="input flex-1" placeholder="Partner name (for screen readers)" value={l.name} onChange={(e) => setItem('partners', 'logos', i, { name: e.target.value })} />
              <select className="input w-32" value={l.size || 'm'} onChange={(e) => setItem('partners', 'logos', i, { size: e.target.value })} aria-label="Logo size">
                <option value="s">Small</option>
                <option value="m">Medium</option>
                <option value="l">Large</option>
                <option value="xl">Extra large</option>
              </select>
              <ListControls list={pf.partners.logos} index={i} onChange={setList('partners', 'logos')} />
            </div>
            <ImageField label="Logo" value={l.logo} onChange={(v) => setItem('partners', 'logos', i, { logo: v })} />
          </div>
        ))}
      </Card>

      <Card
        title="For owners"
        action={
          <button type="button" className="btn-secondary text-sm" onClick={() => setList('owners', 'points')([...pf.owners.points, { title: '', body: '' }])} disabled={pf.owners.points.length >= 6}>
            <Plus className="h-4 w-4" /> Add point
          </button>
        }
      >
        <Heading part="owners" value={pf.owners} onChange={setPart('owners')} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Text label="Quote on the photo" value={pf.owners.quote} placeholder={PORTFOLIO_DEFAULTS.owners.quote} onChange={(v) => setPart('owners')({ ...pf.owners, quote: v })} />
          <Text label="Button (opens WhatsApp)" value={pf.owners.button} placeholder={PORTFOLIO_DEFAULTS.owners.button} onChange={(v) => setPart('owners')({ ...pf.owners, button: v })} />
        </div>
        <ImageField label="Photo" value={pf.owners.image} onChange={(v) => setPart('owners')({ ...pf.owners, image: v })} />
        {pf.owners.points.map((p, i) => (
          <div key={i} className="rounded-xl border p-3 space-y-3">
            <div className="flex items-center gap-3">
              <input className="input flex-1" placeholder="Title" value={p.title} onChange={(e) => setItem('owners', 'points', i, { title: e.target.value })} />
              <ListControls list={pf.owners.points} index={i} onChange={setList('owners', 'points')} />
            </div>
            <textarea className="input w-full min-h-[64px]" placeholder="Text" value={p.body} onChange={(e) => setItem('owners', 'points', i, { body: e.target.value })} />
          </div>
        ))}
      </Card>

      <Card title="Footer">
        <div className="grid gap-3 sm:grid-cols-2">
          <Text label="Line" value={pf.footer.tagline} placeholder={PORTFOLIO_DEFAULTS.footer.tagline} onChange={(v) => setPart('footer')({ ...pf.footer, tagline: v })} />
          <Text label="Second line (lighter)" value={pf.footer.tagline_light} placeholder={PORTFOLIO_DEFAULTS.footer.tagline_light} onChange={(v) => setPart('footer')({ ...pf.footer, tagline_light: v })} />
        </div>
      </Card>

      <SaveBar onSave={onSave} saving={saving} />
    </div>
  );
}
