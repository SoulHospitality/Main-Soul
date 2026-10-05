import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import HeroSearch from '../components/home/HeroSearch';
import CompoundGrid from '../components/home/CompoundGrid';
import TrustSection from '../components/home/TrustSection';
import HostCta from '../components/home/HostCta';
import PartnersSection from '../components/home/PartnersSection';
import ListingCard, { ListingCardSkeleton } from '../components/ListingCard';
import {
  ArrowDot,
  CountUp,
  Marquee,
  Reveal,
  RevealLines,
  ScrollText,
  SectionHead,
  useCairoTime,
} from '../components/ui/Editorial';
import api from '../api/http';
import { brand } from '../theme/brand';
import { useLocale } from '../context/LocaleContext';
import { useProjectCatalog } from '../hooks/useProjectCatalog';

const SLIDE_MS = 8000;
const STAT_COLS = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' };
const INTRO_KEY = 'soul-intro-seen';

function IntroCurtain() {
  const { t } = useLocale();
  const time = useCairoTime();
  const [show, setShow] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
    try {
      return !window.sessionStorage.getItem(INTRO_KEY);
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!show) return undefined;
    try {
      window.sessionStorage.setItem(INTRO_KEY, '1');
    } catch {
      /* storage unavailable */
    }
    const id = window.setTimeout(() => setShow(false), 2150);
    return () => window.clearTimeout(id);
  }, [show]);

  if (!show) return null;

  return (
    <div className="g-intro" onClick={() => setShow(false)} aria-hidden="true">
      <div className="flex flex-col items-center gap-7 px-6 text-center">
        <img
          src="/soul-brand/soul-logo.png"
          alt=""
          className="h-9 w-auto brightness-0 invert"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
        <div className="g-display g-intro__words text-[clamp(48px,8vw,112px)] italic font-light">
          <span>
            <span>{t('home.introWord1')}</span>
            <span>{t('home.introWord2')}</span>
            <span>{t('home.introWord3')}</span>
          </span>
        </div>
        <div className="g-intro__bar w-44">
          <span />
        </div>
        <span className="g-index text-white/55">
          {brand.name} · {t('nav.localTime')} {time}
        </span>
      </div>
    </div>
  );
}
const HERO_SLIDES = [
  { src: '/soul-brand/coast-hero-2.jpg', captionKey: 'home.heroPhrase1' },
  { src: '/soul-brand/coast-hero-1.jpg', captionKey: 'home.heroPhrase2' },
  { src: '/soul-brand/coast-hero-3.jpg', captionKey: 'home.regions' },
];

