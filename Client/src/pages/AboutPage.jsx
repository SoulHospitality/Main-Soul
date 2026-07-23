import { Link } from 'react-router-dom';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import PartnersSection from '../components/home/PartnersSection';
import { brand } from '../theme/brand';
import { useLocale } from '../context/LocaleContext';

const VALUE_IMAGES = [
  '/soul-brand/coast-1.jpg',
  '/soul-brand/coast-2.jpg',
  '/soul-v2/interlude.jpg',
  '/soul-brand/coast-3.jpg',
  '/soul-brand/coast-4.jpg',
  '/soul-brand/coast-hero-3.jpg',
];

const VALUE_KEYS = ['quality', 'teamwork', 'respect', 'integrity', 'responsibility', 'innovative'];

export default function AboutPage() {
  const { t } = useLocale();
  const storyParagraphs = [t('about.story1'), t('about.story2')];
  const values = VALUE_KEYS.map((key, i) => ({
    title: t(`about.${key}Title`),
    image: VALUE_IMAGES[i],
    body: t(`about.${key}Body`),
  }));

  return (
    <div className="bg-white">
      <Header overHero />

      {/* Hero — full-bleed, brand first */}
      <section className="relative isolate min-h-[72svh] overflow-hidden md:min-h-[78svh]">
        <img
          src="/soul-brand/coast-hero-2.jpg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-soul-ink/45" />
        <div className="absolute inset-0 bg-gradient-to-r from-soul-ink/70 via-soul-ink/35 to-transparent" />

        <div className="relative mx-auto flex min-h-[72svh] max-w-soul flex-col justify-end px-5 pb-14 pt-32 sm:px-8 md:min-h-[78svh] md:pb-20">
          <p className="soul-eyebrow mb-4 text-white/70">{brand.name}</p>
          <h1
            className="font-display font-semibold leading-[0.95] text-white"
            style={{ fontSize: 'clamp(40px, 7vw, 80px)' }}
          >
            {t('about.titleBefore')} <em className="italic font-normal">{t('about.titleEm')}</em>
          </h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-white/85 md:text-lg">
            {t('about.heroBody')}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/careers"
              className="btn-pill inline-flex items-center justify-center bg-white px-6 py-3 text-sm font-semibold text-soul-blue transition hover:-translate-y-0.5 hover:bg-soul-ivory"
            >
              {t('about.workWithUs')}
            </Link>
            <Link
              to="/contact"
              className="btn-pill inline-flex items-center justify-center border border-white/40 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur-sm transition hover:-translate-y-0.5 hover:bg-white/20"
            >
              {t('about.contact')}
            </Link>
          </div>
        </div>
      </section>

      {/* Our Story */}
      <section className="mx-auto max-w-soul px-5 py-16 sm:px-8 md:py-20">
        <p className="soul-eyebrow text-soul-muted mb-2">{t('about.storyEyebrow')}</p>
        <h2 className="font-display text-3xl text-soul-blue md:text-4xl">
          {t('about.storyTitleBefore')}{' '}
          <em className="italic font-normal">{t('about.storyTitleEm')}</em>
        </h2>
        <div className="mt-8 grid gap-8 md:grid-cols-2 md:gap-12">
          {storyParagraphs.map((paragraph) => (
            <p key={paragraph.slice(0, 24)} className="text-sm leading-relaxed text-soul-muted md:text-[15px] md:leading-7">
              {paragraph}
            </p>
          ))}
        </div>
      </section>

      {/* Our Values */}
      <section className="border-t border-soul-line bg-soul-ivory/60 py-16 md:py-20">
        <div className="mx-auto max-w-soul px-5 sm:px-8">
          <p className="soul-eyebrow text-soul-muted mb-2">{t('about.valuesEyebrow')}</p>
          <h2 className="font-display text-3xl text-soul-blue md:text-4xl">
            {t('about.valuesTitle')}
          </h2>

          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 lg:gap-7">
            {values.map((item) => (
              <article key={item.title} className="group">
                <div className="relative aspect-[4/3] overflow-hidden rounded-2xl">
                  <img
                    src={item.image}
                    alt={item.title}
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    loading="lazy"
                  />
                </div>
                <h3 className="mt-4 font-display text-xl text-soul-blue">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-soul-muted">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <PartnersSection />

      <Footer />
    </div>
  );
}
