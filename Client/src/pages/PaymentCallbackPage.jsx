import { Link, useSearchParams } from 'react-router-dom';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import { useLocale } from '../context/LocaleContext';

export default function PaymentCallbackPage() {
  const { t } = useLocale();
  const [params] = useSearchParams();
  const status = params.get('status') || 'success';
  const bookingId = params.get('booking_id');
  const ok = status === 'success';

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-lg px-5 py-20 text-center">
        <h1 className="font-display text-4xl text-soul-blue">
          {ok ? t('payment.callbackOkTitle') : t('payment.callbackFailTitle')}
        </h1>
        <p className="mt-4 text-soul-muted">
          {ok
            ? t('payment.callbackOkBody', {
                booking: bookingId ? t('payment.callbackOkBooking', { id: bookingId }) : '',
              })
            : t('payment.callbackFailBody')}
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/search" className="btn-pill bg-soul-blue text-white px-6 py-3 font-semibold">
            {t('payment.browseStays')}
          </Link>
          {ok && (
            <Link to="/account" className="btn-pill border border-soul-line px-6 py-3 font-semibold text-soul-blue">
              {t('payment.myAccount')}
            </Link>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
