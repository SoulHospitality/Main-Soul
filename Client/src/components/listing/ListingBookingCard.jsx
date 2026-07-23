import { useMemo, useState } from 'react';
import { getMinimumStayNights, isGaiaUnit } from '../../utils/bookingRules';
import { useCurrency } from '../../context/CurrencyContext';
import { useLocale } from '../../context/LocaleContext';
import { housekeepingFeeForUnit } from '../../utils/housekeeping';
import { isFreeBeachProject, resolveBeachAccessRates } from '../../utils/beachAccess';
import { brand, whatsappHref } from '../../theme/brand';
import { getDisplayPriceEgp } from '../../utils/displayPrice';
import BookingDrawer from '../booking/BookingDrawer';

/**
 * SoulHospitality-style sticky reservation card.
 * Shows the unit display price (same as listing cards); schedule rates belong in BookingDrawer.
 */
export default function ListingBookingCard({
  unit,
  blockedDates = [],
  dailyPrices = {},
  initialCheckin = '',
  initialCheckout = '',
  initialGuests,
}) {
  const { t } = useLocale();
  const { formatPrice } = useCurrency();
  const money = (n) => formatPrice(n, { perNight: false }) || '—';
  const [drawerOpen, setDrawerOpen] = useState(false);

  const pricePerNight = getDisplayPriceEgp(unit);

  const cleaning = housekeepingFeeForUnit(unit);
  const minNights = getMinimumStayNights(unit);
  const beach = resolveBeachAccessRates(unit, minNights);

  const guestSeed =
    typeof initialGuests === 'number' && initialGuests > 0
      ? { adults: initialGuests, children: 0, infants: 0 }
      : initialGuests && typeof initialGuests === 'object'
        ? initialGuests
        : { adults: 1, children: 0, infants: 0 };

  const beachSummary = (() => {
    if (isFreeBeachProject(unit) || beach.mode === 'free') {
      return t('listing.beachFree');
    }
    if (isGaiaUnit(unit) || beach.mode === 'gaia') {
      return t('listing.gaiaBeachSummary');
    }
    if (!(beach.adult > 0)) return null;
    const dayLabel = beach.days === 1 ? t('common.day') : t('common.days');
    if (beach.extra > 0 && beach.extra !== beach.adult) {
      return t('listing.beachBaseExtra', { adult: money(beach.adult), extra: money(beach.extra), days: beach.days, dayLabel });
    }
    return t('listing.beachPerGuest', { adult: money(beach.adult), days: beach.days, dayLabel });
  })();

  const listingUrl = useMemo(() => {
    const base = String(brand.domain || '').replace(/\/$/, '');
    if (unit?.slug) return `${base}/listings/${unit.slug}`;
    if (typeof window !== 'undefined') return window.location.href;
    return base;
  }, [unit?.slug]);

  const inquiryHref = whatsappHref(
    `${listingUrl}\nعندي استفسار بخصوص الوحده دي`
  );

  return (
    <>
      <div className="md:sticky md:top-[116px] flex flex-col gap-4 rounded-3xl border border-soul-line bg-white p-6 shadow-[0_30px_70px_-35px_rgba(40,63,94,0.4)]">
        <div className="space-y-2 border-b border-soul-line pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-soul-muted">{t('listing.reservation')}</p>
          <div className="font-num text-3xl font-semibold text-soul-blue">
            {pricePerNight != null ? money(pricePerNight) : t('listing.ratesOnRequest')}
          </div>
          <p className="text-sm text-soul-muted">{t('listing.housekeepingFee', { amount: money(cleaning) })}</p>
          {beachSummary && <p className="text-sm text-soul-muted">{t('listing.beachAccess', { summary: beachSummary })}</p>}
        </div>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex w-full items-center justify-center rounded-full bg-soul-blue px-6 py-3.5 text-sm font-semibold uppercase tracking-[0.16em] text-white transition-colors hover:bg-soul-blue-dark"
          >
            {t('listing.reserve')}
          </button>
          <a
            href={inquiryHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#25d366] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_12px_28px_-10px_rgba(37,211,102,0.55)] transition-colors hover:bg-[#1ebe5a]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M20.52 3.48A11.94 11.94 0 0012.04 0C5.5 0 .18 5.32.18 11.86c0 2.09.55 4.13 1.6 5.93L0 24l6.36-1.66a11.86 11.86 0 005.68 1.45h.01c6.54 0 11.86-5.32 11.86-11.86 0-3.17-1.23-6.15-3.39-8.45zM12.05 21.79h-.01a9.86 9.86 0 01-5.03-1.38l-.36-.21-3.77.99 1.01-3.68-.24-.38a9.84 9.84 0 01-1.51-5.26c0-5.44 4.43-9.87 9.88-9.87 2.64 0 5.12 1.03 6.98 2.9a9.81 9.81 0 012.89 6.98c0 5.44-4.43 9.87-9.84 9.87zm5.41-7.39c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.34.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.34.45-.51.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.5l-.57-.01a1.1 1.1 0 00-.79.37c-.27.3-1.04 1.01-1.04 2.47s1.07 2.87 1.21 3.07c.15.2 2.1 3.21 5.08 4.5.71.31 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2-1.42.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35z" />
            </svg>
            {t('listing.haveInquiry')}
          </a>
        </div>
      </div>

      <div className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-soul-line px-4 py-3 flex flex-col gap-2 shadow-[0_-8px_24px_-12px_rgba(15,28,46,.18)]">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-bold text-[17px] leading-tight truncate text-soul-blue">
              {pricePerNight != null ? money(pricePerNight) : t('listing.inquire')}
              {pricePerNight != null && (
                <span className="text-[12px] font-medium text-soul-muted"> {t('common.perNight')}</span>
              )}
            </div>
            <div className="text-[11.5px] text-soul-muted truncate">{t('listing.housekeepingShort', { amount: money(cleaning) })}</div>
          </div>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-[12px] bg-soul-blue px-4 py-3 text-xs font-semibold uppercase tracking-wide text-white whitespace-nowrap hover:bg-soul-blue-dark"
          >
            {t('listing.reserve')}
          </button>
        </div>
        <a
          href={inquiryHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-[#25d366] px-5 py-3 text-sm font-semibold text-white"
        >
          {t('listing.haveInquiry')}
        </a>
      </div>

      <BookingDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        unit={unit}
        blockedDates={blockedDates}
        dailyPrices={dailyPrices}
        initialCheckin={initialCheckin || ''}
        initialCheckout={initialCheckout || ''}
        initialGuests={guestSeed}
      />
    </>
  );
}
