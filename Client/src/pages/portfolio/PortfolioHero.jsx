import { ArrowDown } from 'lucide-react';
import WaveCanvas from './WaveCanvas';
import Reveal from './Reveal';
import { usePortfolioContent } from './portfolioContent';

export default function PortfolioHero() {
  const { hero, sections } = usePortfolioContent();
  const firstSection = ['standard', 'destinations', 'partners', 'owners'].find((k) => sections[k]);
  const scrollTo = { standard: '#soul-standard', destinations: '#destinations', partners: '#partners', owners: '#owners' }[firstSection];
  return (
    <section className="pf-grad relative flex min-h-[100svh] items-center overflow-hidden text-white">
      {/* Soft vista mist, then the sea lines on top. */}
      <div aria-hidden="true" className="absolute inset-0">
        <div className="pf-mist left-[-12%] top-[8%] h-[55vh] w-[55vw] bg-[#83a0e1]/25" />
        <div className="pf-mist right-[-15%] top-[38%] h-[50vh] w-[50vw] bg-[#52677e]/40" style={{ animationDuration: '32s' }} />
        <div className="pf-mist bottom-[-25%] left-[18%] h-[45vh] w-[60vw] bg-[#163d68]" style={{ animationDuration: '40s' }} />
      </div>
      <WaveCanvas />
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0c2440]/70 to-transparent" />

      <div className="pf-shell relative z-10 pb-28 pt-36 text-center md:pt-40">
        <Reveal>
          <p className="g-index inline-flex items-center gap-3 text-[var(--pf-vista)]">
            <span className="g-dot" /> {hero.eyebrow}
          </p>
        </Reveal>
        <Reveal delay={120}>
          <h1 className="g-display mx-auto mt-7 max-w-5xl text-[clamp(44px,8.4vw,128px)] text-white">
            {hero.title}
            <span className="block font-light text-white/75">{hero.title_light}</span>
          </h1>
        </Reveal>
        <Reveal delay={260}>
          <p className="g-statement mx-auto mt-8 max-w-xl text-[clamp(16px,1.7vw,20px)] leading-relaxed text-white/85">
            {hero.intro}
          </p>
        </Reveal>
      </div>

      {scrollTo ? (
      <a
        href={scrollTo}
        className="g-index absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/20 bg-white/5 px-5 py-2.5 text-white/75 backdrop-blur-md transition hover:border-[var(--pf-vista)] hover:text-white"
      >
        Scroll
        <ArrowDown className="pf-nudge h-3.5 w-3.5 text-[var(--pf-vista)]" />
      </a>
      ) : null}
    </section>
  );
}
