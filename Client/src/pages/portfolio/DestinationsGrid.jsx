import { useMemo } from 'react';
import { ArrowUpRight, MapPin } from 'lucide-react';
import { useProjectCatalog } from '../../hooks/useProjectCatalog';
import { whatsappHref } from '../../theme/brand';
import { plain, sharp } from './cloudinary';
import Reveal from './Reveal';
import { usePortfolioContent } from './portfolioContent';

/**
 * Each row has one wide and one narrow card at the same height, so cards can never overlap.
 * Rows alternate wide-narrow / narrow-wide; a last card on its own takes the full width.
 */
function spanFor(index, total) {
  if (total % 2 === 1 && index === total - 1) return 'md:col-span-12';
  const row = Math.floor(index / 2);
  const first = index % 2 === 0;
  return (row % 2 === 0) === first ? 'md:col-span-7' : 'md:col-span-5';
}

/** A card counts the published stays of every project whose name contains one of its keywords. */
function matches(card, projectName) {
  const name = String(projectName || '').toLowerCase().replace(/[\s-]+/g, '');
  const words = String(card.match || card.name || '')
    .split(',')
    .map((w) => w.trim().toLowerCase().replace(/[\s-]+/g, ''))
    .filter(Boolean);
  return words.some((w) => name.includes(w));
}

// The page stands on its own (no links into the website): "Explore stay" opens a WhatsApp chat about the project.
const exploreHref = (name, location) => whatsappHref(`Hi Soul, I'd like to know about stays at ${name} (${location}).`);

function SharpImage({ src, alt }) {
  return (
    <img
      src={sharp(src)}
      alt={alt}
      loading="lazy"
      decoding="async"
      // A brand-new upscale can still be processing: fall back to the original, never a broken photo.
      onError={(e) => {
        const fallback = plain(src);
        if (e.currentTarget.src !== fallback) e.currentTarget.src = fallback;
      }}
      className="pf-img absolute inset-0 h-full w-full object-cover"
    />
  );
}

export default function DestinationsGrid() {
  const { projectCards, loading } = useProjectCatalog();
  const { destinations } = usePortfolioContent();

  const cards = useMemo(
    () =>
      destinations.cards.map((f, i, all) => {
        const projects = projectCards.filter((p) => matches(f, p.name));
        return {
          ...f,
          key: `${f.name}-${i}`,
          span: spanFor(i, all.length),
          count: projects.reduce((s, p) => s + (Number(p.unitCount) || 0), 0),
          href: exploreHref(f.name, f.location),
        };
      }),
    [projectCards, destinations.cards]
  );

  return (
    <section id="destinations" className="scroll-mt-10 bg-[var(--pf-paper)] py-24 md:py-36">
      <div className="pf-shell">
        <div className="grid gap-8 md:grid-cols-[1.2fr_1fr] md:items-end">
          <Reveal>
            <p className="g-index flex items-center gap-3 text-[var(--pf-muted)]">
              <span className="g-dot" /> {destinations.eyebrow}
            </p>
            <h2 className="g-display mt-6 text-[clamp(38px,5.4vw,80px)] text-[var(--pf-navy)]">
              {destinations.title}
              <span className="block font-light text-[var(--pf-muted)]">{destinations.title_light}</span>
            </h2>
          </Reveal>
          <Reveal delay={120}>
            <p className="g-statement max-w-md text-[17px] leading-relaxed text-[var(--pf-muted)] md:justify-self-end">
              {destinations.intro}
            </p>
          </Reveal>
        </div>

        <div className="mt-14 grid gap-5 md:mt-20 md:grid-cols-12 md:gap-6">
          {cards.map((c, i) => (
            <Reveal
              key={c.key}
              zoom
              delay={(i % 2) * 140}
              className={`group relative h-[440px] overflow-hidden rounded-[26px] bg-[var(--pf-platinum)] sm:h-[520px] lg:h-[600px] ${c.span}`}
            >
              <a
                href={c.href}
                target="_blank"
                rel="noreferrer"
                className="absolute inset-0 block focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-vista)] focus-visible:ring-offset-2"
              >
                <SharpImage src={c.image} alt={[c.name, c.location].filter(Boolean).join(', ')} />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0c2440]/85 via-[#0c2440]/10 to-transparent" />
                <div className="absolute inset-0 bg-[#0c2440]/0 transition-colors duration-500 group-hover:bg-[#0c2440]/30" />

                <div className="absolute inset-x-5 top-5 flex items-start justify-between gap-3 md:inset-x-7 md:top-7">
                  {c.location ? (
                    <span className="g-index inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-[#0c2440]/30 px-3 py-1.5 text-white backdrop-blur-md">
                      <MapPin className="h-3 w-3 text-[var(--pf-vista)]" /> {c.location}
                    </span>
                  ) : <span />}
                  {loading || c.count > 0 ? (
                    <span className="font-num rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-[var(--pf-navy)]">
                      {loading ? '…' : `${c.count} ${c.count === 1 ? 'property' : 'properties'}`}
                    </span>
                  ) : null}
                </div>

                <div className="absolute inset-x-5 bottom-5 flex flex-col items-start gap-4 md:inset-x-7 md:bottom-7">
                  <h3 className="g-display text-[clamp(28px,3.2vw,48px)] text-white">{c.name}</h3>
                  <span className="g-index inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[var(--pf-navy)] transition duration-500 md:translate-y-2 md:opacity-0 md:group-hover:translate-y-0 md:group-hover:opacity-100 md:group-focus-visible:opacity-100">
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
