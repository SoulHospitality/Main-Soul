import { Link, useSearchParams } from 'react-router-dom';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import { useLocale } from '../context/LocaleContext';

export default function BookingSuccessPage() {
  const { t } = useLocale();
  const [params] = useSearchParams();
  return (
    <div>
      <Header />
      <main className="mx-auto max-w-lg px-5 py-20 text-center">
        <h1 className="font-display text-4xl text-soul-blue">{t('bookingSuccess.title')}</h1>
        <p className="mt-4 text-soul-muted">
          {t('bookingSuccess.body', { id: params.get('id') || t('bookingSuccess.pending') })}
        </p>
        <Link to="/" className="inline-block mt-8 btn-pill bg-soul-blue text-white px-6 py-3 font-semibold">
          {t('bookingSuccess.backHome')}
        </Link>
      </main>
      <Footer />
    </div>
  );
}
