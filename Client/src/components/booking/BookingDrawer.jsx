import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Minus, Plus, ShieldCheck, UserRound, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import api, { validatePromoCode } from '../../api/http';
import ListingDatePicker, { isoToLocalDate, localDateToIso } from '../listing/ListingDatePicker';
import { getMinimumStayNights } from '../../utils/bookingRules';

const money = (n) => `EGP ${Number(n || 0).toLocaleString('en-US')}`;

/** Adults = 1, children = 0.5 — same load rules as SoulHospitality. */
function getGuestLoad(adults, children) {
  return Number(adults || 0) + Number(children || 0) * 0.5;
}

function rangeHitsBlocked(checkin, checkout, blockedDates = []) {
  if (!checkin || !checkout || !blockedDates.length) return false;
  const set = new Set(blockedDates);
  for (let t = new Date(`${checkin}T00:00:00`); localDateToIso(t) < checkout; t.setDate(t.getDate() + 1)) {
    if (set.has(localDateToIso(t))) return true;
  }
  return false;
}

function IncrementControl({ label, hint, value, onIncrement, onDecrement, min = 0 }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-soul-line bg-white px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-soul-blue">{label}</p>
        {hint && <p className="text-xs text-soul-muted">{hint}</p>}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onDecrement}
          disabled={value <= min}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-soul-line text-soul-muted hover:border-soul-blue hover:text-soul-blue disabled:opacity-40"
          aria-label={`Decrease ${label}`}
        >
          <Minus className="h-3.5 w-3.5" strokeWidth={2.2} />
        </button>
        <span className="min-w-8 text-center text-sm font-semibold">{value}</span>
        <button
          type="button"
          onClick={onIncrement}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-soul-line text-soul-muted hover:border-soul-blue hover:text-soul-blue"
          aria-label={`Increase ${label}`}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}

/**
 * SoulHospitality-style reservation drawer → proceeds to /checkout/payment.
 */
