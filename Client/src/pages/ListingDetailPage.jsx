import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import ListingCard from '../components/ListingCard';
import ListingBookingCard from '../components/listing/ListingBookingCard';
import AddReviewForm from '../components/reviews/AddReviewForm';
import UnitReviewsDisplay from '../components/reviews/UnitReviewsDisplay';
import { useAuth } from '../context/AuthContext';
import api, { createUnitReview, fetchUnitReviews } from '../api/http';

const localISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const GUEST_REGULATIONS = [
  'Reservations are exclusively open to families. Single-gender groups are permitted for non-Arab guests only.',
  'Arab couples must submit an official marriage certificate prior to booking. Visitors allowed are only of first-degree relatives.',
  'Pets are prohibited (not even really cute ones).',
  'Parties are prohibited.',
  'Please be respectful of your neighbors and keep noise to a minimum from 10:00 PM – 8:00 AM.',
];

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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-none text-soul-blue" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function Spec({ num, label }) {
  return (
    <div className="text-center py-3 border border-soul-line rounded-[14px]">
      <div className="font-num text-[28px] font-semibold leading-none text-soul-blue">{num}</div>
      <div className="text-[12px] text-soul-muted mt-1.5 uppercase tracking-wider font-semibold">{label}</div>
    </div>
  );
}

