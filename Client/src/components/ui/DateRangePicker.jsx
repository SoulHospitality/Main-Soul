import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const isSameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const isBeforeDay = (a, b) => startOfDay(a).getTime() < startOfDay(b).getTime();
const isAfterDay = (a, b) => startOfDay(a).getTime() > startOfDay(b).getTime();
const addMonths = (date, offset) => new Date(date.getFullYear(), date.getMonth() + offset, 1);

const formatMonthLabel = (date) =>
  date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

const toIsoLocal = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const formatStayDate = (value, empty = 'Add date') => {
  if (!value) return empty;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return empty;
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

const buildCalendarDays = (monthDate) => {
  const firstDayOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const startDate = new Date(firstDayOfMonth);
  startDate.setDate(firstDayOfMonth.getDate() - firstDayOfMonth.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const nextDate = new Date(startDate);
    nextDate.setDate(startDate.getDate() + index);
    return nextDate;
  });
};

/**
 * Capsule-style From / To range calendar (shared look with homepage search).
 * variant: "default" | "hero" (frosted glass for homepage capsule)
 */
export default function DateRangePicker({
  checkin = '',
  checkout = '',
  onChange,
  defaultOpen = false,
  variant = 'default',
  onOpenChange,
}) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(defaultOpen);
  const [activeField, setActiveField] = useState('arrive');
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const seed = checkin || checkout;
    return seed ? new Date(`${seed}T00:00:00`) : new Date();
  });
  const isHero = variant === 'hero';

  useEffect(() => {
    if (!open) return undefined;
    const onOutside = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
        onOpenChange?.(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open, onOpenChange]);

  const calendarDays = useMemo(() => buildCalendarDays(calendarMonth), [calendarMonth]);

  function setPickerOpen(next, field) {
    setOpen(next);
    onOpenChange?.(next);
    if (field) setActiveField(field);
  }

  function openPicker(field) {
    const selectedValue = field === 'arrive' ? checkin : checkout || checkin;
    const selectedDate = selectedValue ? new Date(`${selectedValue}T00:00:00`) : new Date();
    setActiveField(field);
    setPickerOpen(true, field);
    setCalendarMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  }

  function handleSelect(date) {
    const today = startOfDay(new Date());
    if (isBeforeDay(date, today)) return;

    const value = toIsoLocal(date);

    if (activeField === 'arrive') {
      const departDate = checkout ? new Date(`${checkout}T00:00:00`) : null;
      const nextCheckout = departDate && isAfterDay(departDate, date) ? checkout : '';
      onChange?.({ checkin: value, checkout: nextCheckout });
      setActiveField('depart');
      setCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1));
      return;
    }

    if (!checkin) {
      onChange?.({ checkin: value, checkout: '' });
      setActiveField('depart');
      setCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1));
      return;
    }

    const arriveDate = new Date(`${checkin}T00:00:00`);
    if (isSameDay(date, arriveDate) || isBeforeDay(date, arriveDate)) {
      onChange?.({ checkin: value, checkout: '' });
      setActiveField('depart');
      setCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1));
      return;
    }

    onChange?.({ checkin, checkout: value });
    setPickerOpen(false);
  }

  function clearDates(e) {
    e.stopPropagation();
    onChange?.({ checkin: '', checkout: '' });
    setActiveField('arrive');
  }

  const today = startOfDay(new Date());
  const arriveDate = checkin ? new Date(`${checkin}T00:00:00`) : null;
  const departDate = checkout ? new Date(`${checkout}T00:00:00`) : null;

  const shellCls = isHero
    ? 'grid grid-cols-2 overflow-hidden rounded-2xl border border-white/25 bg-white/10'
    : 'grid grid-cols-2 overflow-hidden rounded-xl border border-soul-line bg-white';
  const labelCls = isHero
    ? 'block text-[11px] font-bold uppercase tracking-wider text-white/70'
    : 'block text-[10px] font-bold uppercase tracking-wider text-soul-muted';
  const valueCls = (filled) =>
    isHero
      ? `mt-0.5 block truncate text-sm font-medium ${filled ? 'text-white' : 'text-white/55'}`
      : `mt-0.5 block truncate text-sm font-medium ${filled ? 'text-soul-blue' : 'text-soul-muted'}`;
  const halfActive = (field) =>
    isHero
      ? open && activeField === field
        ? 'bg-white/20'
        : 'hover:bg-white/15'
      : open && activeField === field
        ? 'bg-soul-blue-50/70'
        : 'hover:bg-soul-blue-50/40';
  const popoverCls = isHero
    ? 'absolute left-0 right-0 top-full z-[130] mt-3 rounded-2xl border border-white/25 bg-white/95 p-4 shadow-2xl backdrop-blur-xl sm:left-0 sm:right-auto sm:w-[340px] sm:p-6'
    : 'absolute left-0 right-0 top-full z-[130] mt-3 rounded-2xl border border-soul-line bg-white p-4 shadow-[0_18px_50px_rgba(40,63,94,0.18)] sm:left-0 sm:right-auto sm:w-[340px]';

  return (
    <div ref={rootRef} className={`relative ${open ? 'z-[120]' : 'z-10'}`}>
      <div className={shellCls}>
        <button
          type="button"
          onClick={() => openPicker('arrive')}
          className={`border-e ${isHero ? 'border-white/20' : 'border-soul-line'} ${isHero ? 'px-5 py-4' : 'px-3.5 py-2.5'} text-start transition ${halfActive('arrive')}`}
        >
          <span className={labelCls}>{isHero ? 'Arrive' : 'From'}</span>
          <span className={valueCls(!!checkin)}>
            {formatStayDate(checkin, isHero ? 'Select date' : 'Add date')}
          </span>
        </button>
        <button
          type="button"
          onClick={() => openPicker('depart')}
          className={`${isHero ? 'px-5 py-4' : 'px-3.5 py-2.5'} text-start transition ${halfActive('depart')}`}
        >
          <span className={labelCls}>{isHero ? 'Depart' : 'To'}</span>
          <span className={valueCls(!!checkout)}>
            {formatStayDate(checkout, isHero ? 'Select date' : 'Add date')}
          </span>
        </button>
      </div>

      {open ? (
        <div className={popoverCls}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="inline-flex rounded-full border border-soul-line bg-soul-ivory/50 p-0.5">
              <button
                type="button"
                onClick={() => setActiveField('arrive')}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                  activeField === 'arrive'
                    ? 'bg-soul-blue text-white'
                    : 'text-soul-muted hover:text-soul-blue'
                }`}
              >
                {isHero ? 'Arrive' : 'From'}
              </button>
              <button
                type="button"
                onClick={() => setActiveField('depart')}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                  activeField === 'depart'
                    ? 'bg-soul-blue text-white'
                    : 'text-soul-muted hover:text-soul-blue'
                }`}
              >
                {isHero ? 'Depart' : 'To'}
              </button>
            </div>
            {(checkin || checkout) && (
              <button
                type="button"
                onClick={clearDates}
                className="text-[11px] font-semibold text-soul-muted hover:text-soul-blue"
              >
                Clear
              </button>
            )}
          </div>

          <div className="mb-3 flex items-center justify-between text-soul-blue">
            <button
              type="button"
              onClick={() => setCalendarMonth((c) => addMonths(c, -1))}
              className="rounded-full px-2 py-1 text-lg font-semibold transition-colors hover:bg-soul-blue-50"
              aria-label="Previous month"
            >
              ←
            </button>
            <span className="text-sm font-semibold uppercase tracking-[0.18em]">
              {formatMonthLabel(calendarMonth)}
            </span>
            <button
              type="button"
              onClick={() => setCalendarMonth((c) => addMonths(c, 1))}
              className="rounded-full px-2 py-1 text-lg font-semibold transition-colors hover:bg-soul-blue-50"
              aria-label="Next month"
            >
              →
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center font-medium">
            {WEEKDAYS.map((weekday) => (
              <span
                key={weekday}
                className="text-[10px] font-semibold tracking-[0.14em] text-soul-muted/70"
              >
                {weekday}
              </span>
            ))}

            {calendarDays.map((day) => {
              const inCurrentMonth = day.getMonth() === calendarMonth.getMonth();
              const isDisabled = isBeforeDay(day, today);
              const isSelectedStart = arriveDate && isSameDay(day, arriveDate);
              const isSelectedEnd = departDate && isSameDay(day, departDate);
              const isInRange =
                arriveDate &&
                departDate &&
                isAfterDay(day, arriveDate) &&
                isBeforeDay(day, departDate);

              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => handleSelect(day)}
                  className={[
                    'mx-auto flex h-8 w-8 items-center justify-center rounded-full text-[13px] transition-colors',
                    isDisabled
                      ? 'cursor-not-allowed text-soul-muted/35'
                      : 'cursor-pointer text-soul-blue hover:bg-soul-blue-50',
                    !inCurrentMonth ? 'opacity-35' : '',
                    isInRange ? 'bg-soul-blue-50 text-soul-blue' : '',
                    isSelectedStart || isSelectedEnd
                      ? 'bg-soul-blue font-bold text-white hover:bg-soul-blue'
                      : '',
                  ].join(' ')}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DateRangeFieldLabel() {
  return (
    <span className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-soul-muted">
      <CalendarDays size={13} strokeWidth={2} />
      Dates
    </span>
  );
}
