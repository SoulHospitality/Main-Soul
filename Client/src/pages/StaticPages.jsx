import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import CompoundGrid from '../components/home/CompoundGrid';

export default function StaticPage({ title, children, wide = false }) {
  return (
    <div>
      <Header />
      <main className={`mx-auto px-5 py-12 ${wide ? 'max-w-soul' : 'max-w-3xl'}`}>
        <h1 className="font-display text-4xl text-soul-blue">{title}</h1>
        <div className="mt-6 prose prose-slate text-soul-blue/90 leading-relaxed space-y-4">{children}</div>
      </main>
      <Footer />
    </div>
  );
}

export function CompoundsPage() {
  return (
    <div>
      <Header />
      <main className="py-8">
        <div className="mx-auto max-w-soul px-5 sm:px-8 mb-2">
          <h1 className="font-display text-4xl text-soul-blue">Destinations & Projects</h1>
          <p className="mt-3 text-soul-muted max-w-2xl">
            Browse destinations (areas) and their projects (compounds). Use search to filter homes.
          </p>
        </div>
        <CompoundGrid />
      </main>
      <Footer />
    </div>
  );
}

export function FaqPage() {
  return (
    <StaticPage title="FAQ">
      <p>Bookings can be completed online via Paymob or confirmed with our team after an inquiry. Pricing is nightly and sourced from live daily rates.</p>
    </StaticPage>
  );
}

export function LegalPage({ kind }) {
  const titles = {
    terms: 'Terms',
    privacy: 'Privacy',
    'refund-policy': 'Refund policy',
  };
  return (
    <StaticPage title={titles[kind] || 'Legal'}>
      <p>Legal copy for {titles[kind]}. Replace with final counsel-approved text before production launch.</p>
    </StaticPage>
  );
}
