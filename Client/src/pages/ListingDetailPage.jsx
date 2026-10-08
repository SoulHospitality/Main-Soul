import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import ListingCard from '../components/ListingCard';
import ListingBookingCard from '../components/listing/ListingBookingCard';
import ListingLongTermCard from '../components/listing/ListingLongTermCard';
import AddReviewForm from '../components/reviews/AddReviewForm';
import UnitReviewsDisplay from '../components/reviews/UnitReviewsDisplay';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import api, { createUnitReview, fetchUnitReviews } from '../api/http';
import { optimizeImageUrl } from '../utils/imageUrl';
import { GUEST_AVAILABILITY_MONTHS } from '../constants/availability';
import BrandLoader from '../components/ui/BrandLoader';
import { Reveal, SectionHead } from '../components/ui/Editorial';
import { LayoutGrid, X } from 'lucide-react';

const localISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const isLongTermUnit = (unit) => String(unit?.listing_type || 'rent').toLowerCase() === 'long_term';

function parseFacilities(unit) {
  if (Array.isArray(unit?.facilities) && unit.facilities.length) return unit.facilities;
  if (!unit?.other_details) return [];
  try {
    const parsed = typeof unit.other_details === 'string' ? JSON.parse(unit.other_details) : unit.other_details;
    return Array.isArray(parsed?.facilities) ? parsed.facilities : [];
  } catch {
    return [];
  }
}

function CheckIcon() {
  return (
    <span className="grid h-6 w-6 flex-none place-items-center rounded-full border border-soul-line text-soul-blue">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </span>
  );
}

function Spec({ num, label, first }) {
  return (
    <div className={`flex flex-col gap-2 py-6 ${first ? '' : 'border-s border-soul-line ps-5 sm:ps-8'}`}>
      <span className="g-index text-soul-muted">{label}</span>
      <span className="g-display text-[clamp(44px,5vw,68px)] text-soul-blue">{num}</span>
    </div>
  );
}

function SectionTitle({ n, children }) {
  return (
    <div className="mb-7 flex items-baseline gap-4">
      <span className="g-index text-soul-muted">{n}</span>
      <h2 className="g-display text-[clamp(32px,3.4vw,48px)] text-soul-blue">{children}</h2>
    </div>
  );
}

function ExpandableText({ text, limit = 320 }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const needs = text.length > limit;
  const shown = !needs || open ? text : `${text.slice(0, limit).trim()}…`;
  return (
    <div>
      <p className="m-0 whitespace-pre-line text-[16px] leading-[1.8] text-soul-blue/85">{shown}</p>
      {needs && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="g-link mt-4 text-sm font-semibold text-soul-blue"
        >
          {open ? t('listing.showLess') : t('listing.readMore')}
        </button>
      )}
    </div>
  );
}

const GUEST_REGULATION_KEYS = [
  'listing.reg0',
  'listing.reg1',
  'listing.reg2',
  'listing.reg3',
  'listing.reg4',
];

