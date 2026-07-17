import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Banknote, Building2, Calendar, CreditCard, ShieldCheck, Wallet } from 'lucide-react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import { createBookingCheckout } from '../api/http';
import { BOOKING_POLICIES } from '../constants/bookingPolicies';

const money = (n) => `EGP ${Number(n || 0).toLocaleString('en-US')}`;

/**
 * SoulHospitality-style payment page — Paymob card / InstaPay / cash.
 * Expects router state from BookingDrawer.
 */
export default function PaymentPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const checkoutState = location.state;
  const [selectedMethod, setSelectedMethod] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [successCard, setSuccessCard] = useState(null);

  if (!checkoutState) {
    return (
      <div>
        <Header />
        <main className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
          <div className="max-w-md rounded-3xl border border-soul-line bg-white p-8 shadow-xl">
            <h2 className="font-display text-2xl font-semibold text-soul-blue">No booking data found</h2>
            <p className="mt-3 text-sm text-soul-muted">
              Start from a listing and use Request to book to open checkout.
            </p>
            <Link
              to="/search"
              className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-soul-blue px-6 py-3 text-sm font-semibold text-white hover:bg-soul-blue-dark"
            >
              <ArrowLeft className="h-4 w-4" /> Browse stays
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (successCard) {
    return (
      <div>
        <Header />
        <main className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
          <div className="max-w-xl rounded-3xl border border-soul-line bg-white p-8 shadow-xl">
            <h2 className="font-display text-2xl font-semibold text-soul-blue">Reservation request submitted</h2>
            <p className="mt-3 text-sm text-soul-muted">{successCard.description}</p>
            <p className="mt-2 text-sm text-soul-muted">
              Your request stays pending until Soul staff accepts. We typically reply within 24 hours.
            </p>
            <button
              type="button"
              onClick={() => navigate('/search')}
              className="mt-6 rounded-full bg-soul-blue px-6 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-white hover:bg-soul-blue-dark"
            >
              Back to stays
            </button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const {
    unit,
    formState,
    quote,
    nights,
    nightlyRate,
    subtotalAmount,
    cleaningFee,
    accessFee,
    serviceFee,
    feeLines = [],
    grossAmount,
    discountPercentage,
    discountAmount,
    finalTotalAmount,
    promoCode,
  } = checkoutState;

  async function handleConfirmReservation() {
    if (!selectedMethod) {
      setMessage('Please select a payment method first.');
      return;
    }
    const identityDocuments = Array.isArray(formState?.identityDocuments) ? formState.identityDocuments : [];
    if (!identityDocuments.length) {
      setMessage('Please upload ID or passport photos before confirming payment.');
      return;
    }

    setSubmitting(true);
    setMessage('');

    try {
      const payload = new FormData();
      payload.append('slug', unit?.slug || '');
      payload.append('checkin', formState.checkInDate || '');
      payload.append('checkout', formState.checkOutDate || '');
      payload.append(
        'guests',
        String(Number(formState.adults || 0) + Number(formState.children || 0))
      );
      payload.append('guest_name', formState.fullName || '');
      payload.append('guest_phone', formState.phone || '');
      payload.append('guest_email', formState.email || '');
      payload.append(
        'notes',
        [formState.notes, formState.secondaryPhone ? `Secondary phone: ${formState.secondaryPhone}` : '']
          .filter(Boolean)
          .join('\n')
      );
      payload.append('payment_method', selectedMethod);
      if (promoCode) payload.append('promo_code', promoCode);
      payload.append('callback_url', `${window.location.origin}/checkout/payment/callback`);
      identityDocuments.forEach((file) => payload.append('id_photos', file));

      const data = await createBookingCheckout(payload);

      if (selectedMethod === 'paymob_card') {
        if (data.redirectToPaymob && data.checkoutUrl) {
          window.location.assign(data.checkoutUrl);
          return;
        }
        setMessage('Card checkout is not configured yet. Please try InstaPay or cash, or contact Soul.');
        return;
      }

      if (selectedMethod === 'instapay') {
        setSuccessCard({
          description:
            'InstaPay reservation request is marked as Pending. You will receive an official response within 24 hours.',
        });
        return;
      }

      setSuccessCard({
        description:
          'Cash reservation request recorded as Pending. A deposit clearance may be required to confirm your booking.',
      });
    } catch (err) {
      setMessage(err.response?.data?.error || err.message || 'Unable to complete reservation.');
    } finally {
      setSubmitting(false);
    }
  }

  const methodLabel =
    selectedMethod === 'paymob_card' ? 'Paymob' : selectedMethod === 'instapay' ? 'InstaPay' : 'Cash';

  return (
    <div>
      <Header />
      <main className="min-h-screen bg-[#f7f8fb] px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-6xl">
          <div className="mb-8">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-2 text-sm font-medium text-soul-muted hover:text-soul-blue"
            >
              <ArrowLeft className="h-4 w-4" /> Back to reservation details
            </button>
            <h1 className="mt-3 font-display text-3xl font-semibold text-soul-blue md:text-4xl">Secure Checkout</h1>
            <p className="mt-1.5 text-sm text-soul-muted">Choose how you&apos;d like to pay — requests stay pending until staff accept.</p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8">
            <div className="order-1 lg:order-2 lg:col-span-4">
              <div className="rounded-3xl border border-soul-line bg-white p-6 shadow-sm lg:sticky lg:top-24">
                <h2 className="text-lg font-bold text-soul-blue">Reservation Summary</h2>

                <div className="mt-4 border-b border-soul-line pb-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-soul-muted">
                    {unit?.compound || unit?.area || unit?.project}
                  </p>
                  <h3 className="mt-1 text-sm font-bold text-soul-blue">{unit?.title}</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-soul-muted">
                      <Building2 className="h-3 w-3" /> {unit?.property_type || 'Residence'}
                    </span>
                  </div>
                </div>

                <div className="mt-4 space-y-3 border-b border-soul-line pb-4">
                  <div className="flex items-center gap-3 text-xs text-soul-muted">
                    <Calendar className="h-4 w-4 text-soul-blue" />
                    <div>
                      <p className="font-semibold text-soul-blue">Check-in</p>
                      <p>{formState.checkInDate}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-soul-muted">
                    <Calendar className="h-4 w-4 text-soul-blue" />
                    <div>
                      <p className="font-semibold text-soul-blue">Check-out</p>
                      <p>{formState.checkOutDate}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-xs text-soul-muted">
                  <div className="flex justify-between">
                    <span>Nightly rate</span>
                    <span className="font-semibold text-soul-blue">{money(nightlyRate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Duration</span>
                    <span className="font-semibold text-soul-blue">
                      {nights} {nights === 1 ? 'night' : 'nights'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span className="font-semibold text-soul-blue">{money(subtotalAmount)}</span>
                  </div>
                  {(feeLines.length ? feeLines : [
                    cleaningFee > 0 && { key: 'cleaning', label: 'Cleaning', amount: cleaningFee },
                    accessFee > 0 && { key: 'access', label: 'Access / beach', amount: accessFee },
                    serviceFee > 0 && { key: 'service', label: 'Service fee', amount: serviceFee },
                  ].filter(Boolean)
                  ).map((line) => (
                    <div key={line.key || line.label} className="flex justify-between">
                      <span>{line.label}</span>
                      <span className="font-semibold text-soul-blue">{money(line.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between">
                    <span>Invoice before discount</span>
                    <span className="font-semibold text-soul-blue">{money(grossAmount ?? quote?.total_egp)}</span>
                  </div>
                  {promoCode ? (
                    <div className="flex justify-between text-emerald-700">
                      <span>
                        Promo {promoCode}
                        {discountPercentage ? ` (${discountPercentage}%)` : ''}
                      </span>
                      <span className="font-semibold">− {money(discountAmount)}</span>
                    </div>
                  ) : null}
                  <div className="mt-2 flex items-baseline justify-between border-t border-soul-line pt-3">
                    <span className="text-sm font-bold text-soul-blue">Final total</span>
                    <span className="font-display text-xl font-semibold text-soul-blue">
                      {money(finalTotalAmount)}
                    </span>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                  <h3 className="text-sm font-bold text-rose-900">Booking Policies</h3>
                  <ul className="mt-3 space-y-2 text-xs text-rose-700">
                    {BOOKING_POLICIES.map((policy) => (
                      <li key={policy} className="flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-rose-600 flex-none" />
                        <span>{policy}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="order-2 space-y-6 lg:order-1 lg:col-span-8">
              <div className="rounded-3xl border border-soul-line bg-white p-6 shadow-sm sm:p-8">
                <h2 className="text-xl font-bold text-soul-blue">Select payment method</h2>
                <p className="mt-1 text-sm text-soul-muted">
                  Choose one option below to submit your reservation request.
                </p>

                <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <MethodCard
                    active={selectedMethod === 'instapay'}
                    onClick={() => { setSelectedMethod('instapay'); setMessage(''); }}
                    icon={<Wallet className="h-6 w-6" strokeWidth={1.8} />}
                    iconClass="bg-indigo-50 text-indigo-600"
                    activeClass="border-indigo-600 bg-indigo-50/20 ring-indigo-600/10"
                    title="InstaPay"
                    subtitle="Instant mobile bank transfer"
                    badgeActive="bg-indigo-100 text-indigo-700"
                  />
                  <MethodCard
                    disabled
                    comingSoon
                    active={false}
                    onClick={() => {}}
                    icon={<CreditCard className="h-6 w-6" strokeWidth={1.8} />}
                    iconClass="bg-slate-100 text-slate-400"
                    activeClass=""
                    title="Card (Paymob)"
                    subtitle="Debit or credit card"
                    badgeActive=""
                  />
                  <MethodCard
                    active={selectedMethod === 'cash'}
                    onClick={() => { setSelectedMethod('cash'); setMessage(''); }}
                    icon={<Banknote className="h-6 w-6" strokeWidth={1.8} />}
                    iconClass="bg-emerald-50 text-emerald-600"
                    activeClass="border-emerald-600 bg-emerald-50/20 ring-emerald-600/10"
                    title="Cash"
                    subtitle="Pay on arrival / hold"
                    badgeActive="bg-emerald-100 text-emerald-700"
                  />
                </div>

                {selectedMethod && (
                  <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                    <div className="flex gap-3">
                      <ShieldCheck className="h-5 w-5 text-rose-700 flex-shrink-0" />
                      <div>
                        <h4 className="text-sm font-bold text-rose-900">Ready to confirm via {methodLabel}</h4>
                        <p className="mt-1 text-xs leading-5 text-rose-700">
                          {selectedMethod === 'cash'
                            ? 'Cash bookings are submitted as Pending and reviewed manually. A deposit may be required.'
                            : selectedMethod === 'instapay'
                              ? 'InstaPay requests are submitted with Pending status. You will receive an official response within 24 hours.'
                              : 'You will be redirected to Paymob. After payment, your request remains Pending until staff accept.'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {message && <p className="mt-4 text-sm text-rose-600">{message}</p>}

                <button
                  type="button"
                  onClick={handleConfirmReservation}
                  disabled={!selectedMethod || submitting}
                  className="mt-6 inline-flex items-center justify-center rounded-full bg-soul-blue px-6 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-white hover:bg-soul-blue-dark disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Processing…' : 'Confirm Reservation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function MethodCard({
  active,
  onClick,
  icon,
  iconClass,
  activeClass,
  title,
  subtitle,
  badgeActive,
  disabled = false,
  comingSoon = false,
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled}
      className={`relative flex flex-col items-center justify-between rounded-3xl border-2 p-5 text-center transition-all ${
        disabled
          ? 'cursor-not-allowed border-soul-line/70 bg-slate-50 opacity-55'
          : active
            ? `${activeClass} shadow-md ring-2`
            : 'border-soul-line bg-white hover:border-soul-blue/40 hover:shadow-sm'
      }`}
    >
      {comingSoon ? (
        <span className="absolute right-3 top-3 rounded-full bg-slate-200/90 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
          Coming soon
        </span>
      ) : null}
      <div className={`flex h-12 w-12 items-center justify-center rounded-full ${iconClass}`}>{icon}</div>
      <div className="mt-4">
        <h3 className={`text-sm font-bold ${disabled ? 'text-slate-500' : 'text-soul-blue'}`}>{title}</h3>
        <p className="mt-1 text-xs text-soul-muted">{subtitle}</p>
      </div>
      <span
        className={`mt-4 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
          comingSoon
            ? 'bg-slate-200 text-slate-600'
            : active
              ? badgeActive
              : 'bg-soul-blue-50 text-soul-muted'
        }`}
      >
        {comingSoon ? 'Coming soon' : active ? 'Selected' : 'Select'}
      </span>
    </button>
  );
}
