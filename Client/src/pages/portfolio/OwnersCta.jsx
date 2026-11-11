import { ArrowRight, Check } from 'lucide-react';
import { whatsappHref } from '../../theme/brand';
import Reveal from './Reveal';

const POINTS = [
  { title: 'Guest operations', body: 'Check-ins, housekeeping, maintenance and round-the-clock guest support, handled by our team.' },
  { title: 'Pricing guidance', body: 'Season-aware nightly rates that keep your home booked without underselling it.' },
  { title: 'Boutique management', body: 'Professional listing, photography and a monthly owner statement you can read in a minute.' },
];

export default function OwnersCta() {
  return (
    <section id="owners" className="scroll-mt-10 bg-[var(--pf-ivory)]">
      <div className="grid md:grid-cols-2">
        <Reveal zoom className="relative min-h-[380px] overflow-hidden md:min-h-[680px]">
          <img
            src="/soul-brand/coast-hero-3.jpg"
            alt="A calm Soul Hospitality home by the sea"
            loading="lazy"
            decoding="async"
            className="pf-img absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-tr from-[#0c2440]/65 via-[#0c2440]/10 to-transparent" />
          <p className="g-statement absolute bottom-8 left-6 right-6 text-[20px] text-white md:bottom-12 md:left-12 md:text-[24px]">
            &ldquo;We look after it as if it were our own.&rdquo;
          </p>
        </Reveal>

        <div className="flex items-center px-5 py-20 md:px-14 md:py-24 lg:px-20">
          <div className="max-w-lg">
            <Reveal>
              <p className="g-index flex items-center gap-3 text-[var(--pf-muted)]">
                <span className="g-dot" /> For owners
              </p>
              <h2 className="g-display mt-6 text-[clamp(40px,5.6vw,84px)] text-[var(--pf-navy)]">
                Your home,
                <span className="block font-light text-[var(--pf-muted)]">our care.</span>
              </h2>
              <p className="g-statement mt-6 text-[17px] leading-relaxed text-[var(--pf-muted)]">
                Hand your property to a team that treats hospitality as a craft. You keep the peace of mind; we take care of everything else.
              </p>
            </Reveal>
            <ul className="mt-10 space-y-6">
              {POINTS.map((p, i) => (
                <Reveal as="li" key={p.title} delay={i * 120} className="flex gap-4">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--pf-navy)] text-white">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <p className="font-semibold text-[var(--pf-navy)]">{p.title}</p>
                    <p className="mt-1 text-[15px] leading-relaxed text-[var(--pf-muted)]">{p.body}</p>
                  </div>
                </Reveal>
              ))}
            </ul>
            <Reveal delay={380}>
              <a
                href={whatsappHref("Hi Soul, I'd like to list my property with you.")}
                target="_blank"
                rel="noreferrer"
                className="group mt-12 inline-flex items-center gap-3 rounded-full bg-[var(--pf-navy)] px-8 py-4 text-[13px] font-semibold uppercase tracking-[0.1em] text-white shadow-[0_18px_40px_-18px_rgba(22,61,104,0.8)] transition hover:bg-[var(--pf-ink)]"
              >
                List your property
                <ArrowRight className="h-4 w-4 text-[var(--pf-vista)] transition-transform group-hover:translate-x-1" />
              </a>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
