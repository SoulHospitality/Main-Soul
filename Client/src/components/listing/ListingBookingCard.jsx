import { useMemo, useState } from 'react';
import BookingDrawer from '../booking/BookingDrawer';
import { BOOKING_POLICIES } from '../../constants/bookingPolicies';
import { getMinimumStayNights } from '../../utils/bookingRules';
import { localDateToIso } from './ListingDatePicker';
import { useCurrency } from '../../context/CurrencyContext';
import { housekeepingFeeForUnit } from '../../utils/housekeeping';

/**
 * SoulHospitality-style sticky reservation card.
 * Opens BookingDrawer on "Reserve this unit".
 */
export default function ListingBookingCard({
  unit,
  blockedDates = [],
  dailyPrices = {},
  initialCheckin,
  initialCheckout,
  initialGuests,
}) {
  const { formatPrice } = useCurrency();
  const money = (n) => formatPrice(n, { perNight: false }) || '—';
  const [drawerOpen, setDrawerOpen] = useState(false);

  const pricePerNight = useMemo(() => {
    const vals = Object.values(dailyPrices || {}).filter((n) => typeof n === 'number' && n > 0);
    if (vals.length) return Math.min(...vals);
    const fb = Number(unit?.price_fallback || unit?.from_price || 0);
    return fb > 0 ? fb : null;
  }, [dailyPrices, unit]);

  const cleaning = housekeepingFeeForUnit(unit);
  const beachBase = Number(unit?.access_fee_per_adult_egp || unit?.beach_access_price || 0);
  const beachExtra = Number(unit?.access_fee_per_teen_egp || unit?.beach_access_extra_guest || beachBase || 0);
  const beachDays = Number(unit?.access_card_count_included || unit?.beach_access_days || 7) || 7;

  const beachSummary = (() => {
    if (!(beachBase > 0)) return null;
    if (beachExtra > 0 && beachExtra !== beachBase) {
      return `${money(beachBase)} base, ${money(beachExtra)} extra guest / ${beachDays} ${beachDays === 1 ? 'day' : 'days'}`;
    }
    return `${money(beachBase)} per guest / ${beachDays} ${beachDays === 1 ? 'day' : 'days'}`;
  })();

  const guests = useMemo(() => {
    const cap = Number(unit?.guests) || 8;
    const adults = Math.max(1, Math.min(Number(initialGuests) || 1, cap));
    return { adults, children: 0, infants: 0 };
  }, [initialGuests, unit?.guests]);

  const drawerCheckin =
    initialCheckin ||
    localDateToIso(
      (() => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return d;
      })()
    );
  const drawerCheckout =
    initialCheckout ||
    localDateToIso(
      (() => {
        const d = new Date();
        d.setDate(d.getDate() + 1 + getMinimumStayNights(unit));
        return d;
      })()
    );

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
          onClick={() => setDrawerOpen(true)}
          className="inline-flex w-full items-center justify-center rounded-full bg-soul-blue px-6 py-3.5 text-sm font-semibold uppercase tracking-[0.16em] text-white transition-colors hover:bg-soul-blue-dark"
        >
          Reserve this unit
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
          onClick={() => setDrawerOpen(true)}
          className="bg-soul-blue text-white font-semibold px-5 py-3 rounded-[12px] text-sm whitespace-nowrap uppercase tracking-wide"
        >
          Reserve
        </button>
      </div>

      <BookingDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        unit={unit}
        blockedDates={blockedDates}
        dailyPrices={dailyPrices}
        initialCheckin={drawerCheckin}
        initialCheckout={drawerCheckout}
        initialGuests={guests}
      />
    </>
  );
}
