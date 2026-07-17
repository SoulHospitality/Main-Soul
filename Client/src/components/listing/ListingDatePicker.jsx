import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const dateToIso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function rangeHasBlockedNight(start, end, blockedSet) {
  if (!blockedSet?.size) return false;
  for (let t = +start; t < +end; t += 86_400_000) {
    if (blockedSet.has(dateToIso(new Date(t)))) return true;
  }
  return false;
}

function compactPrice(amount) {
  if (amount >= 1000) return `${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1)}k`;
  return String(amount);
}

/**
 * Dual-month "Select dates" calendar (soul-website parity).
 * Shows PMS nightly prices under each available day.
 * `inline` — render in-place (e.g. BookingDrawer) instead of a portal popover.
 */
export default function ListingDatePicker({
  value,
  onChange,
  onClose,
  anchorRef,
  blockedDates = [],
  dailyPrices = {},
  minNights = 1,
  inline = false,
}) {
  const [view, setView] = useState(() => {
    const base = value?.start ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const blockedSet = new Set(blockedDates);

  useEffect(() => {
    if (inline) return undefined;
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [inline]);

  useEffect(() => {
    if (inline || !isMobile) return undefined;
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = orig;
    };
  }, [isMobile, inline]);

  useEffect(() => {
    if (inline || !anchorRef?.current || isMobile) return undefined;
    const place = () => {
      const r = anchorRef.current.getBoundingClientRect();
      const width = Math.min(580, window.innerWidth - 32);
      setPos({
        top: r.bottom + 8,
        left: Math.max(16, Math.min(r.left, window.innerWidth - width - 16)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { passive: true });
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place);
    };
  }, [anchorRef, isMobile, inline]);

  useEffect(() => {
    if (inline) return undefined;
    const onClick = (e) => {
      if (
        popRef.current &&
        !popRef.current.contains(e.target) &&
        anchorRef?.current &&
        !anchorRef.current.contains(e.target)
      ) {
        onClose?.();
      }
    };
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, anchorRef, inline]);

  function pick(d) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d < today) return;

    const isBlockedNight = blockedSet.has(dateToIso(d));
    const choosingCheckout = !!value.start && !value.end && d > value.start;

    if (choosingCheckout) {
      if (rangeHasBlockedNight(value.start, d, blockedSet)) {
        if (!isBlockedNight) onChange({ start: d, end: null });
        return;
      }
      const nights = Math.round((+d - +value.start) / 86_400_000);
      if (nights < Math.max(1, minNights || 0)) return;
      onChange({ start: value.start, end: d });
      if (!inline) setTimeout(() => onClose?.(), 250);
      return;
    }

    if (isBlockedNight) return;
    onChange({ start: d, end: null });
  }

  function summary() {
    if (value.start && value.end) {
      const nights = Math.round((+value.end - +value.start) / 86_400_000);
      const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `${fmt(value.start)} – ${fmt(value.end)} · ${nights} night${nights > 1 ? 's' : ''}`;
    }
    if (value.start) {
      return `Check-in ${value.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · pick check-out`;
    }
    return 'Pick a check-in date';
  }

  const panel = (
    <div
      ref={popRef}
      className={
        inline
          ? 'bg-white border border-soul-line rounded-[22px] p-4 sm:p-5'
          : isMobile
            ? 'fixed inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto bg-white border-t border-soul-line rounded-t-[22px] shadow-2xl z-[220] p-5 pb-[max(20px,env(safe-area-inset-bottom))]'
            : 'fixed bg-white border border-soul-line rounded-[22px] shadow-2xl z-[220] p-5'
      }
      style={!inline && !isMobile && pos ? { top: pos.top, left: pos.left, minWidth: 580, maxWidth: 'calc(100vw - 32px)' } : undefined}
    >
      <div className="flex justify-between items-center mb-3.5">
        <button
          type="button"
          onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
          className="w-8 h-8 rounded-full hover:bg-soul-blue-50 text-lg text-soul-blue"
          aria-label="Previous month"
        >
          ‹
        </button>
        <strong className="text-sm text-soul-blue">Select dates</strong>
        <button
          type="button"
          onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
          className="w-8 h-8 rounded-full hover:bg-soul-blue-50 text-lg text-soul-blue"
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      <div className={`grid gap-6 ${inline ? 'grid-cols-1 sm:grid-cols-2 sm:gap-6' : 'grid-cols-1 md:grid-cols-2 gap-8'}`}>
        <Month month={view} value={value} onPick={pick} blockedSet={blockedSet} dailyPrices={dailyPrices} minNights={minNights} />
        <Month
          month={new Date(view.getFullYear(), view.getMonth() + 1, 1)}
          value={value}
          onPick={pick}
          blockedSet={blockedSet}
          dailyPrices={dailyPrices}
          minNights={minNights}
        />
      </div>

      {blockedSet.size > 0 && (
        <div className="mt-3 flex items-center gap-2 text-[11.5px] text-soul-muted">
          <span className="inline-grid place-items-center w-5 h-5 rounded-full bg-[#f4f5f7] border border-[#e3e8ef] text-soul-muted/50 text-[11px] line-through">
            14
          </span>
          Crossed-out dates are already booked
        </div>
      )}

      <div className="flex justify-between items-center mt-4 pt-3.5 border-t border-soul-line gap-3 flex-wrap">
        <span className="text-[12.5px] text-soul-muted">{summary()}</span>
        <div className="flex gap-2">
          <button
            type="button"
            className="px-3.5 py-2 rounded-full border border-soul-line text-xs font-semibold text-soul-blue"
            onClick={() => onChange({ start: null, end: null })}
          >
            Clear
          </button>
          {!inline && (
            <button
              type="button"
              className="px-3.5 py-2 rounded-full bg-soul-blue text-white text-xs font-semibold hover:bg-soul-blue-dark"
              onClick={() => onClose?.()}
            >
              Apply
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (inline) return panel;

  if (typeof document === 'undefined') return null;
  if (!isMobile && !pos) return null;

  return createPortal(
    <>
      {isMobile && (
        <div className="fixed inset-0 z-[219] bg-black/40 backdrop-blur-sm" onClick={() => onClose?.()} aria-hidden="true" />
      )}
      {panel}
    </>,
    document.body
  );
}

function Month({ month, value, onPick, blockedSet, dailyPrices, minNights }) {
  const y = month.getFullYear();
  const mo = month.getMonth();
  const first = new Date(y, mo, 1);
  const last = new Date(y, mo + 1, 0);
  const startDay = (first.getDay() + 6) % 7;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const monthKey = `${y}-${String(mo + 1).padStart(2, '0')}-`;
  const hasAnyPrice = Object.keys(dailyPrices || {}).some((iso) => iso.startsWith(monthKey));

  const cells = [];
  for (let i = 0; i < startDay; i++) {
    cells.push(<span key={`b${i}`} className={hasAnyPrice ? 'min-h-[52px]' : 'invisible'} />);
  }

  for (let d = 1; d <= last.getDate(); d++) {
    const date = new Date(y, mo, d);
    const iso = `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const past = date < today;
    const blocked = blockedSet.has(iso);
    const violatesMin =
      !!minNights &&
      minNights > 0 &&
      !!value.start &&
      !value.end &&
      date > value.start &&
      Math.round((+date - +value.start) / 86_400_000) < minNights;

    const choosingCheckout = !!value.start && !value.end && date > value.start;
    let validCheckout = false;
    let checkoutOnly = false;
    if (choosingCheckout && value.start) {
      const crosses = rangeHasBlockedNight(value.start, date, blockedSet);
      const nights = Math.round((+date - +value.start) / 86_400_000);
      validCheckout = !crosses && nights >= Math.max(1, minNights || 0);
      checkoutOnly = validCheckout && blocked;
    }

    const isStart = value.start && +date === +value.start;
    const isEnd = value.end && +date === +value.end;
    const between = value.start && value.end && date > value.start && date < value.end;
    const disabled = past || (choosingCheckout ? !validCheckout : blocked || violatesMin);
    const price = !disabled ? dailyPrices?.[iso] : undefined;

    let cls = hasAnyPrice
      ? 'min-h-[52px] flex flex-col items-center justify-center rounded-[10px] text-sm font-medium transition-colors px-0.5'
      : 'aspect-square grid place-items-center rounded-full text-sm font-medium transition-colors';

    if (past) cls += ' text-soul-muted/40 line-through cursor-not-allowed';
    else if (isStart || isEnd) cls += ' bg-soul-blue text-white font-bold cursor-pointer';
    else if (between) cls += ' bg-soul-blue-50 text-soul-blue rounded-none cursor-pointer';
    else if (choosingCheckout && validCheckout) {
      cls += checkoutOnly
        ? ' bg-[#eef2f7] text-soul-blue cursor-pointer ring-1 ring-inset ring-[#d7deea]'
        : ' hover:bg-soul-blue-50 cursor-pointer';
    } else if (blocked) cls += ' text-soul-muted/40 line-through bg-[#f4f5f7] cursor-not-allowed';
    else if (violatesMin) cls += ' text-soul-muted/40 bg-[#f7f8fa] cursor-not-allowed';
    else cls += ' hover:bg-soul-blue-50 cursor-pointer';

    if (isStart && !isEnd) cls += ' rounded-r-none';
    if (isEnd && !isStart) cls += ' rounded-l-none';

    cells.push(
      <button
        type="button"
        key={d}
        onClick={() => !disabled && onPick(date)}
        disabled={disabled}
        className={cls}
      >
        <span>{d}</span>
        {price !== undefined && (
          <span
            className={`mt-0.5 text-[10px] leading-none font-normal ${
              isStart || isEnd ? 'text-white/85' : between ? 'text-soul-blue' : 'text-soul-muted'
            }`}
          >
            {compactPrice(price)}
          </span>
        )}
      </button>
    );
  }

  return (
    <div>
      <div className="text-center font-bold text-sm mb-2 text-soul-blue">
        {MONTHS[mo]} {y}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-[10.5px] font-bold text-soul-muted uppercase tracking-wider mb-1">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, i) => (
          <span key={i} className="text-center py-1.5">{day}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">{cells}</div>
    </div>
  );
}

export function formatBookingDate(d, empty = 'Add date') {
  if (!d) return empty;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function isoToLocalDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function localDateToIso(d) {
  if (!d) return '';
  return dateToIso(d);
}
