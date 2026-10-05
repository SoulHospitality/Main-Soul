import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import CompoundGrid from '../components/home/CompoundGrid';
import { PageHero, Reveal } from '../components/ui/Editorial';
import { useLocale } from '../context/LocaleContext';

export default function StaticPage({ title, eyebrow, children, wide = false }) {
  return (
    <div className="bg-soul-paper">
      <Header />
      <main>
        <PageHero index="✦" eyebrow={eyebrow || 'Soul Hospitality'} lead={title} compact />
        <div className="g-shell pb-10">
          <Reveal
            className={`border-t border-soul-line pt-10 text-[16px] leading-[1.85] text-soul-blue/85 [&>p+p]:mt-5 ${
              wide ? '' : 'max-w-3xl'
            }`}
          >
            {children}
          </Reveal>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export function CompoundsPage() {
  const { t } = useLocale();
  return (
    <div className="bg-soul-paper">
      <Header />
      <main>
        <PageHero index="✦" eyebrow={t('nav.destinations')} lead={t('compoundsPage.title')} body={t('compoundsPage.body')} compact />
        <CompoundGrid showHead={false} />
      </main>
      <Footer />
    </div>
  );
}

export function FaqPage() {
  const { t } = useLocale();
  return (
    <StaticPage title={t('faq.title')} eyebrow={t('nav.faq')}>
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
    <StaticPage title={title} eyebrow={t('legal.fallback')}>
      <p>{t('legal.placeholder', { title })}</p>
    </StaticPage>
  );
}