function ExpandableText({ text, limit = 320 }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const needs = text.length > limit;
  const shown = !needs || open ? text : `${text.slice(0, limit).trim()}…`;
  return (
    <div>
      <p className="text-[15px] text-soul-blue/90 leading-relaxed whitespace-pre-line m-0">{shown}</p>
      {needs && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-2 text-sm font-semibold text-soul-blue underline"
        >
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  );
}

export default function ListingDetailPage() {
  const { slug } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [unit, setUnit] = useState(null);
  const [blocked, setBlocked] = useState([]);
  const [prices, setPrices] = useState({});
  const [similar, setSimilar] = useState([]);
  const [lightbox, setLightbox] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewMessage, setReviewMessage] = useState('');

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

    const from = localISO(new Date());
    const toDate = new Date();
    toDate.setMonth(toDate.getMonth() + 6);
    const to = localISO(toDate);

    api
      .get(`/units/${slug}/availability`, { params: { from, to } })
      .then((r) => {
        if (!cancelled) setBlocked((r.data.blocked || []).map((b) => b.date));
      })
      .catch(() => {});

    api
      .get(`/units/${slug}/pricing`, { params: { from, to } })
      .then((r) => {
        if (!cancelled) setPrices(r.data.prices || {});
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (!unit) return undefined;
    let cancelled = false;
    api
      .get('/units', {
        params: {
          status: 'published',
          compound: unit.compound || undefined,
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
        if (!cancelled) setReviewsError('Unable to load reviews right now.');
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
        user?.full_name || user?.fullName || user?.user_metadata?.full_name || user?.email || 'Guest';
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
      setReviewMessage('Thanks — your review was posted.');
      return true;
    } catch (err) {
      setReviewMessage(err.response?.data?.error || 'Could not post review. Please try again.');
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
    return list;
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
      <div>
        <Header />
        <main className="mx-auto max-w-[1280px] px-6 py-20 text-center">
          <h1 className="font-display text-3xl text-soul-blue mb-3">Listing not found</h1>
          <Link to="/search" className="text-soul-blue font-semibold underline">
            Browse all stays
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  if (!unit) {
    return (
      <div>
        <Header />
        <main className="mx-auto max-w-[1280px] px-6 py-20 text-soul-muted">Loading listing…</main>
        <Footer />
      </div>
    );
  }

  const detailRows = [
    { label: 'Guests', value: String(unit.guests || '—') },
    { label: 'Bedrooms', value: String(unit.beds ?? '—') },
    { label: 'Baths', value: String(unit.baths ?? '—') },
    { label: 'Check-in', value: 'After 3:00 PM' },
    { label: 'Check-out', value: 'Before 11:00 AM' },
    ...(unit.property_type ? [{ label: 'Property type', value: unit.property_type }] : []),
  ];

  return (
    <div>
      <Header />
      <main id="main">
        <div className="max-w-[1280px] mx-auto px-6">
          {/* Breadcrumb */}
          <div className="py-4 text-[13px] text-soul-muted">
            <Link to="/" className="hover:text-soul-blue">
              Egypt
            </Link>
            {locationParts.map((part) => (
              <span key={part}>
                {' · '}
                <Link to={`/search?area=${encodeURIComponent(part)}`} className="hover:text-soul-blue">
                  {part}
                </Link>
              </span>
            ))}
            {' · '}
            <span>{unit.title}</span>
          </div>

          {/* Title */}
          <div className="flex justify-between items-end flex-wrap gap-4 mb-5">
            <div>
              {locationParts[0] && (
                <p className="soul-eyebrow text-soul-teal mb-2.5">{locationParts[0]}</p>
              )}
              <h1 className="font-display text-[clamp(28px,3.5vw,40px)] font-semibold mb-2.5 text-soul-blue">
                {unit.title}
              </h1>
              <div className="text-soul-muted text-sm">
                <strong className="text-soul-blue">{locationParts[0] || 'Egypt'}</strong>
                {locationParts.length > 1 ? `, ${locationParts.slice(1).join(', ')}` : ''}
              </div>
              {Number(unit.review_count || 0) > 0 ? (
                <p className="mt-2 text-sm text-soul-blue">
                  <span className="font-semibold text-amber-600">★ {Number(unit.average_rating || 0).toFixed(1)}</span>
                  <span className="text-soul-muted"> · {unit.review_count} review{Number(unit.review_count) === 1 ? '' : 's'}</span>
                </p>
              ) : null}
            </div>
          </div>

          {/* Gallery */}
          {photos.length > 0 ? (
            <div className="relative mb-8">
              <div className="hidden md:grid grid-cols-[2fr_1fr_1fr] grid-rows-[240px_240px] gap-2 rounded-[22px] overflow-hidden">
                <div className="md:row-span-2 relative bg-soul-ivory/40 overflow-hidden">
                  <img src={photos[0]} alt={unit.title} className="absolute inset-0 w-full h-full object-cover" />
                </div>
                {photos.slice(1, 5).map((p, i) => (
                  <div key={p} className="relative bg-soul-ivory/40 overflow-hidden">
                    <img
                      src={p}
                      alt={`${unit.title}, photo ${i + 2}`}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>

              <div className="md:hidden flex gap-2 overflow-x-auto scrollbar-none scroll-smooth snap-x snap-mandatory rounded-[18px] -mx-6 px-6 pb-1">
                {photos.slice(0, 8).map((p, i) => (
                  <div
                    key={p}
                    className="relative flex-none w-[88%] aspect-[4/3] bg-soul-ivory/40 overflow-hidden rounded-[14px] snap-start"
                  >
                    <img
                      src={p}
                      alt={i === 0 ? unit.title : `${unit.title}, photo ${i + 1}`}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setLightbox(true)}
                className="absolute bottom-4 end-4 bg-white/95 border border-soul-line rounded-full px-4 py-2 text-sm font-semibold text-soul-blue shadow-sm hover:bg-white"
              >
                Show all {photos.length} photos
              </button>
            </div>
          ) : (
            <div className="bg-soul-ivory/50 rounded-[22px] aspect-[16/9] flex items-center justify-center text-soul-muted mb-8">
              No photos yet
            </div>
          )}

          {/* Sub-nav */}
          <nav className="hidden md:block sticky top-[69px] z-30 bg-white/95 backdrop-blur-md border-y border-soul-line mb-8">
            <div className="flex gap-7 text-[14px] font-semibold text-soul-muted">
              <a href="#about" className="py-3 hover:text-soul-blue transition-colors">
                Description
              </a>
              <a href="#details" className="py-3 hover:text-soul-blue transition-colors">
                Details
              </a>
              <a href="#features" className="py-3 hover:text-soul-blue transition-colors">
                Amenities
              </a>
              <a href="#reviews" className="py-3 hover:text-soul-blue transition-colors">
                Reviews
              </a>
              <a href="#rules" className="py-3 hover:text-soul-blue transition-colors">
                House rules
              </a>
            </div>
          </nav>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_380px] gap-12 pb-[120px] md:pb-20">
            <div>
              <section className="pb-8 border-b border-soul-line mb-8">
                <div className="grid grid-cols-3 gap-3.5">
                  <Spec num={String(unit.guests || '—')} label="Guests" />
                  <Spec num={String(unit.beds ?? '—')} label="Bedrooms" />
                  <Spec num={String(unit.baths ?? '—')} label="Baths" />
                </div>
              </section>

              <section id="about" className="scroll-mt-[130px] pb-8 border-b border-soul-line mb-8">
                <h2 className="font-display text-2xl font-semibold mb-3.5 text-soul-blue">Description</h2>
                <ExpandableText text={description} />
              </section>

              <section id="details" className="scroll-mt-[130px] pb-8 border-b border-soul-line mb-8">
                <h2 className="font-display text-2xl font-semibold mb-4 text-soul-blue">Details</h2>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-0">
                  {detailRows.map((r) => (
                    <div
                      key={r.label}
                      className="flex justify-between gap-4 border-b border-soul-line py-2.5 text-[14.5px]"
                    >
                      <dt className="text-soul-muted">{r.label}</dt>
                      <dd className="font-semibold text-soul-blue text-end m-0">{r.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section id="features" className="scroll-mt-[130px] pb-8 border-b border-soul-line mb-8">
                <h2 className="font-display text-2xl font-semibold mb-5 text-soul-blue">Features</h2>

                {!!amenities.length && (
                  <>
                    <h3 className="text-[13px] font-bold uppercase tracking-wider text-soul-muted mb-3">
                      Amenities
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mb-7">
                      {amenities.map((a) => (
                        <div key={a} className="flex items-center gap-3 text-[14.5px]">
                          <CheckIcon />
                          {a}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {!!facilities.length && (
                  <>
                    <h3 className="text-[13px] font-bold uppercase tracking-wider text-soul-muted mb-3">
                      Facilities
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      {facilities.map((f) => (
                        <div key={f} className="flex items-center gap-3 text-[14.5px]">
                          <CheckIcon />
                          {f}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {!amenities.length && !facilities.length && (
                  <p className="text-sm text-soul-muted m-0">Amenities will appear here once added in the PMS.</p>
                )}
              </section>

              <section id="reviews" className="scroll-mt-[130px] pb-8 border-b border-soul-line mb-8">
                <h2 className="font-display text-2xl font-semibold mb-5 text-soul-blue">Reviews</h2>
                <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
                  <div className="space-y-3">
                    {user ? (
                      <AddReviewForm onSubmit={handleReviewSubmit} submitting={reviewSubmitting} />
                    ) : (
                      <div className="rounded-3xl border border-soul-line bg-soul-ivory/40 p-5">
                        <p className="text-sm text-soul-blue">
                          Please{' '}
                          <Link to="/sign-in" className="font-semibold underline">
                            sign in
                          </Link>{' '}
                          to submit a review for this unit.
                        </p>
                      </div>
                    )}
                    {reviewMessage ? (
                      <p className={`text-sm ${reviewMessage.startsWith('Thanks') ? 'text-emerald-700' : 'text-red-600'}`}>
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

              {similar.length > 0 && (
                <section className="pb-8 border-b border-soul-line mb-8">
                  <div className="flex justify-between items-center mb-3.5 flex-wrap gap-3.5">
                    <h2 className="font-display text-2xl font-semibold m-0 text-soul-blue">
                      Similar homes you might like
                    </h2>
                    <Link to="/search" className="text-soul-blue font-semibold text-sm hover:underline">
                      View all →
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                    {similar.map((l) => (
                      <ListingCard
                        key={l.id}
                        listing={l}
                        carryDates={{
                          checkin: params.get('checkin') || undefined,
                          checkout: params.get('checkout') || undefined,
                          guests: params.get('guests') || undefined,
                        }}
                      />
                    ))}
                  </div>
                </section>
              )}

              <section id="rules" className="scroll-mt-[130px] pb-8 border-b border-soul-line mb-8">
                <h2 className="font-display text-2xl font-semibold mb-3.5 text-soul-blue">House rules</h2>
                <ul className="space-y-1.5 text-sm text-soul-blue m-0 list-none p-0">
                  <li className="flex items-center gap-2">
                    <CheckIcon /> Check-in after 3:00 PM
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckIcon /> Checkout before 11:00 AM
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckIcon /> No smoking indoors
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckIcon /> No parties or events
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckIcon /> {unit.guests || 8} guests max
                  </li>
                </ul>
              </section>

              <section className="pb-8 border-b border-soul-line mb-8">
                <h2 className="font-display text-2xl font-semibold mb-3.5 text-soul-blue">Guest Regulations</h2>
                <ul className="space-y-2 text-sm text-soul-blue m-0 list-none p-0">
                  {GUEST_REGULATIONS.map((rule) => (
                    <li key={rule} className="flex items-start gap-2.5">
                      <span className="mt-0.5">
                        <CheckIcon />
                      </span>
                      <span>{rule}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <aside>
              <ListingBookingCard
                unit={unit}
                blockedDates={blocked}
                dailyPrices={prices}
                initialCheckin={params.get('checkin') || undefined}
                initialCheckout={params.get('checkout') || undefined}
                initialGuests={params.get('guests') ? parseInt(params.get('guests'), 10) : undefined}
              />
            </aside>
          </div>
        </div>
      </main>
      <Footer />

      {lightbox && (
        <div
          className="fixed inset-0 z-[230] bg-black/85 flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label="All photos"
        >
          <div className="flex items-center justify-between px-5 py-4 text-white">
            <strong className="font-display text-xl">{unit.title}</strong>
            <button
              type="button"
              onClick={() => setLightbox(false)}
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pb-10">
            <div className="max-w-4xl mx-auto grid gap-3">
              {photos.map((p, i) => (
                <img key={p} src={p} alt={`${unit.title} photo ${i + 1}`} className="w-full rounded-xl" />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
