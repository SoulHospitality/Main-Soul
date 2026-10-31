import { useEffect } from 'react';

export const SLIDE_MS = 7000;

/** Cross-fading photo backdrop; the parent owns `index` so the headline can follow the active slide. */
export default function HeroSlideshow({ slides, index, onChange }) {
  const count = slides.length;

  useEffect(() => {
    if (count < 2) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const id = window.setTimeout(() => onChange((index + 1) % count), SLIDE_MS);
    return () => window.clearTimeout(id);
  }, [index, count, onChange]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#0b4f73]" aria-hidden="true">
      {slides.map((slide, i) => (
        <div key={`${i}-${slide.src}`} className={`hero-slide ${i === index ? 'is-active' : ''}`}>
          {/* Re-keyed on activation so the slow zoom restarts each time the slide comes back. */}
          <img
            key={i === index ? `on-${index}` : 'off'}
            src={slide.src}
            alt=""
            className={`h-full w-full object-cover ${i === index ? 'g-kenburns' : ''}`}
            loading={i === 0 ? 'eager' : 'lazy'}
            fetchPriority={i === 0 ? 'high' : 'auto'}
          />
        </div>
      ))}
      <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/10 to-black/45" />
    </div>
  );
}

export function SlideDots({ count, index, onChange, label }) {
  if (count < 2) return null;
  return (
    <div className="flex items-center justify-center gap-2.5">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i)}
          aria-label={`${label} ${i + 1}`}
          aria-current={i === index ? 'true' : undefined}
          className="group relative h-6 px-0.5"
        >
          <span className="relative block h-[2px] w-9 overflow-hidden rounded-full bg-white/30">
            {i === index ? (
              <span
                key={index}
                className="hero-dot-fill absolute inset-0 origin-left bg-white"
                style={{ animationDuration: `${SLIDE_MS}ms` }}
              />
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}
