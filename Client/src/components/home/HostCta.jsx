import { Link } from 'react-router-dom';
import { useLocale } from '../../context/LocaleContext';
import { ArrowDot, Reveal, RevealLines } from '../ui/Editorial';

export default function HostCta() {
  const { t } = useLocale();
  const points = [t('owners.bullet0'), t('owners.bullet1'), t('owners.bullet2')];

  return (
    <section className="bg-soul-paper py-24 md:py-32">
      <div className="g-shell grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-20">
        <Reveal variant="mask" className="relative aspect-[5/6] overflow-hidden rounded-[32px] sm:aspect-[4/3] lg:aspect-[5/6]">
          <img
            src="/soul-v2/interlude.jpg"
            alt={t('home.hostImageAlt')}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
            onError={(e) => {
              e.currentTarget.src = '/soul-brand/coast-hero-2.jpg';
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-soul-ink/50 via-transparent to-transparent" />
          <div className="absolute bottom-6 start-6 rounded-full border border-white/30 bg-white/15 px-4 py-2 text-white backdrop-blur-md">
            <span className="g-index">{t('home.hostEyebrow')}</span>
          </div>
        </Reveal>

        <div>
          <Reveal className="mb-6 flex items-center gap-3 text-soul-muted">
            <span className="g-index">(05)</span>
            <span className="h-px w-8 bg-soul-blue/25" />
            <span className="g-index">{t('home.hostEyebrow')}</span>
          </Reveal>
          <RevealLines
            className="g-display text-[clamp(44px,5.4vw,84px)] text-soul-blue"
            lines={[t('home.hostTitleLead'), <em key="em">{t('home.hostTitleEm')}</em>]}
          />
          <Reveal delay={150} as="p" className="mt-6 max-w-md text-[15px] leading-relaxed text-soul-muted md:text-base">
            {t('home.hostBody')}
          </Reveal>

          <ul className="mt-10 border-t border-soul-line">
            {points.map((point, i) => (
              <Reveal
                as="li"
                key={point}
                delay={200 + i * 90}
                className="flex items-baseline gap-5 border-b border-soul-line py-4 text-[15px] text-soul-blue"
              >
                <span className="g-index text-soul-accent">{String(i + 1).padStart(2, '0')}</span>
                {point}
              </Reveal>
            ))}
          </ul>

          <Reveal delay={450} className="mt-10">
            <Link to="/owners" className="g-btn g-btn-primary">
              {t('home.hostCta')}
              <ArrowDot />
            </Link>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
