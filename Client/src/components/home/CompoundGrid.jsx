import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useProjectCatalog } from '../../hooks/useProjectCatalog';

const AUTO_MS = 5500;
const GAP_PX = 20;

function useVisibleCount() {
  const [visible, setVisible] = useState(3);

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (w < 640) setVisible(1);
      else if (w < 1024) setVisible(2);
      else setVisible(3);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return visible;
}

export default function CompoundGrid({ counts = {} }) {
  const { projectCards } = useProjectCatalog();
  const visible = useVisibleCount();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStartX = useRef(null);

  const cards = useMemo(() => {
    const mapped = projectCards.map((p) => ({
      id: p.id,
      name: p.name,
      destination: p.destination,
      image: p.image || '/soul-brand/coast-2.jpg',
      propertyCount: counts[p.name] || 0,
    }));
    const foukaIdx = mapped.findIndex((c) => /fouka/i.test(c.name));
    if (foukaIdx <= 0) return mapped;
    const [fouka] = mapped.splice(foukaIdx, 1);
    return [fouka, ...mapped];
  }, [projectCards, counts]);

  const count = cards.length;
  const maxIndex = Math.max(0, count - visible);
  const pageCount = maxIndex + 1;
  const canSlide = count > visible;

  const goTo = useCallback(
    (next) => {
      if (!count) return;
      setIndex(Math.min(maxIndex, Math.max(0, next)));
    },
    [count, maxIndex]
  );

  const goPrev = useCallback(() => {
    setIndex((i) => (i <= 0 ? maxIndex : i - 1));
  }, [maxIndex]);

  const goNext = useCallback(() => {
    setIndex((i) => (i >= maxIndex ? 0 : i + 1));
  }, [maxIndex]);

  useEffect(() => {
    if (index > maxIndex) setIndex(maxIndex);
  }, [index, maxIndex]);

  useEffect(() => {
    if (paused || !canSlide) return undefined;
    const id = window.setInterval(() => {
      setIndex((i) => (i >= maxIndex ? 0 : i + 1));
    }, AUTO_MS);
    return () => window.clearInterval(id);
  }, [paused, canSlide, maxIndex]);

  function onTouchStart(e) {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  }

  function onTouchEnd(e) {
    if (touchStartX.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 48) return;
    if (dx > 0) goPrev();
    else goNext();
  }

  if (!count) {
    return (
      <section className="mx-auto max-w-soul px-5 sm:px-8 py-16 md:py-20">
        <div className="text-center">
          <h2 className="font-display text-3xl md:text-4xl text-soul-blue">
            Find your <em className="italic font-normal">Soul</em>
          </h2>
        </div>
        <p className="mt-4 text-center text-soul-muted">Projects will appear here once they are added.</p>
      </section>
    );
  }

  const cardBasis = `calc((100% - ${(visible - 1) * GAP_PX}px) / ${visible})`;
  const shift = `calc(-${index} * (${cardBasis} + ${GAP_PX}px))`;

  return (
    <section className="mx-auto max-w-soul px-5 sm:px-8 py-16 md:py-20">
      <div className="relative mb-6 md:mb-8">
        <div className="text-center">
          <h2 className="font-display text-3xl md:text-4xl text-soul-blue">
            Find your <em className="italic font-normal">Soul</em>
          </h2>
        </div>
        {canSlide ? (
          <div className="mt-4 flex items-center justify-center gap-2 sm:absolute sm:right-0 sm:top-1/2 sm:mt-0 sm:-translate-y-1/2">
            <button
              type="button"
              onClick={goPrev}
              aria-label="Previous projects"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-soul-line bg-white text-soul-blue transition hover:border-soul-blue/40 hover:bg-soul-sand/40"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={goNext}
              aria-label="Next projects"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-soul-line bg-white text-soul-blue transition hover:border-soul-blue/40 hover:bg-soul-sand/40"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        ) : null}
      </div>

      <div
        className="relative overflow-hidden"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="flex transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ gap: GAP_PX, transform: `translateX(${shift})` }}
        >
          {cards.map((c) => (
            <Link
              key={c.id}
              to={`/search?destination=${encodeURIComponent(c.destination)}&compound=${encodeURIComponent(c.name)}`}
              className="group relative aspect-[4/3] shrink-0 overflow-hidden rounded-2xl"
              style={{ flex: `0 0 ${cardBasis}` }}
            >
              <img
                src={c.image}
                alt={c.name}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-soul-ink/75 via-soul-ink/15 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5 text-white">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/75">
                  {c.destination}
                </div>
                <div className="mt-0.5 font-display text-xl sm:text-2xl">{c.name}</div>
                <div className="mt-1 text-sm text-white/80">
                  {c.propertyCount > 0
                    ? `${c.propertyCount} ${c.propertyCount === 1 ? 'Property' : 'Properties'}`
                    : 'Explore stays'}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {canSlide ? (
        <div className="mt-5 flex items-center justify-center gap-2" role="tablist" aria-label="Project pages">
          {Array.from({ length: pageCount }).map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Show projects starting at ${i + 1}`}
              onClick={() => goTo(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === index ? 'w-8 bg-soul-blue' : 'w-1.5 bg-soul-line hover:bg-soul-muted'
              }`}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