function Hero({ homes }) {
  const { t } = useLocale();
  const time = useCairoTime();
  const [index, setIndex] = useState(0);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setIndex((i) => (i + 1) % HERO_SLIDES.length);
      setCycle((c) => c + 1);
    }, SLIDE_MS);
    return () => window.clearTimeout(id);
  }, [index, cycle]);

  const goTo = (i) => {
    setIndex(i);
    setCycle((c) => c + 1);
  };

  return (
    <section className="g-grain relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-soul-ink text-white">
      <div className="absolute inset-0 -z-10">
        {HERO_SLIDES.map((slide, i) => (
          <div
            key={slide.src}
            className={`absolute inset-0 transition-opacity duration-[1600ms] ease-soul ${
              i === index ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <img
              key={i === index ? `${slide.src}-${cycle}` : slide.src}
              src={slide.src}
              alt=""
              fetchPriority={i === 0 ? 'high' : 'low'}
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
              className={`h-full w-full object-cover ${i === index ? 'g-kenburns' : ''}`}
            />
          </div>
        ))}
        <div className="absolute inset-0 bg-gradient-to-b from-soul-ink/55 via-soul-ink/10 to-soul-ink/80" />
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(70% 55% at 88% 105%, rgba(242,140,40,0.28), transparent 60%)' }}
        />
      </div>

      <div className="g-shell relative z-[2] flex w-full flex-1 flex-col justify-end pb-8 pt-32 md:pb-10">
        <div
          className="soul-fade-up mb-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-white/75"
          style={{ animationDelay: '0.2s' }}
        >
          <span className="g-live" />
          <span className="g-index tabular-nums">
            {homes ? t('home.liveHomes', { count: homes.toLocaleString('en-US') }) : brand.name}
          </span>
          <span className="h-px w-10 bg-white/30" />
          <span className="g-index tabular-nums">
            {t('nav.localTime')} {time}
          </span>
          <span className="hidden h-px w-10 bg-white/30 md:inline-block" />
          <span className="g-index hidden md:inline">{t('home.regions')}</span>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <RevealLines
            as="h1"
            immediate
            delay={250}
            className="g-display text-[clamp(56px,10.6vw,170px)] !leading-[0.86]"
            lines={[
              <span key="l" className="font-light">{t('home.heroTitleLight')}</span>,
              <em key="e">{t('home.heroTitleEm')}</em>,
            ]}
          />
          <div className="soul-fade-up flex max-w-sm flex-col gap-6 lg:mb-4" style={{ animationDelay: '0.75s' }}>
            <p className="text-[15px] leading-relaxed text-white/80 md:text-base">{t('home.heroSubtitle')}</p>
            <div className="flex flex-wrap items-center gap-3">
              <Link to="/search" className="g-btn g-btn-light">
                {t('home.heroExplore')}
                <ArrowDot />
              </Link>
              <Link to="/long-term" className="g-btn g-btn-glass">
                {t('home.heroLongTerm')}
              </Link>
            </div>
          </div>
        </div>

        <div className="soul-fade-up mt-10 md:mt-12" style={{ animationDelay: '0.95s' }}>
          <HeroSearch />
        </div>

        <div className="mt-8 flex items-center justify-between gap-6 text-white/70">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <span className="g-index shrink-0 tabular-nums">
              {String(index + 1).padStart(2, '0')} / {String(HERO_SLIDES.length).padStart(2, '0')}
            </span>
            <div className="flex w-full max-w-[280px] gap-1.5">
              {HERO_SLIDES.map((slide, i) => (
                <button
                  key={slide.src}
                  type="button"
                  onClick={() => goTo(i)}
                  aria-label={`${i + 1}`}
                  className="relative h-6 flex-1"
                >
                  <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 overflow-hidden bg-white/25">
                    {i < index ? <span className="absolute inset-0 bg-white" /> : null}
                    {i === index ? (
                      <span
                        key={`${index}-${cycle}`}
                        className="g-progress-fill absolute inset-0 bg-white"
                        style={{ '--dur': `${SLIDE_MS}ms` }}
                      />
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
            <span key={index} className="g-index soul-fade-in hidden truncate md:inline">
              {t(HERO_SLIDES[index].captionKey)}
            </span>
          </div>
          <div className="hidden items-center gap-3 sm:flex">
            <span className="g-index">{t('home.heroScroll')}</span>
            <span className="relative h-10 w-px overflow-hidden bg-white/20">
              <span className="g-scroll-cue absolute inset-0 bg-white" />
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProjectMarquee() {
  const { projectCards } = useProjectCatalog();
  const names = useMemo(() => {
    const seen = new Set();
    return projectCards
      .map((p) => p.name)
      .filter((n) => {
        const k = String(n || '').toLowerCase();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  }, [projectCards]);

  if (!names.length) return null;
  const list = names.length < 6 ? [...names, ...names] : names;

  return (
    <section className="border-y border-soul-line bg-soul-paper py-8 md:py-10" aria-hidden="true">
      <Marquee duration={Math.max(28, list.length * 6)} gap="2.5rem">
        {list.map((name, i) => (
          <span key={`${name}-${i}`} className="flex items-center gap-10">
            <span
              className={`g-display whitespace-nowrap text-[clamp(40px,6vw,88px)] text-soul-blue ${
                i % 2 ? 'italic font-light text-soul-blue/45' : ''
              }`}
            >
              {name}
            </span>
            <span className="text-2xl text-soul-accent">✦</span>
          </span>
        ))}
      </Marquee>
    </section>
  );
}

function Manifesto({ homes }) {
  const { t } = useLocale();
  const { projectCards, destinations } = useProjectCatalog();

  const projectCount = new Set(projectCards.map((p) => String(p.name).toLowerCase())).size;
  const stats = [
    homes ? { value: homes, label: t('home.statHomes') } : null,
    projectCount ? { value: projectCount, label: t('home.statProjects') } : null,
    destinations.length ? { value: destinations.length, label: t('home.statDestinations') } : null,
  ].filter(Boolean);

  return (
    <section className="g-guides bg-soul-paper">
      <div className="g-shell grid gap-12 py-24 md:py-36 lg:grid-cols-[minmax(0,3fr)_minmax(0,9fr)] lg:gap-16">
        <Reveal className="flex flex-col gap-6 lg:pt-4">
          <div className="flex items-center gap-3 text-soul-muted">
            <span className="g-index">(01)</span>
            <span className="h-px w-8 bg-soul-blue/25" />
            <span className="g-index">{t('home.manifestoIndex')}</span>
          </div>
          <p className="max-w-xs text-sm leading-relaxed text-soul-muted">{t('home.manifestoNote')}</p>
          <Link to="/about" className="g-link w-fit text-sm font-semibold text-soul-blue">
            {t('home.manifestoLink')} →
          </Link>
        </Reveal>

        <div>
          <ScrollText
            text={t('home.manifesto')}
            className="g-display text-[clamp(32px,4.4vw,66px)] !leading-[1.08] text-soul-blue"
          />

          {stats.length ? (
            <div className={`mt-16 grid border-y border-soul-line md:mt-24 ${STAT_COLS[stats.length]}`}>
              {stats.map((s, i) => (
                <Reveal
                  key={s.label}
                  delay={i * 120}
                  className={`flex min-w-0 flex-col gap-2 px-3 py-7 sm:gap-3 sm:px-8 sm:py-10 ${
                    i ? 'border-s border-soul-line' : 'ps-0 sm:ps-0'
                  }`}
                >
                  <span className="g-index text-soul-muted">{String(i + 1).padStart(2, '0')}</span>
                  <CountUp value={s.value} className="g-display text-[clamp(44px,7vw,112px)] text-soul-blue" />
                  <span className="text-xs text-soul-muted sm:text-sm">{s.label}</span>
                </Reveal>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function FeaturedRail({ items, loading }) {
  const { t } = useLocale();
  const railRef = useRef(null);
  const [progress, setProgress] = useState(0);

  const onScroll = () => {
    const el = railRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setProgress(max > 0 ? Math.abs(el.scrollLeft) / max : 0);
  };

  const scrollBy = (dir) => {
    const el = railRef.current;
    if (!el) return;
    const rtl = document.documentElement.dir === 'rtl';
    el.scrollBy({ left: dir * (rtl ? -1 : 1) * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  return (
    <section className="g-guides bg-soul-paper py-24 md:py-32">
      <div className="g-shell">
        <SectionHead
          index="03"
          eyebrow={t('home.collection')}
          lead={t('home.featuredLead')}
          em={t('home.featuredEm')}
          action={
            <div className="flex items-center gap-3">
              <Link to="/search" className="g-btn g-btn-ghost">
                {t('home.viewAll')}
              </Link>
              <button
                type="button"
                onClick={() => scrollBy(-1)}
                className="grid h-12 w-12 place-items-center rounded-full border border-soul-blue/20 text-soul-blue transition-colors hover:bg-soul-blue hover:text-white"
                aria-label={t('home.prevProjects')}
              >
                <ArrowLeft size={18} className="rtl:rotate-180" />
              </button>
              <button
                type="button"
                onClick={() => scrollBy(1)}
                className="grid h-12 w-12 place-items-center rounded-full border border-soul-blue/20 text-soul-blue transition-colors hover:bg-soul-blue hover:text-white"
                aria-label={t('home.nextProjects')}
              >
                <ArrowRight size={18} className="rtl:rotate-180" />
              </button>
            </div>
          }
        />
      </div>

      <div ref={railRef} onScroll={onScroll} className="g-rail mt-14 pb-2 md:mt-16">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="w-[82%] shrink-0 sm:w-[46%] lg:w-[31%] xl:w-[23.5%]">
                <ListingCardSkeleton />
              </div>
            ))
          : items.map((u, i) => (
              <Reveal
                key={u.id}
                delay={Math.min(i, 4) * 90}
                className="w-[82%] shrink-0 sm:w-[46%] lg:w-[31%] xl:w-[23.5%]"
              >
                <ListingCard listing={u} priority={i < 4} />
              </Reveal>
            ))}
        {!loading && !items.length ? (
          <p className="text-soul-muted">{t('home.featuredEmpty')}</p>
        ) : null}
      </div>

      {!loading && items.length > 1 ? (
        <div className="g-shell mt-10">
          <div className="relative h-px w-full bg-soul-line">
            <span
              className="absolute inset-y-0 start-0 bg-soul-blue transition-[width] duration-300"
              style={{ width: `${Math.max(12, progress * 100)}%` }}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Interlude() {
  const { t } = useLocale();
  const ref = useRef(null);
  const imgRef = useRef(null);

  useEffect(() => {
    const el = ref.current;
    const img = imgRef.current;
    if (!el || !img) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const p = (vh - rect.top) / (vh + rect.height);
      const clamped = Math.min(1, Math.max(0, p));
      img.style.transform = `translate3d(0, ${(clamped - 0.5) * -18}%, 0) scale(1.25)`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section ref={ref} className="g-grain relative isolate flex min-h-[86svh] items-center overflow-hidden bg-soul-ink text-white">
      <img
        ref={imgRef}
        src="/soul-v2/interlude.jpg"
        alt=""
        loading="lazy"
        className="absolute inset-0 -z-10 h-full w-full scale-125 object-cover will-change-transform"
        onError={(e) => {
          e.currentTarget.src = '/soul-brand/coast-hero-3.jpg';
        }}
      />
      <div className="absolute inset-0 -z-10 bg-soul-ink/45" />
      <div className="g-shell relative z-[2] w-full text-center">
        <Reveal className="mb-8 flex items-center justify-center gap-3 text-white/70">
          <span className="h-px w-10 bg-white/30" />
          <span className="g-index">{t('home.regions')}</span>
          <span className="h-px w-10 bg-white/30" />
        </Reveal>
        <RevealLines
          className="g-display mx-auto text-[clamp(56px,10vw,168px)] !leading-[0.88]"
          lines={[t('home.interludeLead'), <em key="em">{t('home.interludeEm')}</em>]}
        />
      </div>
    </section>
  );
}

export default function HomePage() {
  const [featured, setFeatured] = useState([]);
  const [loading, setLoading] = useState(true);
  const [homes, setHomes] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/units', { params: { status: 'published', listing_type: 'rent', limit: 1 } })
      .then((r) => {
        if (!cancelled) setHomes(Number(r.data?.total) || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    api
      .get('/units', { params: { featured: 'true', status: 'published', limit: 8 } })
      .then(async (featRes) => {
        if (cancelled) return;
        let items = featRes.data.items || [];
        if (!items.length) {
          const fallback = await api.get('/units', {
            params: { status: 'published', limit: 8 },
          });
          if (cancelled) return;
          items = fallback.data.items || [];
        }
        setFeatured(items);
      })
      .catch(() => {
        if (!cancelled) setFeatured([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bg-soul-paper">
      <IntroCurtain />
      <Header overHero />
      <Hero homes={homes} />
      <PartnersSection variant="strip" />
      <Manifesto homes={homes} />
      <CompoundGrid index="02" limit={8} />
      <ProjectMarquee />
      <FeaturedRail items={featured} loading={loading} />
      <TrustSection />
      <Interlude />
      <HostCta />
      <Footer />
    </div>
  );
}
