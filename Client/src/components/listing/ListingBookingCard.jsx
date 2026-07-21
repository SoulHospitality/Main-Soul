import { useMemo } from 'react';
import { getMinimumStayNights, isGaiaUnit } from '../../utils/bookingRules';
import { useCurrency } from '../../context/CurrencyContext';
import { housekeepingFeeForUnit } from '../../utils/housekeeping';
import { isFreeBeachProject, resolveBeachAccessRates } from '../../utils/beachAccess';

/**
 * SoulHospitality-style sticky reservation card.
 * Reserve CTA is temporarily disabled (coming soon).
 */
export default function ListingBookingCard({
  unit,
  dailyPrices = {},
}) {
  const { formatPrice } = useCurrency();
  const money = (n) => formatPrice(n, { perNight: false }) || '—';

  const pricePerNight = useMemo(() => {
    const vals = Object.values(dailyPrices || {}).filter((n) => typeof n === 'number' && n > 0);
    if (vals.length) return Math.min(...vals);
    const fb = Number(unit?.price_fallback || unit?.from_price || 0);
    return fb > 0 ? fb : null;
  }, [dailyPrices, unit]);

  const cleaning = housekeepingFeeForUnit(unit);
  const minNights = getMinimumStayNights(unit);
  const beach = resolveBeachAccessRates(unit, minNights);

  const beachSummary = (() => {
    if (isFreeBeachProject(unit) || beach.mode === 'free') {
      return 'Free';
    }
    if (isGaiaUnit(unit) || beach.mode === 'gaia') {
      return 'By stay length — 3 nights: 1,900 (extra 2,500) · 4 nights: 2,500 (extra 3,100) · 5+: 3,500 / 7 nights (extra 4,100)';
    }
    if (!(beach.adult > 0)) return null;
    if (beach.extra > 0 && beach.extra !== beach.adult) {
      return `${money(beach.adult)} base, ${money(beach.extra)} extra guest / ${beach.days} ${beach.days === 1 ? 'day' : 'days'}`;
    }
    return `${money(beach.adult)} per guest / ${beach.days} ${beach.days === 1 ? 'day' : 'days'}`;
  })();

  return (
    <>
      <div className="md:sticky md:top-[116px] flex flex-col gap-4 rounded-3xl border border-soul-line bg-white p-6 shadow-[0_30px_70px_-35px_rgba(40,63,94,0.4)]">
        <div className="space-y-2 border-b border-soul-line pb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-soul-muted">Reservation</p>
          <div className="font-num text-3xl font-semibold text-soul-blue">
            {pricePerNight != null ? money(pricePerNight) : 'Rates on request'}
          </div>
          <p className="text-sm text-soul-muted">Housekeeping Fee: {money(cleaning)} (mandatory)</p>
          {beachSummary && <p className="text-sm text-soul-muted">Beach Access: {beachSummary}</p>}
        </div>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="inline-flex w-full cursor-not-allowed items-center justify-center rounded-full bg-soul-blue/40 px-6 py-3.5 text-sm font-semibold uppercase tracking-[0.16em] text-white/80"
        >
          Coming soon
        </button>
      </div>

      <div className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-soul-line px-4 py-3 flex items-center gap-3 shadow-[0_-8px_24px_-12px_rgba(15,28,46,.18)]">
        <div className="flex-1 min-w-0">
          <div className="font-bold text-[17px] leading-tight truncate text-soul-blue">
            {pricePerNight != null ? money(pricePerNight) : 'Inquire'}
            {pricePerNight != null && (
              <span className="text-[12px] font-medium text-soul-muted"> / night</span>
            )}
          </div>
          <div className="text-[11.5px] text-soul-muted truncate">Housekeeping {money(cleaning)}</div>
        </div>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="cursor-not-allowed rounded-[12px] bg-soul-blue/40 px-5 py-3 text-sm font-semibold uppercase tracking-wide text-white/80 whitespace-nowrap"
        >
          Coming soon
        </button>
      </div>
    </>
  );
}
