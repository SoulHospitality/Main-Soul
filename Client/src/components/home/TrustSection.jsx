import { BadgeCheck, HeartHandshake, MessageCircle } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';

export default function TrustSection() {
  const { t } = useLocale();

  const pillars = [
    {
      icon: BadgeCheck,
      title: t('home.verifiedTitle'),
      body: t('home.verifiedBody'),
    },
    {
      icon: MessageCircle,
      title: t('home.seamlessTitle'),
      body: t('home.seamlessBody'),
    },
    {
      icon: HeartHandshake,
      title: t('home.dedicatedTitle'),
      body: t('home.dedicatedBody'),
    },
  ];

  return (
    <section className="bg-soul-ivory">
      <div className="mx-auto max-w-soul px-5 sm:px-8 py-16 md:py-20">
        <div className="mb-10 max-w-xl">
          <p className="soul-eyebrow text-soul-muted mb-2">{t('home.trustEyebrow')}</p>
          <h2 className="font-display text-3xl md:text-4xl text-soul-blue">
            {t('home.trustTitle')}
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-8 md:gap-10">
          {pillars.map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <div className="h-11 w-11 rounded-full border border-soul-line grid place-items-center text-soul-blue mb-4">
                <Icon size={20} strokeWidth={1.6} />
              </div>
              <h3 className="font-semibold text-soul-blue text-lg">{title}</h3>
              <p className="mt-2 text-soul-muted text-sm leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
