import { useMemo, useRef, useState } from 'react';
import { useCurrency } from '../../context/CurrencyContext';
import { useLocale } from '../../context/LocaleContext';
import { brand, whatsappHref } from '../../theme/brand';
import { getMinimumStayNights } from '../../utils/bookingRules';
import ListingDatePicker, { isoToLocalDate, localDateToIso } from './ListingDatePicker';

function WhatsAppIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.52 3.48A11.94 11.94 0 0012.04 0C5.5 0 .18 5.32.18 11.86c0 2.09.55 4.13 1.6 5.93L0 24l6.36-1.66a11.86 11.86 0 005.68 1.45h.01c6.54 0 11.86-5.32 11.86-11.86 0-3.17-1.23-6.15-3.39-8.45zM12.05 21.79h-.01a9.86 9.86 0 01-5.03-1.38l-.36-.21-3.77.99 1.01-3.68-.24-.38a9.84 9.84 0 01-1.51-5.26c0-5.44 4.43-9.87 9.88-9.87 2.64 0 5.12 1.03 6.98 2.9a9.81 9.81 0 012.89 6.98c0 5.44-4.43 9.87-9.84 9.87zm5.41-7.39c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.34.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.34.45-.51.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.5l-.57-.01a1.1 1.1 0 00-.79.37c-.27.3-1.04 1.01-1.04 2.47s1.07 2.87 1.21 3.07c.15.2 2.1 3.21 5.08 4.5.71.31 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2-1.42.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35z" />
    </svg>
  );
}

export default function ListingLongTermCard({
  unit,
  blockedDates = [],
  checkoutDates = [],
  initialCheckin = '',
  initialCheckout = '',
}) {
  const { t, localeTag } = useLocale();
  const { formatPrice } = useCurrency();
  const [range, setRange] = useState(() => ({
    start: isoToLocalDate(initialCheckin),
    end: isoToLocalDate(initialCheckout),
  }));
  const [pickerOpen, setPickerOpen] = useState(false);
  const desktopAnchorRef = useRef(null);
  const mobileAnchorRef = useRef(null);
  const [anchor, setAnchor] = useState(desktopAnchorRef);

  const minNights = getMinimumStayNights(unit);
  const monthly = Number(unit?.price_monthly) > 0 ? Number(unit.price_monthly) : null;
  const monthlyLabel = monthly != null ? formatPrice(monthly, { perNight: false }) : null;
  const nights =
    range.start && range.end ? Math.round((+range.end - +range.start) / 86_400_000) : 0;

  const listingUrl = useMemo(() => {
    const base = String(brand.domain || '').replace(/\/$/, '');
    if (unit?.slug) return `${base}/listings/${unit.slug}`;
    if (typeof window !== 'undefined') return window.location.href;
    return base;
  }, [unit?.slug]);

  const inquiryHref = useMemo(() => {
    const lines = [listingUrl, 'عندي استفسار بخصوص الوحده دي للإيجار طويل المدة'];
    if (range.start && range.end) {
      lines.push(
        `التواريخ: ${localDateToIso(range.start)} إلى ${localDateToIso(range.end)} (${nights} ليلة)`
      );
    }
    return whatsappHref(lines.join('\n'));
  }, [listingUrl, range.start, range.end, nights]);

  const fmt = (d) => d.toLocaleDateString(localeTag, { month: 'short', day: 'numeric', year: 'numeric' });

  const openPicker = (ref) => {
    setAnchor(ref);
    setPickerOpen(true);
  };

  const datesButtonLabel = range.start && range.end ? t('listing.changeDates') : t('listing.seeAvailableDates');

  return (
    <>
      <div className="flex flex-col gap-5 rounded-[28px] border border-soul-line bg-white p-7 shadow-[0_40px_90px_-50px_rgba(15,44,77,0.55)] md:sticky md:top-[104px]">
        <div className="space-y-3 border-b border-soul-line pb-6">
          <p className="flex items-center gap-2.5 text-soul-muted">
            <span className="g-dot" />
            <span className="g-index">{t('listing.longTermRent')}</span>
          </p>
          <div className="flex flex-wrap items-baseline gap-1.5">
            {monthlyLabel ? (
              <>
                <span className="font-num text-[34px] font-semibold leading-none text-soul-blue">{monthlyLabel}</span>
                <span className="text-sm text-soul-muted">{t('listing.perMonthShort')}</span>
              </>
            ) : (
              <span className="text-lg font-semibold text-soul-blue">{t('listing.monthlyOnRequest')}</span>
            )}
          </div>
          <p className="text-sm text-soul-muted">{t('listing.minStayNights', { count: minNights })}</p>
          <p className="text-sm text-soul-muted">{t('listing.longTermNote')}</p>
        </div>

        {range.start && range.end ? (
          <div className="rounded-2xl border border-soul-line bg-soul-paper px-4 py-3 text-sm text-soul-blue">
            {t('listing.rangeSummary', { start: fmt(range.start), end: fmt(range.end), nights })}
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          <button
            ref={desktopAnchorRef}
            type="button"
            onClick={() => openPicker(desktopAnchorRef)}
            className="g-btn g-btn-ghost w-full !py-4"
          >
            {datesButtonLabel}
          </button>
          <a
            href={inquiryHref}
            target="_blank"
            rel="noopener noreferrer"
            className="g-btn w-full !py-4 bg-[#25d366] text-white hover:bg-[#1ebe5a]"
          >
            <WhatsAppIcon />
            {t('listing.whatsappInquiry')}
          </a>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 flex flex-col gap-2 border-t border-soul-line bg-white/90 px-4 py-3 shadow-[0_-12px_30px_-16px_rgba(15,28,46,.25)] backdrop-blur-xl md:hidden">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-bold text-[17px] leading-tight truncate text-soul-blue">
              {monthlyLabel || t('listing.inquire')}
              {monthlyLabel && (
                <span className="text-[12px] font-medium text-soul-muted"> {t('listing.perMonthShort')}</span>
              )}
            </div>
            <div className="text-[11.5px] text-soul-muted truncate">
              {range.start && range.end
                ? t('listing.rangeSummary', { start: fmt(range.start), end: fmt(range.end), nights })
                : t('listing.minStayNights', { count: minNights })}
            </div>
          </div>
          <button
            ref={mobileAnchorRef}
            type="button"
            onClick={() => openPicker(mobileAnchorRef)}
            className="whitespace-nowrap rounded-full border border-soul-blue px-4 py-3 text-xs font-semibold tracking-wide text-soul-blue"
          >
            {datesButtonLabel}
          </button>
        </div>
        <a
          href={inquiryHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#25d366] px-5 py-3 text-sm font-semibold text-white"
        >
          <WhatsAppIcon />
          {t('listing.whatsappInquiry')}
        </a>
      </div>

      {pickerOpen && (
        <ListingDatePicker
          value={range}
          onChange={setRange}
          onClose={() => setPickerOpen(false)}
          anchorRef={anchor}
          blockedDates={blockedDates}
          checkoutDates={checkoutDates}
          minNights={minNights}
        />
      )}
    </>
  );
}
