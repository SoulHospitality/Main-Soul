import { Link } from 'react-router-dom';
import { useLocale } from '../../context/LocaleContext';

export default function HostCta() {
  const { t } = useLocale();

  return (
    <section className="mx-auto max-w-soul px-5 sm:px-8 py-16 md:py-20">
      <div className="grid md:grid-cols-2 rounded-3xl overflow-hidden border border-soul-line min-h-[320px]">
        <div className="relative min-h-[220px] md:min-h-0">
          <img
            src="/soul-v2/interlude.jpg"
            alt={t('home.hostImageAlt')}
            className="absolute inset-0 h-full w-full object-cover"
            onError={(e) => {
              e.currentTarget.src = '/soul-brand/coast-hero-2.jpg';
            }}
          />
        </div>
        <div className="bg-soul-blue-dark text-white p-8 md:p-12 flex flex-col justify-center">
          <p className="soul-eyebrow text-white/55 mb-3">{t('home.hostEyebrow')}</p>
          <h2 className="font-display text-3xl md:text-[2.4rem] leading-tight">
            {t('home.hostTitle')}
          </h2>
          <p className="mt-4 text-white/75 leading-relaxed max-w-md">
            {t('home.hostBody')}
          </p>
          <Link
            to="/owners"
            className="mt-8 inline-flex self-start btn-pill bg-white text-soul-blue px-6 py-3 font-semibold hover:bg-soul-ivory transition"
          >
            {t('home.hostCta')}
          </Link>
        </div>
      </div>
    </section>
  );
}
