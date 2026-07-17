import { useEffect, useMemo, useRef, useState } from 'react';
import { BedDouble, Building2, MapPin, Search, Users, Wallet, X } from 'lucide-react';
import { resolveLocationFilter, useProjectCatalog } from '../../hooks/useProjectCatalog';
import DateRangePicker, { DateRangeFieldLabel } from '../ui/DateRangePicker';

function parseIso(iso) {
  return iso || '';
}

export const RENTAL_TYPES = [
  'Apartment',
  'Studio',
  'Chalet',
  'Villa',
  'Townhouse',
  'Penthouse',
];

const inputCls =
  'w-full rounded-xl border border-soul-line bg-white px-3.5 py-2.5 text-sm text-soul-blue outline-none focus:border-soul-blue focus:ring-2 focus:ring-soul-blue/10 disabled:cursor-not-allowed disabled:opacity-55';

/**
 * Vertical floating filter panel for the properties list (desktop sticky).
 * Same fields power the mobile full-screen sheet via `variant="sheet"`.
 * Filter changes apply live — no search button required on desktop.
 */
export default function PropertyFiltersSidebar({
  values,
  onApply,
  onClear,
  variant = 'sidebar',
  onClose,
}) {
  const { destinations, projectsByDestination } = useProjectCatalog();
  const [destination, setDestination] = useState('');
  const [checkin, setCheckin] = useState('');
  const [checkout, setCheckout] = useState('');
  const [guests, setGuests] = useState(1);
  const [beds, setBeds] = useState(0);
  const [rentalTypes, setRentalTypes] = useState([]);
  const [priceMin, setPriceMin] = useState(0);
  const [priceMax, setPriceMax] = useState(0);
  const priceTimer = useRef(null);
  const skipLive = useRef(true);

  useEffect(() => {
    skipLive.current = true;
    const where = values.where || '';
    const resolved = resolveLocationFilter(where, { destinations, projectsByDestination });
    setDestination(values.destination || resolved.destination || '');
    setCheckin(parseIso(values.checkin));
    setCheckout(parseIso(values.checkout));
    setGuests(Math.max(1, Number(values.guests) || 1));
    setBeds(values.beds ? Number(values.beds) : 0);
    setRentalTypes(Array.isArray(values.types) ? values.types : []);
    setPriceMin(values.priceMin ? Number(values.priceMin) : 0);
    setPriceMax(values.priceMax ? Number(values.priceMax) : 0);
    const t = window.setTimeout(() => {
      skipLive.current = false;
    }, 0);
    return () => window.clearTimeout(t);
  }, [
    values.where,
    values.destination,
    values.checkin,
    values.checkout,
    values.guests,
    values.beds,
    // Serialize so checkbox sync is stable across identical selections
    Array.isArray(values.types) ? values.types.join(',') : '',
    values.priceMin,
    values.priceMax,
    destinations,
    projectsByDestination,
  ]);

  useEffect(() => () => {
    if (priceTimer.current) window.clearTimeout(priceTimer.current);
  }, []);

  function payloadFrom(next = {}) {
    const d = next.destination !== undefined ? next.destination : destination;
    const p = next.project !== undefined ? next.project : (values.compound || values.project || '');
    const cin = next.checkin !== undefined ? next.checkin : checkin;
    const cout = next.checkout !== undefined ? next.checkout : checkout;
    const g = next.guests !== undefined ? next.guests : guests;
    const b = next.beds !== undefined ? next.beds : beds;
    const types = next.types !== undefined ? next.types : rentalTypes;
    const min = next.priceMin !== undefined ? next.priceMin : priceMin;
    const max = next.priceMax !== undefined ? next.priceMax : priceMax;
    const where = p || d;
    const resolved = resolveLocationFilter(where, { destinations, projectsByDestination });
    return {
      where,
      destination: d || resolved.destination,
      compound: d ? p : '',
      checkin: cin || undefined,
      checkout: cout || undefined,
      guests: g,
      beds: b || undefined,
      types: types.length ? types : [],
      priceMin: min || undefined,
      priceMax: max || undefined,
    };
  }

  function liveApply(next = {}) {
    if (skipLive.current) return;
    onApply?.(payloadFrom(next));
  }

  function setDestinationLive(value) {
    setDestination(value);
    // Destination change clears project; chips handle project picks
    liveApply({ destination: value, project: '' });
  }

  function setDatesLive({ checkin: nextIn, checkout: nextOut }) {
    setCheckin(nextIn || '');
    setCheckout(nextOut || '');
    liveApply({ checkin: nextIn || '', checkout: nextOut || '' });
  }

  function setGuestsLive(value) {
    setGuests(value);
    liveApply({ guests: value });
  }

  function setBedsLive(value) {
    setBeds(value);
    liveApply({ beds: value });
  }

  function toggleRentalType(type) {
    const next = rentalTypes.includes(type)
      ? rentalTypes.filter((t) => t !== type)
      : [...rentalTypes, type];
    setRentalTypes(next);
    liveApply({ types: next });
  }

  function setPriceRangeLive(nextMin, nextMax) {
    setPriceMin(nextMin);
    setPriceMax(nextMax);
    if (priceTimer.current) window.clearTimeout(priceTimer.current);
    priceTimer.current = window.setTimeout(() => {
      liveApply({ priceMin: nextMin, priceMax: nextMax });
    }, 350);
  }

  function clearAll() {
    if (priceTimer.current) window.clearTimeout(priceTimer.current);
    setDestination('');
    setCheckin('');
    setCheckout('');
    setGuests(1);
    setBeds(0);
    setRentalTypes([]);
    setPriceMin(0);
    setPriceMax(0);
    onClear?.();
    onClose?.();
  }

  const fields = (
    <>
      <Field label="Destination" icon={MapPin}>
        <select
          className={inputCls}
          value={destination}
          onChange={(e) => setDestinationLive(e.target.value)}
        >
          <option value="">Anywhere</option>
          {destinations.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </Field>

      <div>
        <DateRangeFieldLabel />
        <DateRangePicker
          checkin={checkin}
          checkout={checkout}
          onChange={setDatesLive}
        />
      </div>

      <Field label="Guests" icon={Users}>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-soul-line bg-white px-3 py-2.5">
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-full border border-soul-line text-soul-blue disabled:opacity-40"
            disabled={guests <= 1}
            onClick={() => setGuestsLive(Math.max(1, guests - 1))}
          >
            −
          </button>
          <span className="text-sm font-semibold text-soul-blue">{guests}</span>
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-full border border-soul-line text-soul-blue disabled:opacity-40"
            disabled={guests >= 16}
            onClick={() => setGuestsLive(Math.min(16, guests + 1))}
          >
            +
          </button>
        </div>
      </Field>

      <Field label="Bedrooms" icon={BedDouble}>
        <div className="flex flex-wrap gap-1.5">
          {[0, 1, 2, 3, 4, 5, 6].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setBedsLive(n)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                beds === n
                  ? 'border-soul-blue bg-soul-blue text-white'
                  : 'border-soul-line bg-white text-soul-blue hover:border-soul-blue'
              }`}
            >
              {n === 0 ? 'Any' : n === 6 ? '6+' : `${n}+`}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Rental type" icon={Building2}>
        <div className="space-y-2 rounded-xl border border-soul-line bg-white px-3.5 py-3">
          {RENTAL_TYPES.map((type) => {
            const checked = rentalTypes.includes(type);
            return (
              <label
                key={type}
                className="flex cursor-pointer items-center gap-3 text-sm font-medium text-soul-blue"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleRentalType(type)}
                  className="h-4 w-4 rounded border-soul-line text-soul-blue accent-soul-blue focus:ring-soul-blue/30"
                />
                <span>{type}</span>
              </label>
            );
          })}
        </div>
      </Field>

      <Field label="Price range (EGP / night)" icon={Wallet}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <input
            type="number"
            min={0}
            step={500}
            className={inputCls}
            value={priceMin || ''}
            placeholder="Min"
            aria-label="Minimum price"
            onChange={(e) => setPriceRangeLive(Number(e.target.value) || 0, priceMax)}
          />
          <span className="text-xs font-semibold text-soul-muted">to</span>
          <input
            type="number"
            min={0}
            step={500}
            className={inputCls}
            value={priceMax || ''}
            placeholder="Max"
            aria-label="Maximum price"
            onChange={(e) => setPriceRangeLive(priceMin, Number(e.target.value) || 0)}
          />
        </div>
        {(priceMin > 0 || priceMax > 0) && (
          <p className="mt-1.5 text-[11px] text-soul-muted">
            {priceMin > 0 && priceMax > 0
              ? `EGP ${priceMin.toLocaleString()} – ${priceMax.toLocaleString()}`
              : priceMin > 0
                ? `From EGP ${priceMin.toLocaleString()}`
                : `Up to EGP ${priceMax.toLocaleString()}`}
          </p>
        )}
      </Field>
    </>
  );

  if (variant === 'sheet') {
    return (
      <div className="fixed inset-0 z-[210] flex flex-col bg-[#f7f5f1] lg:hidden">
        <div className="flex items-center gap-3 border-b border-soul-line bg-white px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-soul-blue-50"
          >
            <X size={20} className="text-soul-blue" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="font-display text-lg font-semibold text-soul-blue">Filters</div>
            <div className="truncate text-xs text-soul-muted">Updates as you change them</div>
          </div>
          <button type="button" onClick={clearAll} className="text-sm font-semibold text-soul-muted">
            Clear
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 pb-28">
          <div className="space-y-4 rounded-2xl border border-soul-line bg-white p-4 shadow-sm">{fields}</div>
        </div>

        <div className="border-t border-soul-line bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-soul-blue py-3.5 text-sm font-bold text-white"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <aside className="hidden lg:block">
      <div className="sticky top-[104px] max-h-[calc(100vh-120px)] overflow-visible rounded-2xl border border-soul-line bg-white p-5 shadow-[0_12px_40px_rgba(40,63,94,0.08)]">
        <div className="mb-4">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-soul-muted">Filters</p>
          <h2 className="mt-1 font-display text-xl font-semibold text-soul-blue">Find a stay</h2>
          <p className="mt-1 text-xs text-soul-muted">Results update as you filter</p>
        </div>
        <div className="flex flex-col gap-4">
          {fields}
          <button
            type="button"
            onClick={clearAll}
            className="mt-1 w-full rounded-xl border border-soul-line py-2.5 text-sm font-semibold text-soul-muted transition hover:border-soul-blue hover:text-soul-blue"
          >
            Clear filters
          </button>
        </div>
      </div>
    </aside>
  );
}

function Field({ label, icon: Icon, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-soul-muted">
        {Icon ? <Icon size={13} strokeWidth={2} /> : null}
        {label}
      </span>
      {children}
    </label>
  );
}

export function MobileSearchPill({ values, onOpen, filterCount = 0 }) {
  const place = values.where || 'Anywhere';
  const guests = Number(values.guests) || 1;
  const dateStr = useMemo(() => {
    if (!values.checkin || !values.checkout) return 'Any dates';
    try {
      const da = new Date(`${values.checkin}T00:00:00`);
      const db = new Date(`${values.checkout}T00:00:00`);
      const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const nights = Math.max(1, Math.round((+db - +da) / 86400000));
      return `${fmt(da)} – ${fmt(db)} · ${nights} night${nights === 1 ? '' : 's'}`;
    } catch {
      return 'Any dates';
    }
  }, [values.checkin, values.checkout]);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-full border border-soul-line bg-white px-4 py-3 text-start shadow-[0_2px_8px_rgba(15,28,46,0.06)]"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-soul-blue-50 text-soul-blue">
        <Search size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-bold text-soul-blue">
          {place} · {guests} guest{guests === 1 ? '' : 's'}
        </div>
        <div className="truncate text-[12px] text-soul-muted">{dateStr}</div>
      </div>
      {filterCount > 0 && (
        <span className="rounded-full bg-soul-blue px-2 py-0.5 text-[11px] font-bold text-white">
          {filterCount}
        </span>
      )}
    </button>
  );
}

export function FloatingFilterSort({ filterCount, sort, sortLabels, onOpenFilters, onSort }) {
  const [sortOpen, setSortOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setSortOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={ref} className="fixed bottom-5 left-1/2 z-[120] -translate-x-1/2 lg:hidden">
      {sortOpen && (
        <div className="absolute bottom-[calc(100%+10px)] left-1/2 min-w-[210px] -translate-x-1/2 rounded-[14px] border border-soul-line bg-white p-1.5 shadow-[0_18px_50px_rgba(40,63,94,0.18)]">
          {Object.entries(sortLabels).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                onSort(key);
                setSortOpen(false);
              }}
              className={`block w-full rounded-[10px] px-3.5 py-2.5 text-start text-sm font-medium ${
                sort === key ? 'bg-soul-blue-50 font-semibold text-soul-blue' : 'hover:bg-soul-blue-50/60'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center overflow-hidden rounded-full bg-soul-blue text-sm font-bold text-white shadow-[0_12px_36px_-8px_rgba(40,63,94,0.55)]">
        <button type="button" onClick={onOpenFilters} className="inline-flex items-center gap-2 px-5 py-3.5">
          Filters{filterCount > 0 ? ` · ${filterCount}` : ''}
        </button>
        <span className="h-5 w-px bg-white/35" />
        <button type="button" onClick={() => setSortOpen((o) => !o)} className="inline-flex items-center gap-2 px-5 py-3.5">
          Sort
        </button>
      </div>
    </div>
  );
}
