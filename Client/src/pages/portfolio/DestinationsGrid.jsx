import { useMemo } from 'react';
import { ArrowUpRight, MapPin } from 'lucide-react';
import { useProjectCatalog } from '../../hooks/useProjectCatalog';
import { whatsappHref } from '../../theme/brand';
import Reveal from './Reveal';

// The flagship projects. Photos and counts come from the live project catalog when it has them.
const FEATURED = [
  {
    key: 'galala',
    name: 'IL Monte Galala',
    location: 'Ain Sokhna',
    match: /monte|galala/i,
    image: '/compounds/il-monte-galala.webp',
    span: 'md:col-span-7 aspect-[4/5] md:aspect-[7/6]',
  },
  {
    key: 'gcribs',
    name: 'G-Cribs',
    location: 'El Gouna',
    match: /g-?cribs/i,
    image: '/soul-brand/coast-2.jpg',
    span: 'md:col-span-5 aspect-[4/5] md:aspect-[5/6] md:mt-24',
  },
  {
    key: 'newcairo',
    name: '90 Avenue & Azad',
    location: 'New Cairo',
    match: /90\s*avenue|azad/i,
    image: '/soul-v2/interlude.jpg',
    span: 'md:col-span-5 aspect-[4/5] md:aspect-[5/6]',
  },
  {
    key: 'hacienda',
    name: 'Hacienda West',
    location: 'North Coast',
    match: /hacienda/i,
    image: '/compounds/hacienda-west.jpg',
    span: 'md:col-span-7 aspect-[4/5] md:aspect-[7/6] md:-mt-24',
  },
];

// The page stands on its own (no links into the website): "Explore stay" opens a WhatsApp chat about the project.
const exploreHref = (name, location) => whatsappHref(`Hi Soul, I'd like to know about stays at ${name} (${location}).`);

export default function DestinationsGrid() {
  const { projectCards, loading: isLoading } = useProjectCatalog();

  const cards = useMemo(
    () =>
      FEATURED.map((f) => {
        const projects = projectCards.filter((p) => f.match.test(p.name || ''));
        const count = projects.reduce((s, p) => s + (Number(p.unitCount) || 0), 0);
        return {
          ...f,
          image: projects.find((p) => p.image && !p.image.startsWith('/soul-brand/coast-1'))?.image || f.image,
          count,
          href: exploreHref(f.name, f.location),
        };
      }),
    [projectCards]
  );

  return (
    <section id="destinations" className="scroll-mt-10 bg-[var(--pf-sand)] py-24 text-[var(--pf-ink)] md:py-36">
      <div className="pf-shell">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <Reveal>
            <p className="pf-eyebrow text-[var(--pf-gold-deep)]">The Portfolio</p>
            <h2 className="pf-serif mt-5 max-w-2xl text-[clamp(36px,5vw,64px)] leading-[1.02]">
              Destinations with a <em className="text-[var(--pf-sage)]">sense of place.</em>
            </h2>
          </Reveal>
          <Reveal delay={120}>
            <p className="max-w-sm text-[15px] leading-relaxed text-[#5b5b5b]">
              Coast, mountain and city: each address chosen for its light, its quiet and the way it feels to come home to.
            </p>
          </Reveal>
        </div>

        <div className="mt-14 grid gap-5 md:mt-20 md:grid-cols-12 md:gap-6">
          {cards.map((c, i) => (
            <Reveal key={c.key} zoom delay={(i % 2) * 140} className={`group relative overflow-hidden rounded-[26px] bg-[var(--pf-sand-2)] ${c.span}`}>
              <a href={c.href} target="_blank" rel="noreferrer" className="absolute inset-0 block focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-gold)]">
                <img
                  src={c.image}
                  alt={`${c.name}, ${c.location}`}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1600ms] ease-out group-hover:!scale-[1.04]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0d1117]/80 via-[#0d1117]/10 to-transparent" />
                <div className="absolute inset-0 bg-[#0d1117]/0 transition-colors duration-500 group-hover:bg-[#0d1117]/35" />

                <div className="absolute inset-x-5 top-5 flex items-start justify-between gap-3 md:inset-x-7 md:top-7">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/20 px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] text-white/90 backdrop-blur-md">
                    <MapPin className="h-3 w-3 text-[var(--pf-gold)]" /> {c.location}
                  </span>
                  {c.count > 0 || isLoading ? (
                    <span className="rounded-full bg-[var(--pf-sand)]/90 px-3 py-1.5 text-[11px] font-semibold tabular-nums text-[var(--pf-ink)]">
                      {isLoading ? '…' : `${c.count} ${c.count === 1 ? 'property' : 'properties'}`}
                    </span>
                  ) : null}
                </div>

                <div className="absolute inset-x-5 bottom-5 flex items-end justify-between gap-4 md:inset-x-7 md:bottom-7">
                  <h3 className="pf-serif text-[clamp(30px,3.4vw,46px)] leading-none text-white">{c.name}</h3>
                  <span className="inline-flex shrink-0 translate-y-2 items-center gap-2 rounded-full bg-[var(--pf-gold)] px-4 py-2.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--pf-ink)] opacity-100 transition duration-500 md:opacity-0 md:group-hover:translate-y-0 md:group-hover:opacity-100 md:group-focus-visible:opacity-100">
                    Explore stay <ArrowUpRight className="h-4 w-4" />
                  </span>
                </div>
              </a>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
