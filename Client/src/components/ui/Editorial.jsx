import { createElement, useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function useInView(ref, { once = true, rootMargin = '0px 0px -12% 0px', threshold = 0.12 } = {}) {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) {
      setInView(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { rootMargin, threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, once, rootMargin, threshold]);

  return inView;
}

const VARIANT_CLASS = {
  up: 'g-reveal',
  fade: 'g-reveal-fade',
  mask: 'g-reveal-mask',
};

export function Reveal({ as = 'div', variant = 'up', delay = 0, className = '', style, children, ...rest }) {
  const ref = useRef(null);
  const inView = useInView(ref);
  return createElement(
    as,
    {
      ref,
      className: `${VARIANT_CLASS[variant] || VARIANT_CLASS.up} ${inView ? 'is-in' : ''} ${className}`.trim(),
      style: { '--d': `${delay}ms`, ...style },
      ...rest,
    },
    children
  );
}

export function RevealLines({ as = 'h2', lines, delay = 0, className = '', lineClassName = '', immediate = false }) {
  const ref = useRef(null);
  const inView = useInView(ref);
  const shown = immediate || inView;
  return createElement(
    as,
    {
      ref,
      className: `g-lines ${shown ? 'is-in' : ''} ${className}`.trim(),
      style: { '--d': `${delay}ms` },
    },
    lines.filter(Boolean).map((line, i) => (
      <span key={i} className={`g-line ${lineClassName}`} style={{ '--i': i }}>
        <span>{line}</span>
      </span>
    ))
  );
}

export function Marquee({ children, duration = 40, gap = '3rem', className = '', trackClassName = '' }) {
  const style = { '--dur': `${duration}s`, '--gap': gap };
  return (
    <div className={`g-marquee ${className}`} style={style}>
      <div className={`g-marquee__track ${trackClassName}`}>{children}</div>
      <div className={`g-marquee__track ${trackClassName}`} aria-hidden="true">
        {children}
      </div>
    </div>
  );
}

export function ArrowDot({ size = 14 }) {
  return (
    <span className="g-btn__arrow" aria-hidden="true">
      <ArrowRight size={size} strokeWidth={2.25} />
    </span>
  );
}

export function SectionHead({
  index,
  eyebrow,
  lead,
  em,
  body,
  action,
  dark = false,
  className = '',
  titleClassName = '',
}) {
  const muted = dark ? 'text-white/55' : 'text-soul-muted';
  return (
    <div className={`flex flex-col gap-8 md:flex-row md:items-end md:justify-between ${className}`}>
      <div className="max-w-3xl">
        <Reveal className={`mb-5 flex items-center gap-3 ${muted}`}>
          {index ? <span className="g-index">({index})</span> : null}
          {index && eyebrow ? <span className={`h-px w-8 ${dark ? 'bg-white/25' : 'bg-soul-blue/25'}`} /> : null}
          {eyebrow ? <span className="g-index">{eyebrow}</span> : null}
        </Reveal>
        <RevealLines
          className={`g-display ${dark ? 'text-white' : 'text-soul-blue'} ${titleClassName || 'text-[clamp(40px,5.6vw,84px)]'}`}
          lines={[lead, em ? <em key="em">{em}</em> : null]}
        />
        {body ? (
          <Reveal delay={200} as="p" className={`mt-6 max-w-xl text-[15px] leading-relaxed md:text-base ${muted}`}>
            {body}
          </Reveal>
        ) : null}
      </div>
      {action ? (
        <Reveal delay={250} className="shrink-0">
          {action}
        </Reveal>
      ) : null}
    </div>
  );
}

export function ScrollText({ text, className = '', as = 'p' }) {
  const ref = useRef(null);
  const words = String(text || '').split(/\s+/).filter(Boolean);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (prefersReducedMotion()) {
      el.style.setProperty('--p', '1');
      return undefined;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const start = vh * 0.85;
      const end = vh * 0.3;
      const total = rect.height + (start - end);
      const progress = Math.min(1, Math.max(0, (start - rect.top) / total));
      el.style.setProperty('--p', progress.toFixed(4));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [text]);

  return createElement(
    as,
    { ref, className: `g-scrolltext ${className}`, style: { '--n': words.length + 2 } },
    words.map((word, i) => (
      <span key={`${word}-${i}`} className="g-word" style={{ '--i': i }}>
        {word}{' '}
      </span>
    ))
  );
}

export function CountUp({ value, duration = 1600, className = '' }) {
  const ref = useRef(null);
  const inView = useInView(ref);
  const target = Number(value) || 0;
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!inView) return undefined;
    if (prefersReducedMotion() || target === 0) {
      setShown(target);
      return undefined;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - p) ** 4;
      setShown(Math.round(target * eased));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, target, duration]);

  return (
    <span ref={ref} className={className}>
      {shown.toLocaleString('en-US')}
    </span>
  );
}

