import { ArrowRight, Check } from 'lucide-react';
import Reveal from './Reveal';
import { whatsappHref } from '../../theme/brand';

const POINTS = [
  { title: 'Guest operations', body: 'Check-ins, housekeeping, maintenance and round-the-clock guest support, handled by our team.' },
  { title: 'Pricing guidance', body: 'Season-aware nightly rates that keep your home booked without underselling it.' },
  { title: 'Boutique management', body: 'Professional listing, photography and a monthly owner statement you can read in a minute.' },
];

export default function OwnersCta() {
  return (
    <section id="owners" className="scroll-mt-10 bg-[var(--pf-sand)] text-[var(--pf-ink)]">
      <div className="grid md:grid-cols-2">
        <Reveal zoom className="relative min-h-[380px] overflow-hidden md:min-h-[640px]">
          <img
            src="/soul-brand/coast-hero-3.jpg"
            alt="A calm Soul Hospitality home by the sea"
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-tr from-[#0d1117]/55 to-transparent" />
          <p className="pf-serif absolute bottom-8 left-6 right-6 text-[22px] italic text-white/90 md:bottom-12 md:left-12">
            &ldquo;We look after it as if it were our own.&rdquo;
          </p>
        </Reveal>

        <div className="flex items-center px-5 py-20 md:px-16 md:py-24 lg:px-24">
          <div className="max-w-lg">
            <Reveal>
              <p className="pf-eyebrow text-[var(--pf-gold-deep)]">For owners</p>
              <h2 className="pf-serif mt-5 text-[clamp(40px,5.4vw,72px)] leading-[0.98]">
                Your home, <em className="text-[var(--pf-sage)]">our care.</em>
              </h2>
              <p className="mt-6 text-[15px] leading-relaxed text-[#5b5b5b]">
                Hand your property to a team that treats hospitality as a craft. You keep the peace of mind; we take care of everything else.
              </p>
            </Reveal>
            <ul className="mt-10 space-y-6">
              {POINTS.map((p, i) => (
                <Reveal as="li" key={p.title} delay={i * 120} className="flex gap-4">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--pf-gold)]/60 text-[var(--pf-gold-deep)]">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <p className="font-semibold">{p.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-[#6b6b6b]">{p.body}</p>
                  </div>
                </Reveal>
              ))}
            </ul>
            <Reveal delay={380}>
              <a
                href={whatsappHref("Hi Soul, I'd like to list my property with you.")}
                target="_blank"
                rel="noreferrer"
                className="group mt-12 inline-flex items-center gap-3 rounded-full bg-[var(--pf-gold)] px-8 py-4 text-sm font-semibold uppercase tracking-[0.16em] text-[var(--pf-ink)] shadow-[0_18px_40px_-18px_rgba(168,138,96,0.9)] transition hover:bg-[var(--pf-gold-deep)] hover:text-white"
              >
                List your property
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </a>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
