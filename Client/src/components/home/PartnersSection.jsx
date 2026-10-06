import { useLocale } from '../../context/LocaleContext';
import { Marquee, Reveal } from '../ui/Editorial';

const DEFAULT_PARTNERS = [
  {
    label: 'Tatweer Misr',
    src: 'https://res.cloudinary.com/zqhyzmvl/image/upload/v1784205791/Tatweer-Misr-removebg-preview_xjltqj.png',
  },
  {
    label: 'Sabbour Consulting',
    src: 'https://res.cloudinary.com/zqhyzmvl/image/upload/v1784205791/Sabbour-removebg-preview_dwdeem.png',
  },
  {
    label: 'Palm Hills',
    src: 'https://res.cloudinary.com/zqhyzmvl/image/upload/v1784205791/Palm-Hills-removebg-preview_xnnjvq.png',
  },
  {
    label: 'Mountain View',
    src: 'https://res.cloudinary.com/zqhyzmvl/image/upload/v1784205735/images__2_-removebg-preview_w5bwps.png',
  },
  {
    label: 'Emaar',
    src: 'https://res.cloudinary.com/zqhyzmvl/image/upload/v1783598502/Emaar-Properties_rbhrww.png',
  },
];

function PartnerLogo({ partner, className = '' }) {
  return (
    <img
      src={partner.src}
      alt={partner.label}
      className={`max-h-full max-w-full object-contain opacity-55 grayscale transition duration-500 hover:opacity-100 hover:grayscale-0 ${className}`}
      loading="lazy"
      decoding="async"
    />
  );
}

export default function PartnersSection({ eyebrow, title, className = '', variant = 'section', partners: partnersProp }) {
  const { t } = useLocale();
  const PARTNERS = partnersProp?.length ? partnersProp.map((p) => ({ label: p.label || '', src: p.src })) : DEFAULT_PARTNERS;
  const resolvedEyebrow = eyebrow ?? t('home.partnersEyebrow');
  const resolvedTitle = title ?? t('home.partnersTitle');

  if (variant === 'strip') {
    return (
      <section className={`g-guides border-b border-soul-line bg-soul-paper ${className}`.trim()}>
        <div className="g-shell grid items-center gap-6 py-8 lg:grid-cols-[minmax(0,240px)_1fr] lg:gap-12 lg:py-10">
          <p className="g-index flex items-center gap-3 text-soul-muted">
            <span className="g-dot shrink-0" />
            {t('home.partnersStrip')}
          </p>
          <div className="hidden items-center justify-between gap-10 lg:flex">
            {PARTNERS.map((partner) => (
              <div key={partner.src} className="flex h-14 w-[150px] items-center justify-center">
                <PartnerLogo partner={partner} />
              </div>
            ))}
          </div>
          <Marquee duration={26} gap="3.5rem" className="g-fade-x lg:hidden">
            {PARTNERS.map((partner) => (
              <div key={partner.src} className="flex h-12 w-[120px] shrink-0 items-center justify-center">
                <PartnerLogo partner={partner} />
              </div>
            ))}
          </Marquee>
        </div>
      </section>
    );
  }

  return (
    <section className={`border-y border-soul-line bg-soul-paper py-20 md:py-24 ${className}`.trim()}>
      <div className="g-shell flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <Reveal>
          <div className="mb-4 flex items-center gap-3 text-soul-muted">
            <span className="g-dot" />
            <span className="g-index">{resolvedEyebrow}</span>
          </div>
          <h2 className="g-display text-[clamp(36px,4.2vw,60px)] text-soul-blue">{resolvedTitle}</h2>
        </Reveal>
      </div>

      <Marquee duration={32} gap="5rem" className="mt-14">
        {[...PARTNERS, ...PARTNERS].map((partner, i) => (
          <div key={`${partner.src}-${i}`} className="flex h-20 w-[170px] shrink-0 items-center justify-center md:h-24">
            <PartnerLogo partner={partner} />
          </div>
        ))}
      </Marquee>
    </section>
  );
}
