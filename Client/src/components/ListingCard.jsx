import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bath, BedDouble, ChevronLeft, ChevronRight, Heart, Users } from 'lucide-react';
import { useCurrency } from '../context/CurrencyContext';
import { getListingWpId, useWishlist } from '../hooks/useWishlist';

export default function ListingCard({ listing, carryDates, wishlistMode = false, onRemove }) {
  const { formatPrice } = useCurrency();
  const { has, toggle, remove } = useWishlist();
  const removeFromWishlist = onRemove || remove;
  const photos = (listing.photo_urls?.length
    ? listing.photo_urls
    : listing.cover_url
      ? [listing.cover_url]
      : [])
    .filter(Boolean);
  const [index, setIndex] = useState(0);
  const wpId = getListingWpId(listing);
  const wished = has(wpId);
  const amount = Number(listing.price_fallback || listing.from_price || 0);
  const priceCore = formatPrice(amount, { perNight: false });

  const location = [...new Set([listing.compound, listing.area, listing.city].filter(Boolean))].join(' · ')
    || 'North Coast, Egypt';

  const params = new URLSearchParams();
  if (carryDates?.checkin) params.set('checkin', carryDates.checkin);
  if (carryDates?.checkout) params.set('checkout', carryDates.checkout);
  if (carryDates?.guests) params.set('guests', carryDates.guests);
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

  return (
    <Link
      to={href}
      className="group flex flex-col overflow-hidden rounded-[16px] border border-soul-line bg-white transition-all hover:-translate-y-0.5 hover:border-soul-blue-100 hover:shadow-[0_24px_50px_-30px_rgba(40,63,94,0.35)]"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-soul-sand">
        {photos.length ? (
          <img
            src={photos[index]}
            alt={listing.title}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
            draggable={false}
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-sm text-soul-muted">No photo</div>
        )}

        {photos.length > 1 && (
          <>
            <button
              type="button"
              onClick={prev}
              className="absolute left-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/90 opacity-0 shadow-sm transition group-hover:opacity-100"
              aria-label="Previous photo"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={next}
              className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/90 opacity-0 shadow-sm transition group-hover:opacity-100"
              aria-label="Next photo"
            >
              <ChevronRight size={16} />
            </button>
            <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
              {photos.slice(0, 6).map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 w-1.5 rounded-full ${i === index ? 'bg-white' : 'bg-white/50'}`}
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
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/95 shadow-sm"
          aria-label={wishlistMode ? 'Remove from wishlist' : 'Toggle wishlist'}
        >
          <Heart
            size={16}
            className={wished ? 'fill-[#e0245e] text-[#e0245e]' : 'text-soul-blue'}
          />
        </button>
      </div>

      <div className="flex flex-col gap-1 p-3.5">
        <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-soul-blue leading-snug">
          {listing.title}
        </h3>
        <div className="truncate text-[13px] text-soul-muted">{location}</div>

        <div className="mt-1.5 flex flex-wrap items-baseline gap-1.5">
          {priceCore ? (
            <>
              <span className="font-display text-[19px] font-semibold leading-tight text-soul-blue">
                {priceCore}
              </span>
              <span className="text-[12.5px] text-soul-muted">/ night</span>
            </>
          ) : (
            <span className="text-[13px] text-soul-muted">View pricing</span>
          )}
        </div>

        <div className="mt-2 flex items-center gap-x-3 border-t border-soul-line pt-2 text-[12.5px] text-soul-muted">
          {(listing.beds ?? 0) > 0 && (
            <Spec icon={BedDouble} value={listing.beds} />
          )}
          {(listing.baths ?? 0) > 0 && (
            <Spec icon={Bath} value={listing.baths} />
          )}
          {(listing.guests ?? 0) > 0 && (
            <Spec icon={Users} value={listing.guests} />
          )}
        </div>
      </div>
    </Link>
  );
}

function Spec({ icon: Icon, value }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <Icon size={14} strokeWidth={2} className="text-soul-blue/70" />
      <span className="font-medium text-soul-blue">{value}</span>
    </span>
  );
}

export function ListingCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[16px] border border-soul-line animate-pulse">
      <div className="aspect-[4/3] bg-soul-sand" />
      <div className="space-y-2 p-3.5">
        <div className="h-4 w-3/4 rounded bg-soul-sand" />
        <div className="h-3 w-1/2 rounded bg-soul-sand" />
        <div className="mt-2 h-5 w-28 rounded bg-soul-sand" />
        <div className="mt-2 h-3 w-full rounded bg-soul-sand" />
      </div>
    </div>
  );
}
