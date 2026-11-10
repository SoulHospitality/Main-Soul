import Reveal from './Reveal';

const PILLARS = [
  { n: '01', title: 'Verified Luxury', body: 'Handpicked homes, each inspected in person for comfort, quality and calm before a guest arrives.' },
  { n: '02', title: 'Seamless Booking', body: 'Clear pricing with nothing hidden, and instant WhatsApp assistance from the first question to checkout.' },
  { n: '03', title: 'Dedicated Hospitality', body: 'An on-ground team that supports you throughout the stay, from arrival to the last morning coffee.' },
];

/** Lets the glow follow the pointer inside a card. */
function track(e) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
}

export default function SoulStandard() {
  return (
    <section id="soul-standard" className="relative scroll-mt-20 bg-[var(--pf-ink)] py-24 md:py-36">
      <div className="pf-shell">
        <div className="grid gap-8 md:grid-cols-[1fr_1.2fr] md:items-end">
          <Reveal>
            <p className="pf-eyebrow text-[var(--pf-sage)]">The Soul Standard</p>
            <h2 className="pf-serif mt-5 text-[clamp(36px,5vw,64px)] leading-[1.02] text-white">
              Three promises, <em className="text-[var(--pf-gold)]">every stay.</em>
            </h2>
          </Reveal>
          <Reveal delay={120}>
            <p className="max-w-md text-[15px] leading-relaxed text-[var(--pf-stone)] md:justify-self-end">
              Hospitality is in the details nobody sees. These are the ones we never skip, in every home we look after.
            </p>
          </Reveal>
        </div>

        <div className="mt-14 grid gap-5 md:mt-20 md:grid-cols-3">
          {PILLARS.map((p, i) => (
            <Reveal key={p.n} delay={i * 140}>
              <article onPointerMove={track} className="pf-card h-full rounded-[22px] border border-white/10 p-8 md:p-10">
                <p className="pf-eyebrow flex items-center gap-3 text-[var(--pf-gold)]">
                  {p.n}
                  <span className="h-px w-10 bg-[var(--pf-gold)]/40" />
                </p>
                <h3 className="pf-serif mt-10 text-[30px] leading-tight text-white md:text-[34px]">{p.title}</h3>
                <p className="mt-4 text-[14.5px] leading-relaxed text-[var(--pf-stone)]">{p.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
