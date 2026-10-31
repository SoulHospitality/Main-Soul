import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import HeroSearch from '../components/home/HeroSearch';
import HeroWaves from '../components/home/HeroWaves';
import HeroSlideshow, { SlideDots } from '../components/home/HeroSlideshow';
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
import { useSiteContent } from '../hooks/useSiteContent';

const STAT_COLS = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' };
const INTRO_KEY = 'soul-intro-seen';
const DEFAULT_SLIDES = [1, 2, 3].map((n) => ({ src: `/soul-brand/coast-hero-${n}.jpg` }));

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
        <div className="g-display g-intro__words text-[clamp(48px,8vw,112px)]">
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
function Hero() {
  const { t } = useLocale();
  const { content, pick } = useSiteContent();
  const capsuleRef = useRef(null);
  const hero = content.hero || {};
  const slideshow = hero.mode === 'slideshow';
  const slides = useMemo(() => {
    const own = (hero.slides || []).filter((s) => s?.src).slice(0, 4);
    return own.length ? own : DEFAULT_SLIDES;
  }, [hero.slides]);
  const [index, setIndex] = useState(0);
  const [advanced, setAdvanced] = useState(false);
  const goTo = useCallback((i) => {
    setAdvanced(true);
    setIndex(i);
  }, []);
  const active = slideshow ? slides[Math.min(index, slides.length - 1)] : null;

  // A slide's own headline wins; otherwise the hero-level text, then the built-in copy.
  const titleLight = pick(active, 'title_light') || pick(hero, 'title_light') || t('home.heroTitleLight');
  const titleEm = pick(active, 'title_em') || pick(hero, 'title_em') || t('home.heroTitleEm');
  const subtitle = slideshow ? pick(active, 'subtitle') : pick(hero, 'subtitle');
  const headingClass =
    'g-display mx-auto max-w-5xl text-center text-[clamp(40px,5.6vw,92px)] !leading-[0.9] [text-shadow:0_2px_28px_rgba(0,0,0,0.45)]';

  return (
    <section className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-[#0b4a56] text-white">
      {slideshow ? (
        <HeroSlideshow slides={slides} index={Math.min(index, slides.length - 1)} onChange={goTo} />
      ) : (
        <HeroWaves videoUrl={hero.video_url} />
      )}

      <div className="g-shell relative z-[2] flex w-full flex-1 flex-col items-center justify-center pb-24 pt-28 text-center sm:pb-12">
        {advanced ? (
          <div key={index} className="soul-fade-up">
            <h1 className={headingClass}>
              <span className="block">{titleLight}</span>
              <em className="block">{titleEm}</em>
            </h1>
          </div>
        ) : (
          <RevealLines
            as="h1"
            immediate
            delay={250}
            className={headingClass}
            lines={[
              <span key="l">{titleLight}</span>,
              <em key="e">{titleEm}</em>,
            ]}
          />
        )}
        {subtitle ? (
          <p
            key={`sub-${slideshow ? index : 'v'}`}
            className="soul-fade-up mx-auto mt-5 max-w-2xl text-base text-white/85 [text-shadow:0_1px_14px_rgba(0,0,0,0.45)] sm:text-lg"
            style={{ animationDelay: advanced ? '0.1s' : '0.6s' }}
          >
            {subtitle}
          </p>
        ) : null}
        <div className="soul-fade-up mt-8 flex justify-center" style={{ animationDelay: '0.75s' }}>
          <Link to="/search" className="g-btn g-btn-glass !border-white/15 !bg-white/[0.07] backdrop-blur-md hover:!border-white/30 hover:!bg-white/15">
            {t('home.heroExplore')}
            <ArrowDot />
          </Link>
        </div>

        <div className="soul-fade-up mt-8 w-full md:mt-10" style={{ animationDelay: '0.95s' }}>
          <HeroSearch ref={capsuleRef} />
        </div>

        {slideshow ? (
          <div className="mt-8">
            <SlideDots count={slides.length} index={Math.min(index, slides.length - 1)} onChange={goTo} label={t('home.heroSlide')} />
          </div>
        ) : null}

        <div className="mt-8 hidden items-center justify-center gap-3 text-white/80 sm:flex">
          <span className="g-index">{t('home.heroScroll')}</span>
          <span className="relative h-10 w-px overflow-hidden bg-white/20">
            <span className="g-scroll-cue absolute inset-0 bg-white" />
          </span>
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
            <span className="text-2xl text-soul-blue/30">✦</span>
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
            <span className="g-index">(05)</span>
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
            className="g-statement text-[clamp(30px,4vw,60px)] !leading-[1.1] text-soul-blue"
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
          index="02"
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
  const { content, pick } = useSiteContent();
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
        src={content.interlude?.image || '/soul-v2/interlude.jpg'}
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
          lines={[
            pick(content.interlude, 'lead') || t('home.interludeLead'),
            <em key="em">{pick(content.interlude, 'em') || t('home.interludeEm')}</em>,
          ]}
        />
      </div>
    </section>
  );
}

export default function HomePage() {
  const { content, sectionOn } = useSiteContent();
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
      <Hero />
      {sectionOn('compounds') ? <CompoundGrid index="01" limit={8} /> : null}
      {sectionOn('marquee') ? <ProjectMarquee /> : null}
      {sectionOn('featured') ? <FeaturedRail items={featured} loading={loading} /> : null}
      {sectionOn('trust') ? <TrustSection /> : null}
      {sectionOn('interlude') ? <Interlude /> : null}
      {sectionOn('host') ? <HostCta /> : null}
      {sectionOn('manifesto') ? <Manifesto homes={homes} /> : null}
      {sectionOn('partners') ? (
        <PartnersSection variant="strip" partners={content.partners?.length ? content.partners : undefined} className="border-t" />
      ) : null}
      <Footer />
    </div>
  );
}
