import { Link, useSearchParams } from 'react-router-dom';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';

export default function PaymentCallbackPage() {
  const [params] = useSearchParams();
  const status = params.get('status') || 'success';
  const bookingId = params.get('booking_id');
  const ok = status === 'success';

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-lg px-5 py-20 text-center">
        <h1 className="font-display text-4xl text-soul-blue">
          {ok ? 'Payment callback received' : 'Payment incomplete'}
        </h1>
        <p className="mt-4 text-soul-muted">
          {ok
            ? `Your payment was submitted${bookingId ? ` for booking ${bookingId}` : ''}. Your stay request remains Pending until Soul staff accepts — typically within 24 hours.`
            : 'Something went wrong with the payment gateway. You can return to the listing and try again, or inquire on WhatsApp.'}
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/search" className="btn-pill bg-soul-blue text-white px-6 py-3 font-semibold">
            Browse stays
          </Link>
          {ok && (
            <Link to="/account" className="btn-pill border border-soul-line px-6 py-3 font-semibold text-soul-blue">
              My account
            </Link>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