export function useCairoTime() {
  const format = () => {
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Cairo',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date());
    } catch {
      return '';
    }
  };
  const [time, setTime] = useState(format);
  useEffect(() => {
    const id = window.setInterval(() => setTime(format()), 15000);
    return () => window.clearInterval(id);
  }, []);
  return time;
}

export function PageHero({
  index,
  eyebrow,
  lead,
  em,
  body,
  image,
  children,
  compact = false,
}) {
  if (image) {
    return (
      <section className="g-grain relative isolate flex min-h-[78svh] items-end overflow-hidden bg-soul-ink text-white">
        <img src={image} alt="" className="g-kenburns absolute inset-0 -z-10 h-full w-full object-cover" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-soul-ink/85 via-soul-ink/35 to-soul-ink/30" />
        <div className="g-shell relative z-[2] w-full pb-14 pt-40 md:pb-20">
          <div className="mb-6 flex items-center gap-3 text-white/70">
            {index ? <span className="g-index">({index})</span> : null}
            {index && eyebrow ? <span className="h-px w-8 bg-white/30" /> : null}
            {eyebrow ? <span className="g-index">{eyebrow}</span> : null}
          </div>
          <RevealLines
            as="h1"
            immediate
            delay={150}
            className="g-display text-[clamp(52px,9vw,140px)]"
            lines={[lead, em ? <em key="em">{em}</em> : null]}
          />
          {body ? (
            <p className="soul-fade-up mt-7 max-w-xl text-base leading-relaxed text-white/80 md:text-lg" style={{ animationDelay: '0.5s' }}>
              {body}
            </p>
          ) : null}
          {children ? (
            <div className="soul-fade-up mt-9" style={{ animationDelay: '0.65s' }}>
              {children}
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className={`g-shell ${compact ? 'pb-10 pt-8 md:pb-14 md:pt-12' : 'pb-14 pt-10 md:pb-20 md:pt-16'}`}>
      <div className="mb-6 flex items-center gap-3 text-soul-muted">
        {index ? <span className="g-index">({index})</span> : null}
        {index && eyebrow ? <span className="h-px w-8 bg-soul-blue/25" /> : null}
        {eyebrow ? <span className="g-index">{eyebrow}</span> : null}
      </div>
      <RevealLines
        as="h1"
        immediate
        delay={100}
        className={`g-display text-soul-blue ${compact ? 'text-[clamp(44px,6.5vw,96px)]' : 'text-[clamp(48px,8vw,128px)]'}`}
        lines={[lead, em ? <em key="em">{em}</em> : null]}
      />
      {body ? (
        <p className="soul-fade-up mt-7 max-w-2xl text-base leading-relaxed text-soul-muted md:text-lg" style={{ animationDelay: '0.4s' }}>
          {body}
        </p>
      ) : null}
      {children ? (
        <div className="soul-fade-up mt-9" style={{ animationDelay: '0.55s' }}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
