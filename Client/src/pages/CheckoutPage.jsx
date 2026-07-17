import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import api from '../api/http';

export default function CheckoutPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const slug = params.get('slug');
  const checkin = params.get('checkin');
  const checkout = params.get('checkout');
  const guests = params.get('guests') || '2';

  const [form, setForm] = useState({
    guest_name: '',
    guest_email: '',
    guest_phone: '',
    payment_method: 'instapay',
    promo_code: '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const summary = useMemo(
    () => ({ slug, checkin, checkout, guests }),
    [slug, checkin, checkout, guests]
  );

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/bookings/checkout', {
        ...summary,
        ...form,
        guests: Number(guests),
        callback_url: `${window.location.origin}/checkout/payment/callback`,
      });
      if (data.redirectToPaymob && data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      navigate(`/booking-success?id=${data.booking?.id || ''}`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-xl px-5 py-12">
        <h1 className="font-display text-4xl text-soul-blue">Checkout</h1>
        <p className="mt-2 text-soul-muted text-sm">
          {slug} · {checkin} → {checkout} · {guests} guests
        </p>
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          {['guest_name', 'guest_email', 'guest_phone'].map((k) => (
            <label key={k} className="block text-sm capitalize">
              {k.replace('guest_', '').replace('_', ' ')}
              <input
                required={k !== 'guest_email'}
                type={k.includes('email') ? 'email' : 'text'}
                className="mt-1 w-full border border-soul-line rounded-xl px-3 py-2"
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </label>
          ))}
          <label className="block text-sm">
            Payment method
            <select
              className="mt-1 w-full border border-soul-line rounded-xl px-3 py-2"
              value={form.payment_method}
              onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
            >
              <option value="instapay">InstaPay</option>
              <option value="cash">Cash / Hold</option>
              <option value="paymob_card" disabled>
                Card (Paymob) — Coming soon
              </option>
            </select>
          </label>
          <label className="block text-sm">
            Promo code
            <input
              className="mt-1 w-full border border-soul-line rounded-xl px-3 py-2"
              value={form.promo_code}
              onChange={(e) => setForm({ ...form, promo_code: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            Notes
            <textarea
              className="mt-1 w-full border border-soul-line rounded-xl px-3 py-2"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button disabled={busy || !slug} className="w-full btn-pill bg-soul-blue text-white py-3 font-semibold disabled:opacity-40">
            {busy ? 'Processing…' : 'Submit request'}
          </button>
          <p className="text-xs text-soul-muted text-center">
            Requests stay pending until Soul staff accepts. Unpaid holds expire automatically.
          </p>
        </form>
        <Link to={`/listings/${slug}`} className="block text-center text-sm mt-4 text-soul-muted">
          Back to listing
        </Link>
      </main>
      <Footer />
    </div>
  );
}
