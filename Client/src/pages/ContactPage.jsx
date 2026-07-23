import { Mail, MapPin, MessageCircle } from 'lucide-react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import { brand, whatsappHref } from '../theme/brand';
import { useLocale } from '../context/LocaleContext';

export default function ContactPage() {
  const { t } = useLocale();
  const channels = [
    {
      label: t('contact.email'),
      description: t('contact.emailDesc'),
      href: `mailto:${brand.email}`,
      icon: Mail,
    },
    {
      label: t('contact.whatsapp'),
      description: t('contact.whatsappDesc'),
      href: whatsappHref(''),
      target: '_blank',
      rel: 'noopener noreferrer',
      icon: MessageCircle,
    },
    {
      label: t('contact.location'),
      description: t('contact.locationDesc'),
      href: brand.mapsUrl,
      target: '_blank',
      rel: 'noopener noreferrer',
      icon: MapPin,
    },
  ];

  return (
    <div>
      <Header />
      <main className="bg-slate-50">
        <section className="mx-auto max-w-soul px-5 sm:px-8 py-12 lg:py-16">
          <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="space-y-6">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">{t('contact.eyebrow')}</p>
              <h1 className="font-display text-4xl font-semibold text-soul-blue sm:text-5xl">
                {t('contact.title')}
              </h1>
              <p className="max-w-xl text-sm leading-7 text-slate-600 sm:text-base sm:leading-8">
                {t('contact.subtitle')}
              </p>

              <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {t('contact.headOffice')}
                </p>
                <p className="text-sm text-slate-600">{brand.address}</p>
                <p className="text-sm text-slate-600">{brand.phoneDisplay}</p>
                <p className="text-sm text-slate-600">{brand.email}</p>
              </div>
            </div>

            <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:p-8">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {t('contact.channels')}
                </p>
                <h2 className="font-display text-2xl font-semibold text-slate-900 sm:text-3xl">
                  {t('contact.choosePath')}
                </h2>
                <p className="text-sm leading-7 text-slate-600">
                  {t('contact.channelsBody')}
                </p>
              </div>

              <div className="space-y-3">
                {channels.map(({ label, description, href, target, rel, icon: Icon }) => (
                  <a
                    key={label}
                    href={href}
                    target={target}
                    rel={rel}
                    className="group flex items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-soul-blue transition-all hover:border-soul-blue hover:bg-slate-50"
                  >
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-soul-blue transition-colors group-hover:border-soul-blue group-hover:bg-soul-blue group-hover:text-white">
                      <Icon className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                    </span>
                    <span className="flex-1">
                      <span className="block text-sm font-semibold text-slate-900">{label}</span>
                      <span className="block text-sm text-slate-500">{description}</span>
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 transition-colors group-hover:text-soul-blue">
                      {t('contact.open')}
                    </span>
                  </a>
                ))}
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50 px-5 py-4 text-sm text-slate-500">
                <p className="font-semibold text-slate-700">{t('contact.headOffice')}</p>
                <p>{brand.address}</p>
                <p>{brand.phoneDisplay}</p>
                <p>{brand.email}</p>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
