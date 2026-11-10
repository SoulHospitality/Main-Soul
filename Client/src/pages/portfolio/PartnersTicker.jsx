import Reveal from './Reveal';

const PARTNERS = [
  { name: 'Tatweer Misr', logo: 'https://res.cloudinary.com/zqhyzmvl/image/upload/v1784205791/Tatweer-Misr-removebg-preview_xjltqj.png' },
  { name: 'Palm Hills', logo: 'https://res.cloudinary.com/zqhyzmvl/image/upload/v1784205791/Palm-Hills-removebg-preview_xnnjvq.png' },
  { name: 'Mountain View', logo: 'https://res.cloudinary.com/zqhyzmvl/image/upload/v1784205735/images__2_-removebg-preview_w5bwps.png' },
  { name: 'Emaar', logo: 'https://res.cloudinary.com/zqhyzmvl/image/upload/v1783598502/Emaar-Properties_rbhrww.png' },
  { name: 'Sabbour Consulting', logo: 'https://res.cloudinary.com/zqhyzmvl/image/upload/v1784205791/Sabbour-removebg-preview_dwdeem.png' },
];

function Partner({ p, hidden }) {
  return (
    <li aria-hidden={hidden || undefined} className="flex shrink-0 items-center gap-5 px-8 md:px-12">
      <span className="flex h-12 w-[120px] items-center justify-center md:h-14 md:w-[140px]">
        <img
          src={p.logo}
          alt={hidden ? '' : p.name}
          loading="lazy"
          decoding="async"
          className="max-h-full max-w-full object-contain opacity-60 brightness-0 invert transition duration-500 hover:opacity-100"
        />
      </span>
      <span className="pf-serif whitespace-nowrap text-[22px] text-white/45 md:text-[26px]">{p.name}</span>
      <span className="ml-8 h-1 w-1 rounded-full bg-[var(--pf-gold)]/60 md:ml-12" />
    </li>
  );
}

/** Developers we work with, as a slow marquee (the list repeats once so the loop is seamless). */
export default function PartnersTicker() {
  return (
    <section id="partners" className="scroll-mt-10 border-y border-white/10 bg-[var(--pf-ink-2)] py-20 md:py-24">
      <div className="pf-shell">
        <Reveal className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="pf-eyebrow text-[var(--pf-gold)]">Trusted partners</p>
            <h2 className="pf-serif mt-4 text-[clamp(30px,3.6vw,46px)] leading-tight text-white">
              Alongside Egypt&apos;s finest developers.
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-[var(--pf-stone)]">
            Our homes sit in master-planned communities by the developers shaping Egypt&apos;s coast and capital.
          </p>
        </Reveal>
      </div>
      <Reveal delay={150} className="pf-marquee-wrap pf-fade-x mt-14 overflow-hidden">
        <ul className="pf-marquee flex w-max">
          {PARTNERS.map((p) => <Partner key={p.name} p={p} />)}
          {PARTNERS.map((p) => <Partner key={`${p.name}-2`} p={p} hidden />)}
        </ul>
      </Reveal>
    </section>
  );
}
