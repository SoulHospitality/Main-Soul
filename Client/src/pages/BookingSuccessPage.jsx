import { Link, useSearchParams } from 'react-router-dom';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';

export default function BookingSuccessPage() {
  const [params] = useSearchParams();
  return (
    <div>
      <Header />
      <main className="mx-auto max-w-lg px-5 py-20 text-center">
        <h1 className="font-display text-4xl text-soul-blue">Request received</h1>
        <p className="mt-4 text-soul-muted">
          Booking reference {params.get('id') || 'pending'}. Your request is awaiting confirmation from our team — we will confirm or follow up shortly.
        </p>
        <Link to="/" className="inline-block mt-8 btn-pill bg-soul-blue text-white px-6 py-3 font-semibold">
          Back home
        </Link>
      </main>
      <Footer />
    </div>
  );
}