export default function BookingDrawer({
  open,
  onClose,
  unit,
  blockedDates = [],
  dailyPrices = {},
  initialCheckin = '',
  initialCheckout = '',
  initialGuests = { adults: 1, children: 0, infants: 0 },
  initialQuote = null,
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [message, setMessage] = useState('');
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [promo, setPromo] = useState({ code: '', percentage: 0, discountAmount: 0, isValid: false, loading: false });
  const [quote, setQuote] = useState(initialQuote);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [formState, setFormState] = useState({
    checkInDate: initialCheckin || '',
    checkOutDate: initialCheckout || '',
    adults: initialGuests.adults || 1,
    children: initialGuests.children || 0,
    infants: initialGuests.infants || 0,
    fullName: '',
    identityDocuments: [],
    phone: '',
    secondaryPhone: '',
    email: '',
    notes: '',
  });

  const minNights = getMinimumStayNights(unit);
  const capacity = Number(unit?.guests || unit?.capacity) || 8;
  const guestLoad = useMemo(
    () => getGuestLoad(formState.adults, formState.children),
    [formState.adults, formState.children]
  );
  const overCapacity = guestLoad > capacity;

  useEffect(() => {
    if (!open) return;
    setFormState((cur) => ({
      ...cur,
      checkInDate: initialCheckin || cur.checkInDate,
      checkOutDate: initialCheckout || cur.checkOutDate,
      adults: initialGuests.adults || cur.adults,
      children: initialGuests.children || cur.children,
      infants: initialGuests.infants || cur.infants,
    }));
    if (initialQuote) setQuote(initialQuote);
  }, [open, initialCheckin, initialCheckout, initialGuests, initialQuote]);

  useEffect(() => {
    if (!user) return;
    setFormState((cur) => ({
      ...cur,
      fullName: cur.fullName || user.full_name || user.user_metadata?.full_name || '',
      phone: cur.phone || user.phone || '',
      email: cur.email || user.email || '',
    }));
  }, [user]);

  useEffect(() => {
    if (!open) {
      setMessage('');
      setPromoCodeInput('');
      setPromo({ code: '', percentage: 0, discountAmount: 0, isValid: false, loading: false });
    }
  }, [open]);

  useEffect(() => {
    if (!open || !unit?.slug || !formState.checkInDate || !formState.checkOutDate) {
      return undefined;
    }
    let cancelled = false;
    setQuoteLoading(true);
    const guests = Number(formState.adults || 0) + Number(formState.children || 0);
    api
      .get(`/units/${unit.slug}/quote`, {
        params: {
          checkin: formState.checkInDate,
          checkout: formState.checkOutDate,
          adults: formState.adults,
          teens: formState.children,
          guests,
        },
      })
      .then((r) => {
        if (!cancelled) setQuote(r.data);
      })
      .catch(() => {
        if (!cancelled) setQuote(null);
      })
      .finally(() => {
        if (!cancelled) setQuoteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, unit?.slug, formState.checkInDate, formState.checkOutDate, formState.adults, formState.children]);

  const nights = quote?.nights || 0;
  const belowMinimumStay = nights > 0 && nights < minNights;
  const isOverlapping = useMemo(
    () => rangeHitsBlocked(formState.checkInDate, formState.checkOutDate, blockedDates),
    [formState.checkInDate, formState.checkOutDate, blockedDates]
  );

  const subtotal = Number(quote?.subtotal || 0);
  const cleaning = Number(quote?.cleaning_fee_egp || 0);
  const access = Number(quote?.access_fee_egp || 0);
  const service = Number(quote?.service_fee_egp || 0);
  const gross = Number(quote?.total_egp || 0);
  const nightlyRate = nights > 0 && subtotal > 0 ? Math.round(subtotal / nights) : Number(unit?.price_fallback || 0);

  const promoDiscount = promo.isValid
    ? promo.percentage > 0
      ? Math.round(gross * (promo.percentage / 100))
      : Number(promo.discountAmount || 0)
    : 0;
  const finalTotal = Math.max(0, gross - promoDiscount);

  if (!open) return null;

  const isGuest = !user?.id;

  function handleChange(field, value) {
    setFormState((cur) => ({ ...cur, [field]: value }));
  }

  function handleIdentityDocumentsChange(event) {
    const selectedFiles = Array.from(event.target.files || []).slice(0, 2);
    setFormState((cur) => ({ ...cur, identityDocuments: selectedFiles }));
  }

  async function handlePromoValidation() {
    const code = String(promoCodeInput || '').trim();
    if (!code) {
      setPromo({ code: '', percentage: 0, discountAmount: 0, isValid: false, loading: false });
      return;
    }
    setPromo((p) => ({ ...p, loading: true }));
    setMessage('');
    try {
      const result = await validatePromoCode({ code, amount: gross });
      setPromo({
        code: result.code,
        percentage: result.percentage,
        discountAmount: result.discountAmount,
        isValid: true,
        loading: false,
      });
      setMessage(`Promo code applied: ${result.code}.`);
    } catch (err) {
      setPromo({ code: '', percentage: 0, discountAmount: 0, isValid: false, loading: false });
      setMessage(err.message || 'Invalid promo code');
    }
  }

  function handleSubmit(event) {
    event?.preventDefault?.();
    setMessage('');

    if (!user?.id) {
      setMessage('Please sign in or create an account to continue.');
      return;
    }
    if (!formState.checkInDate || !formState.checkOutDate) {
      setMessage('Please choose both check-in and check-out dates.');
      return;
    }
    if (!String(formState.fullName || '').trim()) {
      setMessage('Full legal name is required.');
      return;
    }
    if (!String(formState.phone || '').trim()) {
      setMessage('Phone number is required.');
      return;
    }
    if (!String(formState.email || '').trim()) {
      setMessage('Email address is required.');
      return;
    }
    if (!quote?.available) {
      setMessage(quote?.reason || 'These dates are not available.');
      return;
    }
    if (belowMinimumStay) {
      setMessage(`Minimum stay is ${minNights} nights for this unit.`);
      return;
    }
    if (!formState.identityDocuments?.length) {
      setMessage('Please upload at least one National ID or Passport photo.');
      return;
    }
    if (isOverlapping) {
      setMessage('The requested dates overlap with a blocked or reserved night.');
      return;
    }

    const checkoutState = {
      unit,
      formState,
      quote,
      nights,
      nightlyRate,
      subtotalAmount: subtotal,
      cleaningFee: cleaning,
      accessFee: access,
      serviceFee: service,
      feeLines: quote?.lines || [],
      grossAmount: gross,
      discountPercentage: promo.percentage,
      discountAmount: promoDiscount,
      finalTotalAmount: finalTotal,
      promoCode: promo.isValid ? promo.code : '',
      totalAmount: finalTotal,
    };

    onClose?.();
    navigate('/checkout/payment', { state: checkoutState });
  }

  const signInRedirect = `/sign-in?next=${encodeURIComponent(`/listings/${unit?.slug || ''}`)}`;

  return (
    <div className="fixed inset-0 z-[240] flex justify-end bg-slate-950/55 backdrop-blur-[2px]">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close booking drawer" onClick={onClose} />

      <aside className="relative flex h-full w-full max-w-none flex-col bg-white shadow-2xl lg:ml-auto lg:max-w-[50.4rem] lg:border-l lg:border-soul-line">
        <div className="flex items-center justify-between border-b border-soul-line px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-soul-muted">Reservation Drawer</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-soul-blue">
              Book {unit?.title || 'this residence'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-soul-line text-soul-muted hover:border-soul-blue hover:text-soul-blue"
            aria-label="Close drawer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isGuest ? (
            <div className="flex min-h-[60vh] items-center justify-center">
              <div className="w-full rounded-3xl border border-soul-line bg-soul-blue-50 p-6 text-center">
                <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-white text-soul-blue shadow-sm">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <h3 className="font-display text-2xl font-semibold text-soul-blue">Sign in required</h3>
                <p className="mt-2 text-sm leading-6 text-soul-muted">
                  Create an account or sign in first so we can prefill your profile and secure this reservation.
                </p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                  <Link
                    to={signInRedirect}
                    className="rounded-full bg-soul-blue px-5 py-3 text-sm font-semibold text-white hover:bg-soul-blue-dark"
                  >
                    Sign in
                  </Link>
                  <Link
                    to="/sign-up"
                    className="rounded-full border border-soul-line bg-white px-5 py-3 text-sm font-semibold text-soul-blue hover:border-soul-blue"
                  >
                    Create account
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted">
                    Check-in / Check-out
                  </p>
                  <ListingDatePicker
                    inline
                    value={{
                      start: isoToLocalDate(formState.checkInDate),
                      end: isoToLocalDate(formState.checkOutDate),
                    }}
                    onChange={({ start, end }) => {
                      setFormState((cur) => ({
                        ...cur,
                        checkInDate: start ? localDateToIso(start) : '',
                        checkOutDate: end ? localDateToIso(end) : '',
                      }));
                      setMessage('');
                    }}
                    blockedDates={blockedDates}
                    dailyPrices={dailyPrices}
                    minNights={minNights}
                  />
                  {isOverlapping && (
                    <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                      Selected nights overlap a blocked or reserved date.
                    </p>
                  )}
                  {belowMinimumStay && (
                    <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                      Minimum stay is {minNights} nights for this unit.
                    </p>
                  )}
                </div>

                <IncrementControl
                  label="Adults"
                  hint="Ages 12+"
                  value={formState.adults}
                  min={1}
                  onDecrement={() => handleChange('adults', Math.max(1, Number(formState.adults || 1) - 1))}
                  onIncrement={() => handleChange('adults', Number(formState.adults || 1) + 1)}
                />
                <IncrementControl
                  label="Children"
                  hint="Ages 0-12"
                  value={formState.children}
                  min={0}
                  onDecrement={() => handleChange('children', Math.max(0, Number(formState.children || 0) - 1))}
                  onIncrement={() => handleChange('children', Number(formState.children || 0) + 1)}
                />

                <div
                  className={`md:col-span-2 rounded-2xl border px-4 py-3 text-sm ${
                    overCapacity
                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                      : 'border-soul-line bg-[#faf9f7] text-soul-muted'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-soul-blue">Guest load</span>
                    <span className="font-semibold text-soul-blue">
                      {guestLoad} / {capacity}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5">
                    Adults count as 1 guest and children count as 0.5 guest.
                  </p>
                  {overCapacity && (
                    <p className="mt-2 text-xs font-semibold">
                      You can still book above capacity, but you&apos;ll pay for each extra guest
                      (higher beach-access / extra-guest rate).
                    </p>
                  )}
                </div>

                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted md:col-span-2">
                  Full Legal Name
                  <div className="flex items-center gap-3 rounded-2xl border border-soul-line bg-white px-4 py-3 focus-within:border-soul-blue">
                    <UserRound className="h-4 w-4 text-soul-muted" />
                    <input
                      value={formState.fullName}
                      onChange={(e) => handleChange('fullName', e.target.value)}
                      className="w-full bg-transparent text-sm outline-none"
                      placeholder="Enter full legal name"
                      required
                    />
                  </div>
                </label>

                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted md:col-span-2">
                  National ID / Passport Photos
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    multiple
                    onChange={handleIdentityDocumentsChange}
                    className="rounded-2xl border border-soul-line bg-white px-4 py-3 text-sm outline-none focus:border-soul-blue"
                    required
                  />
                  <p className="text-[11px] normal-case tracking-normal text-soul-muted">
                    Upload clear photos of your National ID or Passport (up to 2 images).
                  </p>
                  {formState.identityDocuments.length > 0 && (
                    <ul className="space-y-1 text-[11px] normal-case tracking-normal text-soul-muted">
                      {formState.identityDocuments.map((file) => (
                        <li key={`${file.name}-${file.lastModified}`}>{file.name}</li>
                      ))}
                    </ul>
                  )}
                </label>

                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted">
                  Phone Number
                  <input
                    value={formState.phone}
                    onChange={(e) => handleChange('phone', e.target.value)}
                    className="rounded-2xl border border-soul-line bg-white px-4 py-3 text-sm outline-none focus:border-soul-blue"
                    placeholder="Primary phone"
                    required
                  />
                </label>
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted">
                  Secondary Phone
                  <input
                    value={formState.secondaryPhone}
                    onChange={(e) => handleChange('secondaryPhone', e.target.value)}
                    className="rounded-2xl border border-soul-line bg-white px-4 py-3 text-sm outline-none focus:border-soul-blue"
                    placeholder="Optional"
                  />
                </label>

                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted md:col-span-2">
                  Email Address
                  <div className="flex items-center gap-3 rounded-2xl border border-soul-line bg-white px-4 py-3 focus-within:border-soul-blue">
                    <Mail className="h-4 w-4 text-soul-muted" />
                    <input
                      type="email"
                      value={formState.email}
                      onChange={(e) => handleChange('email', e.target.value)}
                      className="w-full bg-transparent text-sm outline-none"
                      placeholder="Enter email address"
                      required
                    />
                  </div>
                </label>

                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted md:col-span-2">
                  Notes
                  <textarea
                    value={formState.notes}
                    onChange={(e) => handleChange('notes', e.target.value)}
                    rows={4}
                    className="rounded-2xl border border-soul-line bg-white px-4 py-3 text-sm outline-none focus:border-soul-blue"
                    placeholder="Any special request or booking note"
                  />
                </label>

                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-soul-muted md:col-span-2">
                  Promotional Code
                  <div className="flex gap-3">
                    <input
                      value={promoCodeInput}
                      onChange={(e) => setPromoCodeInput(e.target.value)}
                      className="w-full rounded-2xl border border-soul-line bg-white px-4 py-3 text-sm outline-none focus:border-soul-blue"
                      placeholder="Enter promo code"
                    />
                    <button
                      type="button"
                      onClick={handlePromoValidation}
                      disabled={promo.loading || !gross}
                      className="inline-flex items-center justify-center rounded-2xl bg-soul-blue px-4 py-3 text-xs font-semibold uppercase tracking-widest text-white hover:bg-soul-blue-dark disabled:opacity-70"
                    >
                      {promo.loading ? 'Checking' : 'Verify'}
                    </button>
                  </div>
                  {promo.isValid && (
                    <p className="text-xs font-semibold text-emerald-600">{promo.code} applied successfully.</p>
                  )}
                </label>
              </div>
            </form>
          )}
        </div>

        {!isGuest && (
          <div className="border-t border-soul-line bg-white px-6 py-5">
            <div className="grid gap-3 rounded-3xl border border-soul-line bg-soul-blue-50/40 p-4">
              <div className="flex items-center justify-between text-sm text-soul-muted">
                <span>Nightly rate</span>
                <span className="font-semibold text-soul-blue">{money(nightlyRate)}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-soul-muted">
                <span>Subtotal ({nights || '—'} nights)</span>
                <span className="font-semibold text-soul-blue">{money(subtotal)}</span>
              </div>
              {cleaning > 0 && (
                <div className="flex items-center justify-between text-sm text-soul-muted">
                  <span>Cleaning</span>
                  <span className="font-semibold text-soul-blue">{money(cleaning)}</span>
                </div>
              )}
              {access > 0 && (
                <div className="flex items-center justify-between text-sm text-soul-muted">
                  <span>Access / beach passes</span>
                  <span className="font-semibold text-soul-blue">{money(access)}</span>
                </div>
              )}
              {service > 0 && (
                <div className="flex items-center justify-between text-sm text-soul-muted">
                  <span>Service fee</span>
                  <span className="font-semibold text-soul-blue">{money(service)}</span>
                </div>
              )}
              {promo.isValid && (
                <div className="flex items-center justify-between text-sm text-emerald-700">
                  <span>Promo discount</span>
                  <span className="font-semibold">− {money(promoDiscount)}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm text-soul-muted border-t border-soul-line pt-3">
                <span>Estimated total</span>
                <span className="text-lg font-bold text-soul-blue">
                  {quoteLoading ? '…' : money(finalTotal)}
                </span>
              </div>
              {!quote?.available && quote && (
                <p className="text-xs text-rose-600">{quote.reason || 'Unavailable for these dates'}</p>
              )}
            </div>

            {message && (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{message}</div>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={isOverlapping || belowMinimumStay || !quote?.available || quoteLoading}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-soul-blue px-5 py-4 text-xs font-semibold uppercase tracking-widest text-white hover:bg-soul-blue-dark disabled:opacity-70 disabled:cursor-not-allowed"
            >
              Proceed to Payment
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
