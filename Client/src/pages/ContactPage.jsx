import { ArrowUpRight, Mail, MapPin, MessageCircle } from 'lucide-react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import { PageHero, Reveal } from '../components/ui/Editorial';
import { brand, whatsappHref } from '../theme/brand';
import { useLocale } from '../context/LocaleContext';

export default function ContactPage() {
  const { t } = useLocale();
  const channels = [
    {
      label: t('contact.whatsapp'),
      description: t('contact.whatsappDesc'),
      value: brand.phoneDisplay,
      href: whatsappHref(''),
      target: '_blank',
      rel: 'noopener noreferrer',
      icon: MessageCircle,
    },
    {
      label: t('contact.email'),
      description: t('contact.emailDesc'),
      value: brand.email,
      href: `mailto:${brand.email}`,
      icon: Mail,
    },
    {
      label: t('contact.location'),
      description: t('contact.locationDesc'),
      value: brand.address,
      href: brand.mapsUrl,
      target: '_blank',
      rel: 'noopener noreferrer',
      icon: MapPin,
    },
  ];

  return (
    <div className="bg-soul-paper">
      <Header />
      <main>
        <PageHero index="01" eyebrow={t('contact.eyebrow')} lead={t('contact.title')} body={t('contact.subtitle')} compact />

        <section className="g-shell pb-10">
          <div className="mb-8 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div className="flex items-center gap-3 text-soul-muted">
              <span className="g-dot" />
              <span className="g-index">{t('contact.channels')}</span>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-soul-muted md:text-end">{t('contact.channelsBody')}</p>
          </div>

          <ul className="border-t border-soul-line">
            {channels.map(({ label, description, value, href, target, rel, icon: Icon }, i) => (
              <Reveal as="li" key={label} delay={i * 90} className="border-b border-soul-line">
                <a
                  href={href}
                  target={target}
                  rel={rel}
                  className="group grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 py-8 md:grid-cols-[3rem_1.1fr_1fr_auto] md:gap-8 md:py-10"
                >
                  <span className="g-index text-soul-muted transition-colors group-hover:text-soul-accent">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0">
                    <span className="g-display block text-[clamp(40px,5vw,76px)] text-soul-blue transition-all duration-700 ease-soul group-hover:translate-x-2 group-hover:italic rtl:group-hover:-translate-x-2">
                      {label}
                    </span>
                    <span className="mt-1 block text-sm text-soul-muted md:hidden">{value}</span>
                  </span>
                  <span className="hidden flex-col gap-1 md:flex">
                    <span className="text-[15px] font-medium text-soul-blue">{value}</span>
                    <span className="text-sm text-soul-muted">{description}</span>
                  </span>
                  <span className="grid h-14 w-14 place-items-center rounded-full border border-soul-line text-soul-blue transition-all duration-500 ease-soul group-hover:border-soul-blue group-hover:bg-soul-blue group-hover:text-white">
                    <Icon className="h-5 w-5 group-hover:hidden" strokeWidth={1.6} aria-hidden="true" />
                    <ArrowUpRight className="hidden h-5 w-5 group-hover:block rtl:-scale-x-100" strokeWidth={1.6} aria-hidden="true" />
                  </span>
                </a>
              </Reveal>
            ))}
          </ul>
        </section>

        <section className="g-shell py-16">
          <Reveal className="grid overflow-hidden rounded-[32px] border border-soul-line bg-white md:grid-cols-2">
            <div className="relative min-h-[260px]">
              <img src="/soul-brand/coast-4.jpg" alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
            </div>
            <div className="flex flex-col justify-center gap-6 p-8 md:p-12">
              <span className="g-index text-soul-muted">{t('contact.headOffice')}</span>
              <h2 className="g-display text-[clamp(36px,3.6vw,52px)] text-soul-blue">{brand.name}</h2>
              <dl className="border-t border-soul-line text-[15px]">
                {[brand.address, brand.phoneDisplay, brand.email].map((line) => (
                  <div key={line} className="border-b border-soul-line py-3.5 text-soul-blue">
                    {line}
                  </div>
                ))}
              </dl>
            </div>
          </Reveal>
        </section>
      </main>
      <Footer />
    </div>
  );
}
