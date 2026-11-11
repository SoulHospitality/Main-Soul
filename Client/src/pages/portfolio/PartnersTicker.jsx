import { sharpLogo } from './cloudinary';
import Reveal from './Reveal';

const CLD = 'https://res.cloudinary.com/zqhyzmvl/image/upload/';
// Logos only (each logo already carries the name). Served upscaled, trimmed and transparent.
const PARTNERS = [
  { name: 'Tatweer Misr', logo: `${CLD}v1784205791/Tatweer-Misr-removebg-preview_xjltqj.png`, h: 'h-11 md:h-14' },
  { name: 'Palm Hills', logo: `${CLD}v1784205791/Palm-Hills-removebg-preview_xnnjvq.png`, h: 'h-9 md:h-11' },
  { name: 'Mountain View', logo: `${CLD}v1784205735/images__2_-removebg-preview_w5bwps.png`, h: 'h-16 md:h-20' },
  { name: 'Emaar', logo: `${CLD}v1783598502/Emaar-Properties_rbhrww.png`, h: 'h-6 md:h-8' },
  { name: 'Sabbour Consulting', logo: `${CLD}v1784205791/Sabbour-removebg-preview_dwdeem.png`, h: 'h-10 md:h-12' },
];

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
        className={`${p.h} w-auto max-w-[220px] object-contain opacity-70 grayscale transition duration-500 hover:opacity-100 hover:grayscale-0`}
      />
    </li>
  );
}

/** Developers we work with, as a slow marquee (the list repeats once so the loop is seamless). */
export default function PartnersTicker() {
  return (
    <section id="partners" className="scroll-mt-10 border-y border-[var(--pf-line)] bg-white py-20 md:py-28">
      <div className="pf-shell">
        <Reveal className="grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-end">
          <div>
            <p className="g-index flex items-center gap-3 text-[var(--pf-muted)]">
              <span className="g-dot" /> Trusted partners
            </p>
            <h2 className="g-display mt-6 text-[clamp(32px,4.2vw,60px)] text-[var(--pf-navy)]">
              Alongside Egypt&apos;s
              <span className="block font-light text-[var(--pf-muted)]">finest developers.</span>
            </h2>
          </div>
          <p className="g-statement max-w-md text-[17px] leading-relaxed text-[var(--pf-muted)] md:justify-self-end">
            Our homes sit in master-planned communities by the developers shaping Egypt&apos;s coast and capital.
          </p>
        </Reveal>
      </div>
      <Reveal delay={150} className="pf-marquee-wrap pf-fade-x mt-14 overflow-hidden md:mt-16">
        <ul className="pf-marquee flex w-max items-center">
          {PARTNERS.map((p) => <Partner key={p.name} p={p} />)}
          {PARTNERS.map((p) => <Partner key={`${p.name}-2`} p={p} hidden />)}
        </ul>
      </Reveal>
    </section>
  );
}
