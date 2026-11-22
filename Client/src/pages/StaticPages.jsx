import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import CompoundGrid from '../components/home/CompoundGrid';
import { PageHero, Reveal } from '../components/ui/Editorial';
import { Link } from 'react-router-dom';
import { useLocale } from '../context/LocaleContext';
import { brand } from '../theme/brand';

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

const LEGAL_UPDATED = '2026-11-22';

export function LegalPage({ kind }) {
  const { t, localeTag } = useLocale();
  const titles = {
    terms: t('legal.terms'),
    privacy: t('legal.privacy'),
    'refund-policy': t('legal.refund'),
    delivery: t('legal.delivery'),
  };
  const title = titles[kind] || t('legal.fallback');
  const page = t(`legal.pages.${kind}`);
  const content = page && typeof page === 'object' ? page : null;
  const updated = new Date(`${LEGAL_UPDATED}T00:00:00Z`).toLocaleDateString(localeTag, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const links = [
    ['/terms', 'legal.terms'],
    ['/privacy', 'legal.privacy'],
    ['/refund-policy', 'legal.refund'],
    ['/delivery-policy', 'legal.delivery'],
  ];

  return (
    <StaticPage title={title} eyebrow={t('legal.fallback')}>
      <p className="text-sm text-soul-muted">{t('legal.updated', { date: updated })}</p>
      {content ? (
        <>
          <p>{content.intro}</p>
          {(content.sections || []).map((s) => (
            <section key={s.h} className="mt-10">
              <h2 className="g-display text-[clamp(24px,2.4vw,32px)] text-soul-blue">{s.h}</h2>
              {s.p.length > 1 ? (
                <ul className="mt-4 list-disc space-y-2 ps-5 marker:text-soul-blue/40">
                  {s.p.map((line) => <li key={line}>{line}</li>)}
                </ul>
              ) : (
                <p className="mt-4">{s.p[0]}</p>
              )}
            </section>
          ))}
        </>
      ) : null}
      <p className="mt-12 rounded-2xl border border-soul-line bg-white p-6 text-[15px]">
        {t('legal.questions', { email: brand.email, phone: brand.phoneDisplay, address: brand.address })}
      </p>
      <nav className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label={t('legal.fallback')}>
        {links.map(([to, key]) => (
          <Link key={to} to={to} className="g-link text-soul-blue">{t(key)}</Link>
        ))}
      </nav>
    </StaticPage>
  );
}
