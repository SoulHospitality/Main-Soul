import { useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import PartnersSection from '../components/home/PartnersSection';
import { ArrowDot, PageHero, Reveal, RevealLines, SectionHead } from '../components/ui/Editorial';
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
  const [active, setActive] = useState(0);
  const storyParagraphs = [t('about.story1'), t('about.story2')];
  const values = VALUE_KEYS.map((key, i) => ({
    title: t(`about.${key}Title`),
    image: VALUE_IMAGES[i],
    body: t(`about.${key}Body`),
  }));

  return (
    <div className="bg-soul-paper">
      <Header overHero />

      <PageHero
        image="/soul-brand/coast-hero-2.jpg"
        eyebrow={brand.name}
        lead={t('about.titleBefore')}
        em={t('about.titleEm')}
        body={t('about.heroBody')}
      >
        <div className="flex flex-wrap gap-3">
          <Link to="/careers" className="g-btn g-btn-light">
            {t('about.workWithUs')}
            <ArrowDot />
          </Link>
          <Link to="/contact" className="g-btn g-btn-glass">
            {t('about.contact')}
          </Link>
        </div>
      </PageHero>

      <section className="g-shell grid gap-12 py-24 md:py-32 lg:grid-cols-[minmax(0,3fr)_minmax(0,9fr)] lg:gap-16">
        <Reveal className="flex items-center gap-3 self-start text-soul-muted">
          <span className="g-index">(01)</span>
          <span className="h-px w-8 bg-soul-blue/25" />
          <span className="g-index">{t('about.storyEyebrow')}</span>
        </Reveal>
        <div>
          <RevealLines
            className="g-display text-[clamp(40px,5.4vw,84px)] text-soul-blue"
            lines={[t('about.storyTitleBefore'), <em key="em">{t('about.storyTitleEm')}</em>]}
          />
          <div className="mt-12 grid gap-8 border-t border-soul-line pt-10 md:grid-cols-2 md:gap-12">
            {storyParagraphs.map((paragraph, i) => (
              <Reveal
                key={paragraph.slice(0, 24)}
                as="p"
                delay={i * 120}
                className="text-[15px] leading-[1.85] text-soul-muted md:text-base"
              >
                {paragraph}
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="g-grain relative isolate overflow-hidden bg-soul-blue-dark py-24 text-white md:py-32">
        <div className="g-shell relative z-[2]">
          <SectionHead
            dark
            index="02"
            eyebrow={t('about.valuesEyebrow')}
            lead={t('about.valuesTitle')}
          />

          <div className="mt-16 grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-20">
            <ul className="border-t border-white/10">
              {values.map((item, i) => {
                const on = i === active;
                return (
                  <Reveal
                    as="li"
                    key={item.title}
                    delay={i * 60}
                    className="border-b border-white/10"
                    onMouseEnter={() => setActive(i)}
                  >
                    <button
                      type="button"
                      onClick={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      className="grid w-full grid-cols-[2.5rem_1fr] gap-4 py-6 text-start"
                    >
                      <span className={`g-index pt-3 transition-colors ${on ? 'text-white' : 'text-white/40'}`}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span>
                        <span
                          className={`g-display block text-[clamp(34px,3.6vw,56px)] transition-all duration-700 ease-soul ${
                            on ? 'italic text-white' : 'text-white/45'
                          }`}
                        >
                          {item.title}
                        </span>
                        <span
                          className={`grid transition-all duration-700 ease-soul ${
                            on ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                          }`}
                        >
                          <span className="overflow-hidden text-[15px] leading-relaxed text-white/65">{item.body}</span>
                        </span>
                      </span>
                    </button>
                  </Reveal>
                );
              })}
            </ul>

            <div className="relative hidden lg:block">
              <div className="sticky top-28 aspect-[4/5] overflow-hidden rounded-[32px]">
                {values.map((item, i) => (
                  <img
                    key={item.image}
                    src={item.image}
                    alt={i === active ? item.title : ''}
                    loading="lazy"
                    className={`absolute inset-0 h-full w-full object-cover transition-all duration-[1100ms] ease-soul ${
                      i === active ? 'scale-100 opacity-100' : 'scale-110 opacity-0'
                    }`}
                  />
                ))}
                <div className="absolute inset-0 bg-gradient-to-t from-soul-ink/60 via-transparent to-transparent" />
                <span className="g-index absolute bottom-6 end-6 text-white/75">
                  {String(active + 1).padStart(2, '0')} / {String(values.length).padStart(2, '0')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <PartnersSection />

      <Footer />
    </div>
  );
}
