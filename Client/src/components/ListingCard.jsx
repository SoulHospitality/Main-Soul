import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bath, BedDouble, ChevronLeft, ChevronRight, Heart, Maximize2, Users } from 'lucide-react';
import { useCurrency } from '../context/CurrencyContext';
import { useLocale } from '../context/LocaleContext';
import { getListingWpId, useWishlist } from '../hooks/useWishlist';
import { optimizeImageUrl } from '../utils/imageUrl';
import { getDisplayPriceEgp } from '../utils/displayPrice';

export default function ListingCard({ listing, carryDates, wishlistMode = false, onRemove, priority = false }) {
  const { formatPrice } = useCurrency();
  const { t } = useLocale();
  const { has, toggle, remove } = useWishlist();
  const removeFromWishlist = onRemove || remove;
  const isLongTerm = String(listing.listing_type || 'rent').toLowerCase() === 'long_term';
  const photos = (() => {
    const list = [];
    if (listing.cover_url) list.push(listing.cover_url);
    for (const url of listing.photo_urls || []) {
      if (url && !list.includes(url)) list.push(url);
    }
    return list.slice(0, 6).map((url) => optimizeImageUrl(url, { width: 720 }));
  })();

  const [index, setIndex] = useState(0);
  const wpId = getListingWpId(listing);
  const wished = has(wpId);
  const amount = getDisplayPriceEgp(listing);
  const priceCore = amount != null ? formatPrice(amount, { perNight: false }) : null;
  const sizeM2 = Number(listing.size_m2 || listing.unit_area || 0);
  const reviewCount = Number(listing.review_count || listing.reviewCount || 0);
  const rating = Number(listing.average_rating || listing.averageRating || listing.rating || 0);

  const location = [...new Set([listing.compound, listing.area, listing.city].filter(Boolean))].join(' · ')
    || 'North Coast, Egypt';

  const params = new URLSearchParams();
  if (carryDates?.checkin) params.set('checkin', carryDates.checkin);
  if (carryDates?.checkout) params.set('checkout', carryDates.checkout);
  if (!isLongTerm && carryDates?.guests) params.set('guests', carryDates.guests);
  const qs = params.toString();
  const href = `/listings/${listing.slug}${qs ? `?${qs}` : ''}`;

  function prev(e) {
    e.preventDefault();
    e.stopPropagation();
    setIndex((i) => (i - 1 + photos.length) % photos.length);
  }

  function next(e) {
    e.preventDefault();
    e.stopPropagation();
    setIndex((i) => (i + 1) % photos.length);
  }

  const specs = [
    (listing.beds ?? 0) > 0 ? { icon: BedDouble, value: listing.beds } : null,
    (listing.baths ?? 0) > 0 ? { icon: Bath, value: listing.baths } : null,
    (listing.guests ?? 0) > 0 ? { icon: Users, value: listing.guests } : null,
    isLongTerm && sizeM2 > 0 ? { icon: Maximize2, value: `${sizeM2} m²` } : null,
  ].filter(Boolean);

  return (
    <Link to={href} className="group block">
      <div className="g-zoom relative aspect-[4/3.4] overflow-hidden rounded-[24px] bg-soul-sand">
        {photos.length ? (
          <img
            src={photos[index]}
            alt={listing.title}
            width={720}
            height={612}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={priority ? 'high' : 'auto'}
            sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 25vw"
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-sm text-soul-muted">{t('listing.noPhoto')}</div>
        )}

        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-soul-ink/45 via-transparent to-soul-ink/10 opacity-70 transition-opacity duration-500 group-hover:opacity-100" />

        <div className="absolute start-3 top-3 flex items-center gap-1.5">
          {isLongTerm ? (
            <span className="rounded-full border border-white/30 bg-white/20 px-3 py-1.5 text-white backdrop-blur-md">
              <span className="g-index">{t('listing.longTermBadge')}</span>
            </span>
          ) : reviewCount > 0 ? (
            <span className="rounded-full bg-white/95 px-2.5 py-1.5 font-num text-[12px] font-semibold text-soul-blue shadow-sm">
              ★ {rating.toFixed(1)}
            </span>
          ) : null}
        </div>

        {photos.length > 1 && (
          <>
            <button
              type="button"
              onClick={prev}
              className="absolute start-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-white/40 bg-white/25 text-white opacity-0 backdrop-blur-md transition duration-300 hover:bg-white hover:text-soul-blue group-hover:opacity-100"
              aria-label={t('common.previousMonth')}
            >
              <ChevronLeft size={16} className="rtl:rotate-180" />
            </button>
            <button
              type="button"
              onClick={next}
              className="absolute end-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-white/40 bg-white/25 text-white opacity-0 backdrop-blur-md transition duration-300 hover:bg-white hover:text-soul-blue group-hover:opacity-100"
              aria-label={t('common.nextMonth')}
            >
              <ChevronRight size={16} className="rtl:rotate-180" />
            </button>
            <div className="absolute inset-x-4 bottom-3.5 flex gap-1">
              {photos.map((_, i) => (
                <span
                  key={i}
                  className={`h-[2px] flex-1 rounded-full transition-colors duration-300 ${i === index ? 'bg-white' : 'bg-white/35'}`}
                />
              ))}
            </div>
          </>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (wishlistMode && wished) removeFromWishlist(listing);
            else toggle({ ...listing, wp_post_id: wpId, listing_wp_id: wpId });
          }}
          className={`absolute end-3 top-3 grid h-10 w-10 place-items-center rounded-full border backdrop-blur-md transition-all duration-300 hover:scale-105 ${
            wished ? 'border-white bg-white' : 'border-white/40 bg-white/20 hover:bg-white/35'
          }`}
          aria-label={wishlistMode ? t('account.removeWishlist') : t('nav.wishlist')}
        >
          <Heart size={16} className={wished ? 'fill-[#e0245e] text-[#e0245e]' : 'text-white'} />
        </button>
      </div>

      <div className="px-1 pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="g-index truncate text-soul-muted">{location}</span>
          {!isLongTerm ? (
            <span className="shrink-0 text-[12px] text-soul-muted">
              {reviewCount > 0 ? t('listing.reviewCount', { count: reviewCount }) : t('listing.noReviewsYet')}
            </span>
          ) : null}
        </div>

        <h3 className="mt-1.5 truncate font-display text-[23px] font-medium leading-tight text-soul-blue transition-colors">
          <span className="bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1px] bg-left-bottom bg-no-repeat transition-[background-size] duration-700 ease-soul group-hover:bg-[length:100%_1px] rtl:bg-right-bottom">
            {listing.title}
          </span>
        </h3>

        <div className="mt-3 flex items-end justify-between gap-3 border-t border-soul-line pt-3">
          <div className="flex min-w-0 items-center gap-3 overflow-hidden text-[12.5px] text-soul-muted">
            {specs.map(({ icon: Icon, value }, i) => (
              <span key={i} className="inline-flex items-center gap-1 whitespace-nowrap">
                <Icon size={14} strokeWidth={1.7} className="text-soul-blue/60" />
                <span className="font-num font-medium text-soul-blue">{value}</span>
              </span>
            ))}
          </div>
          <div className="shrink-0 text-end">
            {priceCore ? (
              <>
                <span className="font-num text-[17px] font-semibold leading-none text-soul-blue">{priceCore}</span>
                <span className="ms-1 text-[12px] text-soul-muted">
                  {isLongTerm ? t('listing.perMonthShort') : t('listing.perNightShort')}
                </span>
              </>
            ) : (
              <span className="text-[13px] text-soul-muted">
                {isLongTerm ? t('listing.inquireForPrice') : t('listing.viewPricing')}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

export function ListingCardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="aspect-[4/3.4] rounded-[24px] bg-soul-sand" />
      <div className="space-y-2.5 px-1 pt-4">
        <div className="h-3 w-1/2 rounded bg-soul-sand" />
        <div className="h-5 w-3/4 rounded bg-soul-sand" />
        <div className="mt-3 h-4 w-full rounded bg-soul-sand" />
      </div>
    </div>
  );
}
