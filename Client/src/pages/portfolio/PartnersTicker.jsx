import { sharpLogo } from './cloudinary';
import Reveal from './Reveal';
import { LOGO_HEIGHTS, usePortfolioContent } from './portfolioContent';

// Logos only (each logo already carries the name). Served upscaled, trimmed and transparent.

function Partner({ p, hidden }) {
  return (
    <li aria-hidden={hidden || undefined} className="flex h-24 shrink-0 items-center px-10 md:h-28 md:px-16">
      <img
        src={sharpLogo(p.logo)}
        alt={hidden ? '' : p.name}
        loading="lazy"
        decoding="async"
        onError={(e) => {
          if (e.currentTarget.src !== p.logo) e.currentTarget.src = p.logo;
        }}
        className={`${LOGO_HEIGHTS[p.size] || LOGO_HEIGHTS.m} w-auto max-w-[220px] object-contain opacity-70 grayscale transition duration-500 hover:opacity-100 hover:grayscale-0`}
      />
    </li>
  );
}

/** Developers we work with, as a slow marquee (the list repeats once so the loop is seamless). */
export default function PartnersTicker() {
  const { partners } = usePortfolioContent();
  const logos = partners.logos;
  // Few logos would leave a gap in the loop: repeat the set until the strip is long enough.
  const copies = Math.max(1, Math.ceil(5 / Math.max(1, logos.length)));
  const strip = Array.from({ length: copies }, () => logos).flat();
  return (
    <section id="partners" className="scroll-mt-10 border-y border-[var(--pf-line)] bg-white py-20 md:py-28">
      <div className="pf-shell">
        <Reveal className="grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-end">
          <div>
            <p className="g-index flex items-center gap-3 text-[var(--pf-muted)]">
              <span className="g-dot" /> {partners.eyebrow}
            </p>
            <h2 className="g-display mt-6 text-[clamp(32px,4.2vw,60px)] text-[var(--pf-navy)]">
              {partners.title}
              <span className="block font-light text-[var(--pf-muted)]">{partners.title_light}</span>
            </h2>
          </div>
          <p className="g-statement max-w-md text-[17px] leading-relaxed text-[var(--pf-muted)] md:justify-self-end">
            {partners.intro}
          </p>
        </Reveal>
      </div>
      <Reveal delay={150} className="pf-marquee-wrap pf-fade-x mt-14 overflow-hidden md:mt-16">
        <ul className="pf-marquee flex w-max items-center">
          {strip.map((p, i) => <Partner key={`a${i}`} p={p} hidden={i >= logos.length} />)}
          {strip.map((p, i) => <Partner key={`b${i}`} p={p} hidden />)}
        </ul>
      </Reveal>
    </section>
  );
}
