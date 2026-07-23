import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import HeroSearch from '../components/home/HeroSearch';
import CompoundGrid from '../components/home/CompoundGrid';
import TrustSection from '../components/home/TrustSection';
import HostCta from '../components/home/HostCta';
import PartnersSection from '../components/home/PartnersSection';
import ListingCard, { ListingCardSkeleton } from '../components/ListingCard';
import api from '../api/http';
import { brand } from '../theme/brand';
import { useLocale } from '../context/LocaleContext';

const HERO_IMAGES = [
  '/soul-brand/coast-hero-2.jpg',
  '/soul-brand/coast-hero-1.jpg',
  '/soul-brand/coast-hero-3.jpg',
];

export default function HomePage() {
  const { t } = useLocale();
  const [heroIndex, setHeroIndex] = useState(0);
  const [featured, setFeatured] = useState([]);
  const [loading, setLoading] = useState(true);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setHeroIndex((i) => (i + 1) % HERO_IMAGES.length), 8000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      api.get('/units', { params: { featured: 'true', status: 'published', limit: 8 } }),
    ])
      .then(async ([featRes]) => {
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
    <div className={`bg-white ${entered ? 'soul-fade-in' : 'opacity-0'}`}>
      <Header overHero />

      {/* Hero */}
      <section className="relative isolate flex min-h-[100svh] flex-col justify-center overflow-x-clip overflow-y-visible">
        <div className={`pointer-events-none absolute inset-0 overflow-hidden ${entered ? 'soul-fade-in' : 'opacity-0'}`}>
          {HERO_IMAGES.map((src, i) => (
            <img
              key={src}
              src={src}
              alt=""
              fetchPriority={i === 0 ? 'high' : 'low'}
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[1600ms] ${
                i === heroIndex ? 'opacity-100' : 'opacity-0'
              }`}
            />
          ))}
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute inset-0 bg-gradient-to-t from-soul-ink/50 via-transparent to-soul-ink/20" />
        </div>

        <div className="relative z-10 mx-auto flex w-full max-w-soul flex-col gap-10 px-5 py-28 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
          <div
            className={`min-w-0 flex-1 ${entered ? 'soul-fade-up' : 'opacity-0'}`}
            style={{ animationDelay: '0.18s' }}
          >
            <p className="soul-eyebrow mb-4 text-white/70">
              {brand.name}
            </p>
            <h1
              className="font-display font-normal leading-[0.95] text-white max-w-3xl"
              style={{ fontSize: 'clamp(42px, 8vw, 96px)' }}
            >
              <span className="font-light">{t('home.heroTitleLight')}</span>{' '}
              <em className="italic font-normal">{t('home.heroTitleEm')}</em>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-white/85 md:text-lg">
              {t('home.heroSubtitle')}
            </p>

            <div className="mt-8 flex flex-wrap gap-6 border-t border-white/15 pt-6 text-sm text-white/75">
              <span>{t('home.heroPhrase1')}</span>
              <span>{t('home.heroPhrase2')}</span>
              <span>{t('home.regions')}</span>
            </div>
          </div>

          <div
            className={`relative z-20 w-full shrink-0 md:ms-auto md:w-[460px] md:max-w-[460px] lg:translate-x-2 rtl:lg:-translate-x-2 ${entered ? 'soul-fade-up' : 'opacity-0'}`}
            style={{ animationDelay: '0.38s' }}
          >
            <HeroSearch />
          </div>
        </div>
      </section>

      <div className={entered ? 'soul-fade-up' : 'opacity-0'} style={{ animationDelay: '0.55s' }}>
        <CompoundGrid />
      </div>

      {/* Featured listings */}
      <section className="mx-auto max-w-soul px-5 sm:px-8 py-4 md:py-8 pb-16 md:pb-20">
        <div className="flex items-end justify-between gap-4 mb-8">
          <div>
            <p className="soul-eyebrow text-soul-muted mb-2">{t('home.collection')}</p>
            <h2 className="font-display text-3xl md:text-4xl text-soul-blue">
              {t('home.featuredTitle')}
            </h2>
          </div>
          <Link to="/search" className="text-sm font-semibold text-soul-blue shrink-0">
            {t('home.viewAll')}
          </Link>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {loading &&
            Array.from({ length: 4 }).map((_, i) => <ListingCardSkeleton key={i} />)}
          {!loading &&
            featured.map((u, i) => (
              <ListingCard key={u.id} listing={u} priority={i < 4} />
            ))}
          {!loading && !featured.length && (
            <p className="text-soul-muted col-span-full">
              {t('home.featuredEmpty')}
            </p>
          )}
        </div>
      </section>

      <TrustSection />
      <PartnersSection className="border-t border-soul-line bg-soul-ivory/50" />
      <HostCta />
      <Footer />
    </div>
  );
}
