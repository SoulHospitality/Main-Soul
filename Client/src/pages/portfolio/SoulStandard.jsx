import Reveal from './Reveal';

const PILLARS = [
  { n: '01', title: 'Verified Luxury', body: 'Handpicked homes, each inspected in person for comfort, quality and calm before a guest arrives.' },
  { n: '02', title: 'Seamless Booking', body: 'Clear pricing with nothing hidden, and instant WhatsApp assistance from the first question to checkout.' },
  { n: '03', title: 'Dedicated Hospitality', body: 'An on-ground team that supports you throughout the stay, from arrival to the last morning.' },
];

/** Lets the glow follow the pointer inside a card. */
function track(e) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
}

export default function SoulStandard() {
  return (
    <section id="soul-standard" className="relative scroll-mt-10 bg-[var(--pf-ink)] py-24 text-white md:py-36">
      <div className="pf-shell">
        <div className="grid gap-8 md:grid-cols-[1.2fr_1fr] md:items-end">
          <Reveal>
            <p className="g-index flex items-center gap-3 text-[var(--pf-vista)]">
              <span className="g-dot" /> The Soul Standard
            </p>
            <h2 className="g-display mt-6 text-[clamp(38px,5.4vw,80px)]">
              Three promises,
              <span className="block font-light text-white/70">every stay.</span>
            </h2>
          </Reveal>
          <Reveal delay={120}>
            <p className="g-statement max-w-md text-[17px] leading-relaxed text-white/75 md:justify-self-end">
              Hospitality is in the details nobody sees. These are the ones we never skip, in every home we look after.
            </p>
          </Reveal>
        </div>

        <div className="mt-14 grid gap-5 md:mt-20 md:grid-cols-3">
          {PILLARS.map((p, i) => (
            <Reveal key={p.n} delay={i * 140}>
              <article onPointerMove={track} className="pf-card h-full rounded-[26px] border border-white/10 p-8 md:p-10">
                <p className="g-index flex items-center gap-3 text-[var(--pf-vista)]">
                  {p.n}
                  <span className="h-px w-10 bg-[#83a0e1]/50" />
                </p>
                <h3 className="g-display mt-12 text-[26px] md:text-[30px]">{p.title}</h3>
                <p className="mt-4 text-[15px] leading-relaxed text-white/70">{p.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
