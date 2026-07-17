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

const HERO_IMAGES = [
  '/soul-brand/coast-hero-2.jpg',
  '/soul-brand/coast-hero-1.jpg',
  '/soul-brand/coast-hero-3.jpg',
];

export default function HomePage() {
  const [heroIndex, setHeroIndex] = useState(0);
  const [featured, setFeatured] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [compoundCounts, setCompoundCounts] = useState({});
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
      api.get('/units', { params: { status: 'published', limit: 100 } }),
      api.get('/units/compounds').catch(() => ({ data: { items: [] } })),
    ])
      .then(([featRes, allRes, compoundsRes]) => {
        if (cancelled) return;
        let items = featRes.data.items || [];
        if (!items.length) {
          items = (allRes.data.items || []).slice(0, 8);
        }
        setFeatured(items);
        setTotal(allRes.data.total ?? items.length);

        const counts = {};
        for (const row of compoundsRes.data.items || []) {
          counts[row.name] = row.listings;
        }
        // Fallback: count from listings payload
        if (!Object.keys(counts).length) {
          for (const u of allRes.data.items || []) {
            if (!u.compound) continue;
            counts[u.compound] = (counts[u.compound] || 0) + 1;
          }
        }
        setCompoundCounts(counts);
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
              <span className="font-light">Experience coastal</span>{' '}
              <em className="italic font-normal">luxury.</em>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-white/85 md:text-lg">
              Hand-picked homes along Egypt&apos;s most beautiful coastlines — Fouka Bay, Gaia,
              Hacienda West, Marassi and Ain Sokhna.
            </p>

            <div className="mt-8 flex flex-wrap gap-6 border-t border-white/15 pt-6 text-sm text-white/75">
              <span>
                <strong className="text-white">{total || '—'}</strong> homes to call yours
              </span>
              <span>5 coastal destinations</span>
              <span>North Coast &amp; Red Sea</span>
            </div>
          </div>

          <div
            className={`relative z-20 w-full shrink-0 md:ml-auto md:w-[460px] md:max-w-[460px] lg:translate-x-2 ${entered ? 'soul-fade-up' : 'opacity-0'}`}
            style={{ animationDelay: '0.38s' }}
          >
            <HeroSearch />
          </div>
        </div>
      </section>

      <div className={entered ? 'soul-fade-up' : 'opacity-0'} style={{ animationDelay: '0.55s' }}>
        <CompoundGrid counts={compoundCounts} />
      </div>

      {/* Featured listings */}
      <section className="mx-auto max-w-soul px-5 sm:px-8 py-4 md:py-8 pb-16 md:pb-20">
        <div className="flex items-end justify-between gap-4 mb-8">
          <div>
            <p className="soul-eyebrow text-soul-muted mb-2">Collection</p>
            <h2 className="font-display text-3xl md:text-4xl text-soul-blue">
              Stays guests <em className="italic font-normal">return</em> to
            </h2>
          </div>
          <Link to="/search" className="text-sm font-semibold text-soul-blue shrink-0">
            View all
          </Link>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {loading &&
            Array.from({ length: 4 }).map((_, i) => <ListingCardSkeleton key={i} />)}
          {!loading &&
            featured.map((u) => <ListingCard key={u.id} listing={u} />)}
          {!loading && !featured.length && (
            <p className="text-soul-muted col-span-full">
              Featured homes will appear here once published units are available.
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
