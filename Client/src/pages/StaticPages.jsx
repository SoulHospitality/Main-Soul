import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import CompoundGrid from '../components/home/CompoundGrid';
import { useLocale } from '../context/LocaleContext';

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
  const { t } = useLocale();
  return (
    <div>
      <Header />
      <main className="py-8">
        <div className="mx-auto max-w-soul px-5 sm:px-8 mb-2">
          <h1 className="font-display text-4xl text-soul-blue">{t('compoundsPage.title')}</h1>
          <p className="mt-3 text-soul-muted max-w-2xl">{t('compoundsPage.body')}</p>
        </div>
        <CompoundGrid />
      </main>
      <Footer />
    </div>
  );
}

export function FaqPage() {
  const { t } = useLocale();
  return (
    <StaticPage title={t('faq.title')}>
      <p>{t('faq.body')}</p>
    </StaticPage>
  );
}

export function LegalPage({ kind }) {
  const { t } = useLocale();
  const titles = {
    terms: t('legal.terms'),
    privacy: t('legal.privacy'),
    'refund-policy': t('legal.refund'),
  };
  const title = titles[kind] || t('legal.fallback');
  return (
    <StaticPage title={title}>
      <p>{t('legal.placeholder', { title })}</p>
    </StaticPage>
  );
}