export default function ListingDetailPage() {
  const { t } = useLocale();
  const { slug } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [unit, setUnit] = useState(null);
  const [blocked, setBlocked] = useState([]);
  const [checkoutDates, setCheckoutDates] = useState([]);
  const [prices, setPrices] = useState({});
  const [similar, setSimilar] = useState([]);
  const [lightbox, setLightbox] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewMessage, setReviewMessage] = useState('');
  const [reviewMessageOk, setReviewMessageOk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUnit(null);
    setNotFound(false);

    api
      .get(`/units/${slug}`)
      .then((r) => {
        if (!cancelled) setUnit(r.data);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (!unit) return undefined;
    let cancelled = false;
    const from = localISO(new Date());
    const toDate = new Date();
    toDate.setMonth(toDate.getMonth() + GUEST_AVAILABILITY_MONTHS);
    const to = localISO(toDate);

    api
      .get(`/units/${slug}/availability`, { params: { from, to } })
      .then((r) => {
        if (!cancelled) {
          const nights = (r.data.blocked || []).map((b) => b.date);
          const occupied = new Set(nights);
          const turnover = (r.data.checkout_dates || []).filter((d) => !occupied.has(d));
          setCheckoutDates(turnover);
          setBlocked(nights);
        }
      })
      .catch(() => {});

    if (!isLongTermUnit(unit)) {
      api
        .get(`/units/${slug}/pricing`, { params: { from, to } })
        .then((r) => {
          if (!cancelled) setPrices(r.data.prices || {});
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [slug, unit]);

  useEffect(() => {
    if (!unit) return undefined;
    let cancelled = false;
    const listingType = isLongTermUnit(unit) ? 'long_term' : 'rent';
    api
      .get('/units', {
        params: {
          status: 'published',
          compound: unit.compound || undefined,
          listing_type: listingType,
          limit: 6,
        },
      })
      .then((r) => {
        if (cancelled) return;
        const items = (r.data.items || []).filter((u) => u.slug !== unit.slug).slice(0, 3);
        setSimilar(items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [unit]);

  useEffect(() => {
    if (!unit?.id && !unit?.slug) return undefined;
    if (isLongTermUnit(unit)) return undefined;
    let cancelled = false;
    setReviewsLoading(true);
    setReviewsError('');
    fetchUnitReviews(unit.slug || unit.id)
      .then((data) => {
        if (cancelled) return;
        setReviews(data.items || []);
        setUnit((current) =>
          current
            ? {
                ...current,
                average_rating: data.average_rating ?? current.average_rating,
                review_count: data.review_count ?? current.review_count,
              }
            : current
        );
      })
      .catch(() => {
        if (!cancelled) setReviewsError(t('listing.loadReviewsFailed'));
      })
      .finally(() => {
        if (!cancelled) setReviewsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [unit?.id, unit?.slug]);

  const handleReviewSubmit = async ({ rating, comment }) => {
    if (!unit) return false;
    setReviewSubmitting(true);
    setReviewMessage('');
    try {
      const guestName =
        user?.full_name || user?.fullName || user?.user_metadata?.full_name || user?.email || t('common.guest');
      const data = await createUnitReview(unit.id || unit.slug, { rating, comment, guestName });
      if (data.review) {
        setReviews((prev) => [data.review, ...prev]);
      }
      setUnit((current) =>
        current
          ? {
              ...current,
              average_rating: data.average_rating ?? current.average_rating,
              review_count: data.review_count ?? current.review_count,
            }
          : current
      );
      setReviewMessageOk(true);
      setReviewMessage(t('listing.thanksReview'));
      return true;
    } catch (err) {
      setReviewMessageOk(false);
      setReviewMessage(err.response?.data?.error || t('listing.postFailed'));
      return false;
    } finally {
      setReviewSubmitting(false);
    }
  };

  const photos = useMemo(() => {
    if (!unit) return [];
    const list = [];
    if (unit.cover_url) list.push(unit.cover_url);
    for (const url of unit.photo_urls || []) {
      if (url && !list.includes(url)) list.push(url);
    }
    return list.map((url, i) => optimizeImageUrl(url, { width: i === 0 ? 1400 : 800 }));
  }, [unit]);

  const facilities = useMemo(() => (unit ? parseFacilities(unit) : []), [unit]);
  const amenities = unit?.amenities || [];

  const locationParts = useMemo(() => {
    if (!unit) return [];
    return [...new Map(
      [unit.compound, unit.area, unit.city]
        .filter((p) => p && String(p).trim())
        .map((p) => [String(p).trim().toLowerCase(), String(p).trim()])
    ).values()];
  }, [unit]);

  const description = unit?.the_property || unit?.short_description || '';

  if (notFound) {
    return (
      <div className="bg-soul-paper">
        <Header />
        <main className="g-shell py-24 text-center md:py-32">
          <span className="g-index text-soul-muted">(404)</span>
          <h1 className="g-display mx-auto mt-5 max-w-3xl text-[clamp(44px,6vw,88px)] text-soul-blue">{t('listing.notFound')}</h1>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link to="/search" className="g-btn g-btn-primary">
              {t('listing.browseStays')}
            </Link>
            <Link to="/long-term" className="g-btn g-btn-ghost">
              {t('listing.browseLongTerm')}
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!unit) {
    return (
      <div className="bg-soul-paper">
        <Header />
        <BrandLoader fullPage size="lg" label={t('listing.loading')} />
        <Footer />
      </div>
    );
  }

  const isLongTerm = isLongTermUnit(unit);
  const browsePath = isLongTerm ? '/long-term' : '/search';
  const sizeM2 = Number(unit.size_m2 || unit.unit_area || 0);

  const detailRows = [
    { label: t('listing.specGuests'), value: String(unit.guests || '—') },
    { label: t('listing.specBedrooms'), value: String(unit.beds ?? '—') },
    { label: t('listing.specBaths'), value: String(unit.baths ?? '—') },
    ...(isLongTerm && sizeM2 > 0 ? [{ label: t('listing.specArea'), value: `${sizeM2} m²` }] : []),
    { label: t('listing.specCheckIn'), value: t('listing.specCheckInValue') },
    { label: t('listing.specCheckOut'), value: t('listing.specCheckOutValue') },
    ...(unit.property_type ? [{ label: t('listing.specPropertyType'), value: unit.property_type }] : []),
  ];

  return (
    <div className="bg-soul-paper">
      <Header />
      <main id="main">
        <div className="g-shell">
          <div className="g-noscrollbar flex items-center gap-2 overflow-x-auto whitespace-nowrap py-4 text-soul-muted">
            <Link to="/" className="g-index g-link hover:text-soul-blue">
              {t('listing.egypt')}
            </Link>
            {locationParts
              .filter((part) => part.toLowerCase() !== String(t('listing.egypt')).toLowerCase())
              .map((part) => (
              <span key={part} className="flex items-center gap-2">
                <span className="g-index opacity-50">/</span>
                <Link to={`${browsePath}?area=${encodeURIComponent(part)}`} className="g-index g-link hover:text-soul-blue">
                  {part}
                </Link>
              </span>
            ))}
            <span className="g-index opacity-50">/</span>
            <span className="g-index truncate text-soul-blue">{unit.title}</span>
          </div>

          <div className="mb-8 mt-4 grid gap-6 md:mb-10 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="min-w-0">
              {locationParts[0] && (
                <p className="soul-fade-up mb-4 flex items-center gap-3 text-soul-muted">
                  <span className="g-dot" />
                  <span className="g-index">
                    {isLongTerm ? t('listing.longTermIn', { place: locationParts[0] }) : locationParts[0]}
                  </span>
                </p>
              )}
              <h1 className="g-display soul-fade-up text-[clamp(34px,4.2vw,64px)] text-soul-blue" style={{ animationDelay: '0.08s' }}>
                {unit.title}
              </h1>
            </div>
            <div className="soul-fade-up flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-soul-muted lg:justify-end" style={{ animationDelay: '0.16s' }}>
              <span>
                <strong className="font-semibold text-soul-blue">{locationParts[0] || t('listing.egypt')}</strong>
                {locationParts.length > 1 ? `, ${locationParts.slice(1).join(', ')}` : ''}
              </span>
              {!isLongTerm && Number(unit.review_count || 0) > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-soul-line bg-white px-3 py-1.5">
                  <span className="font-num font-semibold text-soul-blue">★ {Number(unit.average_rating || 0).toFixed(1)}</span>
                  <span>· {t('listing.reviewCount', { count: unit.review_count })}</span>
                </span>
              ) : null}
            </div>
          </div>

          {photos.length > 0 ? (
            <div className="soul-fade-up relative mb-10" style={{ animationDelay: '0.22s' }}>
              <div className="hidden grid-cols-[2fr_1fr_1fr] grid-rows-[270px_270px] gap-2.5 overflow-hidden rounded-[32px] md:grid">
                <button
                  type="button"
                  onClick={() => setLightbox(true)}
                  className="g-zoom relative overflow-hidden bg-soul-sand md:row-span-2"
                >
                  <img
                    src={photos[0]}
                    alt={unit.title}
                    fetchPriority="high"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </button>
                {photos.slice(1, 5).map((p, i) => (
                  <button
                    type="button"
                    key={p}
                    onClick={() => setLightbox(true)}
                    className="g-zoom relative overflow-hidden bg-soul-sand"
                  >
                    <img
                      src={p}
                      alt={t('listing.photoAlt', { title: unit.title, n: i + 2 })}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>

              <div className="g-noscrollbar -mx-5 flex snap-x snap-mandatory gap-2.5 overflow-x-auto scroll-smooth px-5 pb-1 md:hidden">
                {photos.slice(0, 8).map((p, i) => (
                  <div
                    key={p}
                    className="relative aspect-[4/3.4] w-[86%] flex-none snap-start overflow-hidden rounded-[24px] bg-soul-sand"
                  >
                    <img
                      src={p}
                      alt={i === 0 ? unit.title : t('listing.photoAlt', { title: unit.title, n: i + 1 })}
                      loading={i === 0 ? 'eager' : 'lazy'}
                      decoding="async"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setLightbox(true)}
                className="absolute bottom-5 end-5 inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/85 px-4 py-2.5 text-[13px] font-semibold text-soul-blue shadow-[0_12px_30px_-12px_rgba(12,36,64,0.45)] backdrop-blur-md transition hover:bg-white"
              >
                <LayoutGrid size={15} />
                {t('listing.showAllPhotos', { count: photos.length })}
              </button>
            </div>
          ) : (
            <div className="mb-10 flex aspect-[16/9] items-center justify-center rounded-[32px] bg-soul-sand text-soul-muted">
              {t('listing.noPhotos')}
            </div>
          )}

          <nav className="sticky top-[88px] z-30 mb-10 hidden md:block">
            <div className="inline-flex gap-1 rounded-full border border-soul-line bg-white/80 p-1 text-[13px] font-medium text-soul-muted shadow-[0_12px_30px_-20px_rgba(15,44,77,0.35)] backdrop-blur-xl">
              {[
                { href: '#about', label: t('listing.description') },
                { href: '#details', label: t('listing.details') },
                { href: '#features', label: t('listing.amenitiesHeading') },
                ...(!isLongTerm
                  ? [
                      { href: '#reviews', label: t('listing.reviews') },
                      { href: '#rules', label: t('listing.houseRules') },
                    ]
                  : []),
              ].map((tab) => (
                <a
                  key={tab.href}
                  href={tab.href}
                  className="rounded-full px-4 py-2 transition-colors hover:bg-soul-blue-50 hover:text-soul-blue"
                >
                  {tab.label}
                </a>
              ))}
            </div>
          </nav>

          <div className="grid grid-cols-1 gap-12 pb-[120px] md:grid-cols-[1fr_380px] md:pb-20 lg:gap-20">
            <div className="min-w-0">
              <section className="mb-12 grid grid-cols-3 border-y border-soul-line">
                <Spec first num={String(unit.guests || '—')} label={t('listing.specGuests')} />
                <Spec num={String(unit.beds ?? '—')} label={t('listing.specBedrooms')} />
                <Spec num={String(unit.baths ?? '—')} label={t('listing.specBaths')} />
              </section>

              <section id="about" className="mb-14 scroll-mt-[150px]">
                <SectionTitle n="01">{t('listing.description')}</SectionTitle>
                <ExpandableText text={description} />
              </section>

              <section id="details" className="mb-14 scroll-mt-[150px]">
                <SectionTitle n="02">{t('listing.details')}</SectionTitle>
                <dl className="grid grid-cols-1 gap-x-12 border-t border-soul-line sm:grid-cols-2">
                  {detailRows.map((r) => (
                    <div
                      key={r.label}
                      className="flex justify-between gap-4 border-b border-soul-line py-3.5 text-[15px]"
                    >
                      <dt className="text-soul-muted">{r.label}</dt>
                      <dd className="m-0 text-end font-medium text-soul-blue">{r.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section id="features" className="mb-14 scroll-mt-[150px]">
                <SectionTitle n="03">{t('listing.features')}</SectionTitle>

                {!!amenities.length && (
                  <>
                    <h3 className="g-index mb-4 text-soul-muted">{t('listing.amenitiesHeading')}</h3>
                    <div className="mb-10 grid grid-cols-1 gap-x-12 border-t border-soul-line sm:grid-cols-2">
                      {amenities.map((a) => (
                        <div key={a} className="flex items-center gap-3 border-b border-soul-line py-3.5 text-[15px] text-soul-blue">
                          <CheckIcon />
                          {a}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {!!facilities.length && (
                  <>
                    <h3 className="g-index mb-4 text-soul-muted">{t('listing.facilities')}</h3>
                    <div className="grid grid-cols-1 gap-x-12 border-t border-soul-line sm:grid-cols-2">
                      {facilities.map((f) => (
                        <div key={f} className="flex items-center gap-3 border-b border-soul-line py-3.5 text-[15px] text-soul-blue">
                          <CheckIcon />
                          {f}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {!amenities.length && !facilities.length && (
                  <p className="text-sm text-soul-muted m-0">{t('listing.amenitiesEmpty')}</p>
                )}
              </section>

              {!isLongTerm && (
              <section id="reviews" className="mb-14 scroll-mt-[150px]">
                <SectionTitle n="04">{t('listing.reviews')}</SectionTitle>
                <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
                  <div className="space-y-3">
                    {user ? (
                      <AddReviewForm onSubmit={handleReviewSubmit} submitting={reviewSubmitting} />
                    ) : (
                      <div className="rounded-[24px] border border-soul-line bg-white p-6">
                        <p className="text-sm leading-relaxed text-soul-blue">
                          {t('listing.signInReviewPrefix')}{' '}
                          <Link to="/sign-in" className="g-link font-semibold">
                            {t('listing.signIn')}
                          </Link>{' '}
                          {t('listing.signInReviewSuffix')}
                        </p>
                      </div>
                    )}
                    {reviewMessage ? (
                      <p className={`text-sm ${reviewMessageOk ? 'text-emerald-700' : 'text-red-600'}`}>
                        {reviewMessage}
                      </p>
                    ) : null}
                  </div>
                  <UnitReviewsDisplay
                    reviews={reviews}
                    unitAverageRating={unit.average_rating}
                    unitReviewCount={unit.review_count}
                    loading={reviewsLoading}
                    error={reviewsError}
                  />
                </div>
              </section>
              )}

              {!isLongTerm && (
                <section id="rules" className="mb-14 grid scroll-mt-[150px] gap-12 sm:grid-cols-2">
                  <div>
                    <SectionTitle n="05">{t('listing.houseRules')}</SectionTitle>
                    <ul className="m-0 list-none border-t border-soul-line p-0 text-[15px] text-soul-blue">
                      {[
                        t('listing.checkInAfter'),
                        t('listing.checkOutBefore'),
                        t('listing.noSmoking'),
                        t('listing.noParties'),
                        t('listing.guestsMax', { count: unit.guests || 8 }),
                      ].map((rule) => (
                        <li key={rule} className="flex items-center gap-3 border-b border-soul-line py-3.5">
                          <CheckIcon /> {rule}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <SectionTitle n="06">{t('listing.guestRegulations')}</SectionTitle>
                    <ul className="m-0 list-none border-t border-soul-line p-0 text-[15px] text-soul-blue">
                      {GUEST_REGULATION_KEYS.map((key) => (
                        <li key={key} className="flex items-start gap-3 border-b border-soul-line py-3.5">
                          <CheckIcon />
                          <span>{t(key)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              )}
            </div>

            <aside>
              {isLongTerm ? (
                <ListingLongTermCard
                  unit={unit}
                  blockedDates={blocked}
                  checkoutDates={checkoutDates}
                  initialCheckin={params.get('checkin') || undefined}
                  initialCheckout={params.get('checkout') || undefined}
                />
              ) : (
                <ListingBookingCard
                  unit={unit}
                  blockedDates={blocked}
                  checkoutDates={checkoutDates}
                  dailyPrices={prices}
                  initialCheckin={params.get('checkin') || undefined}
                  initialCheckout={params.get('checkout') || undefined}
                  initialGuests={params.get('guests') ? parseInt(params.get('guests'), 10) : undefined}
                />
              )}
            </aside>
          </div>
        </div>

        {similar.length > 0 && (
          <section className="border-t border-soul-line py-20 md:py-24">
            <div className="g-shell">
              <SectionHead
                eyebrow={unit.compound || locationParts[0]}
                lead={isLongTerm ? t('listing.similarLongTerm') : t('listing.similarRent')}
                titleClassName="text-[clamp(36px,4.4vw,64px)]"
                action={
                  <Link to={browsePath} className="g-btn g-btn-ghost">
                    {t('listing.viewAll')}
                  </Link>
                }
              />
              <div className="mt-12 grid grid-cols-1 gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
                {similar.map((l, i) => (
                  <Reveal key={l.id} delay={i * 90}>
                    <ListingCard
                      listing={l}
                      carryDates={{
                        checkin: params.get('checkin') || undefined,
                        checkout: params.get('checkout') || undefined,
                        guests: params.get('guests') || undefined,
                      }}
                    />
                  </Reveal>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
      <Footer />

      {lightbox && (
        <div
          className="g-menu-in fixed inset-0 z-[230] flex flex-col bg-soul-ink/95 backdrop-blur-xl"
          role="dialog"
          aria-modal="true"
          aria-label={t('listing.allPhotos')}
        >
          <div className="g-shell flex w-full items-center justify-between gap-4 py-5 text-white">
            <div className="min-w-0">
              <span className="g-index text-white/50">{t('listing.allPhotos')} · {photos.length}</span>
              <strong className="g-display mt-1 block truncate text-2xl font-normal sm:text-3xl">{unit.title}</strong>
            </div>
            <button
              type="button"
              onClick={() => setLightbox(false)}
              className="g-btn g-btn-glass !px-4 !py-3"
              aria-label={t('common.close')}
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto pb-12">
            <div className="g-shell columns-1 gap-3 sm:columns-2 [&>img]:mb-3">
              {photos.map((p, i) => (
                <img
                  key={p}
                  src={p}
                  alt={t('listing.photoAlt', { title: unit.title, n: i + 1 })}
                  loading={i < 4 ? 'eager' : 'lazy'}
                  className="w-full break-inside-avoid rounded-[20px]"
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
