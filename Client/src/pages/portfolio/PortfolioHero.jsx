import { ArrowDown } from 'lucide-react';
import WaveCanvas from './WaveCanvas';
import Reveal from './Reveal';

export default function PortfolioHero() {
  return (
    <section className="relative flex min-h-[100svh] items-center overflow-hidden bg-[var(--pf-ink)]">
      {/* Soft mist, then the sea lines on top. */}
      <div aria-hidden="true" className="absolute inset-0">
        <div className="pf-mist left-[-10%] top-[10%] h-[55vh] w-[55vw] bg-[#7a9a95]/40" />
        <div className="pf-mist right-[-15%] top-[35%] h-[50vh] w-[50vw] bg-[#c5a880]/25" style={{ animationDuration: '32s' }} />
        <div className="pf-mist bottom-[-20%] left-[20%] h-[45vh] w-[60vw] bg-[#1d2a33]" style={{ animationDuration: '40s' }} />
      </div>
      <WaveCanvas />
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-[var(--pf-ink)]/40 via-transparent to-[var(--pf-ink)]" />

      <div className="pf-shell relative z-10 pb-28 pt-36 text-center md:pt-40">
        <Reveal>
          <p className="pf-eyebrow text-[var(--pf-gold)]">Soul Hospitality · Portfolio</p>
        </Reveal>
        <Reveal delay={120}>
          <h1 className="pf-serif mx-auto mt-6 max-w-4xl text-[clamp(44px,8vw,104px)] leading-[0.98] text-white">
            Where the sea <em className="text-[var(--pf-gold)]">meets</em> stillness.
          </h1>
        </Reveal>
        <Reveal delay={260}>
          <p className="mx-auto mt-7 max-w-xl text-[clamp(15px,1.6vw,18px)] leading-relaxed text-[var(--pf-stone)]">
            Curated boutique properties across Egypt&apos;s most inspiring destinations.
          </p>
        </Reveal>
      </div>

      <a
        href="#soul-standard"
        className="absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-[11px] uppercase tracking-[0.28em] text-white/70 backdrop-blur-md transition hover:border-[var(--pf-gold)]/50 hover:text-white"
      >
        Scroll
        <ArrowDown className="pf-nudge h-3.5 w-3.5 text-[var(--pf-gold)]" />
      </a>
    </section>
  );
}
