import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { useProjectCatalog } from '../../hooks/useProjectCatalog';
import { useLocale } from '../../context/LocaleContext';
import { Reveal, SectionHead } from '../ui/Editorial';

const PROJECT_PHRASE_KEYS = [
  'home.projectPhrase0',
  'home.projectPhrase1',
  'home.projectPhrase2',
  'home.projectPhrase3',
  'home.projectPhrase4',
  'home.projectPhrase5',
];

function phraseKeyForName(name = '') {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash + name.charCodeAt(i) * (i + 1)) % PROJECT_PHRASE_KEYS.length;
  }
  return PROJECT_PHRASE_KEYS[hash];
}

const hrefFor = (c) =>
  `/search?destination=${encodeURIComponent(c.destination)}&compound=${encodeURIComponent(c.name)}`;

export default function CompoundGrid({ index, showHead = true, limit = 0 }) {
  const { t } = useLocale();
  const { projectCards } = useProjectCatalog();
  const [active, setActive] = useState(0);

  const cards = useMemo(() => {
    const mapped = projectCards.map((p) => ({
      id: p.id,
      name: p.name,
      destination: p.destination,
      image: p.image || '/soul-brand/coast-2.jpg',
      phraseKey: phraseKeyForName(p.name),
    }));
    const foukaIdx = mapped.findIndex((c) => /fouka/i.test(c.name));
    if (foukaIdx <= 0) return mapped;
    const [fouka] = mapped.splice(foukaIdx, 1);
    return [fouka, ...mapped];
  }, [projectCards]);

  const head = !showHead ? null : (
    <SectionHead
      index={index}
      eyebrow={t('home.destEyebrow')}
      lead={t('home.destTitleLead')}
      em={t('home.destTitleEm')}
      body={t('home.destBody')}
    />
  );

  if (!cards.length) {
    return (
      <section className="bg-soul-paper py-24 md:py-32">
        <div className="g-shell">
          {head}
          <p className="mt-10 text-soul-muted">{t('home.projectsEmpty')}</p>
        </div>
      </section>
    );
  }

  const allCards = cards;
  const visible = limit > 0 ? allCards.slice(0, limit) : allCards;
  const hiddenCount = allCards.length - visible.length;
  const current = visible[Math.min(active, visible.length - 1)];

  return (
    <section className={`g-guides bg-soul-paper ${showHead ? 'py-24 md:py-32' : 'pb-24 md:pb-32'}`}>
      {head ? <div className="g-shell">{head}</div> : null}

      <div className={`g-rail md:hidden ${head ? 'mt-12' : ''}`}>
        {visible.map((c, i) => (
          <Link key={c.id} to={hrefFor(c)} className="group relative w-[78%] shrink-0 overflow-hidden rounded-[26px]">
            <div className="relative aspect-[4/5]">
              <img src={c.image} alt={c.name} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-soul-ink/80 via-soul-ink/10 to-transparent" />
              <div className="absolute inset-x-5 top-5 flex items-center justify-between text-white/80">
                <span className="g-index">{String(i + 1).padStart(2, '0')}</span>
                <span className="g-index">{c.destination}</span>
              </div>
              <div className="absolute inset-x-5 bottom-5 text-white">
                <div className="g-display text-4xl">{c.name}</div>
                <div className="mt-2 text-sm text-white/75">{t(c.phraseKey)}</div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className={`g-shell hidden gap-12 md:grid md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20 ${head ? 'mt-16' : ''}`}>
        <div className="relative">
          <Reveal variant="mask" className="sticky top-28 aspect-[4/5] overflow-hidden rounded-[32px] bg-soul-sand">
            <div className="absolute inset-0">
            {visible.map((c, i) => (
              <img
                key={c.id}
                src={c.image}
                alt={i === active ? c.name : ''}
                loading="lazy"
                decoding="async"
                className={`absolute inset-0 h-full w-full object-cover transition-all duration-[1100ms] ease-soul ${
                  i === active ? 'scale-100 opacity-100' : 'scale-[1.08] opacity-0'
                }`}
              />
            ))}
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-soul-ink/70 via-transparent to-transparent" />
            <div className="absolute inset-x-7 bottom-7 flex items-end justify-between gap-6 text-white">
              <div>
                <div className="g-index text-white/70">{current.destination}</div>
                <div key={current.id} className="soul-fade-up mt-2 text-lg text-white/90">
                  {t(current.phraseKey)}
                </div>
              </div>
              <span className="g-index shrink-0 text-white/70">
                {String(active + 1).padStart(2, '0')} / {String(visible.length).padStart(2, '0')}
              </span>
            </div>
          </Reveal>
        </div>

        <ul className="self-center border-t border-soul-line">
          {visible.map((c, i) => {
            const on = i === active;
            return (
              <Reveal as="li" key={c.id} delay={Math.min(i, 8) * 60} className="border-b border-soul-line">
                <Link
                  to={hrefFor(c)}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  className="group grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 py-6 lg:py-7"
                >
                  <span className={`g-index transition-colors duration-500 ${on ? 'text-soul-accent' : 'text-soul-muted/60'}`}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={`g-display block truncate text-[clamp(34px,3.6vw,58px)] transition-all duration-700 ease-soul ${
                        on ? 'translate-x-2 italic text-soul-blue rtl:-translate-x-2' : 'text-soul-blue/55'
                      }`}
                    >
                      {c.name}
                    </span>
                    <span className="g-index mt-1 block text-soul-muted">{c.destination}</span>
                  </span>
                  <span
                    className={`grid h-12 w-12 place-items-center rounded-full border transition-all duration-500 ease-soul ${
                      on ? 'border-soul-blue bg-soul-blue text-white' : 'border-soul-line text-soul-blue'
                    }`}
                  >
                    <ArrowUpRight size={18} className={`transition-transform duration-500 rtl:-scale-x-100 ${on ? 'rotate-45' : ''}`} />
                  </span>
                </Link>
              </Reveal>
            );
          })}
        </ul>
      </div>

      {hiddenCount > 0 ? (
        <div className="g-shell mt-14 md:mt-20">
          <Reveal className="g-divider">
            <Link to="/compounds" className="g-btn g-btn-ghost">
              {t('home.viewAllDestinations')}
              <span className="g-index opacity-60">({allCards.length})</span>
            </Link>
          </Reveal>
        </div>
      ) : null}
    </section>
  );
}
