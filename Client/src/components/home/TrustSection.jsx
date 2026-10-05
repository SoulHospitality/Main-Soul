import { BadgeCheck, HeartHandshake, MessageCircle } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';
import { Reveal, SectionHead } from '../ui/Editorial';

function trackPointer(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`);
}

export default function TrustSection() {
  const { t } = useLocale();

  const pillars = [
    { icon: BadgeCheck, title: t('home.verifiedTitle'), body: t('home.verifiedBody') },
    { icon: MessageCircle, title: t('home.seamlessTitle'), body: t('home.seamlessBody') },
    { icon: HeartHandshake, title: t('home.dedicatedTitle'), body: t('home.dedicatedBody') },
  ];

  return (
    <section className="g-grain relative isolate overflow-hidden bg-soul-blue-dark py-24 text-white md:py-32">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(900px 520px at 10% 0%, rgba(40,63,94,0.9), transparent 60%), radial-gradient(700px 420px at 100% 100%, rgba(19,78,94,0.55), transparent 60%)',
        }}
      />
      <div className="g-shell relative z-[2]">
        <SectionHead
          dark
          index="04"
          eyebrow={t('home.trustEyebrow')}
          lead={t('home.trustLead')}
          em={t('home.trustEm')}
        />

        <div className="mt-14 grid gap-4 md:mt-20 md:grid-cols-2 lg:grid-cols-4 lg:grid-rows-[minmax(260px,auto)_minmax(260px,auto)]">
          <Reveal
            variant="mask"
            className="relative min-h-[340px] overflow-hidden rounded-[28px] md:col-span-2 lg:row-span-2"
          >
            <img
              src="/soul-brand/coast-3.jpg"
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-soul-ink/80 via-soul-ink/10 to-transparent" />
            <div className="absolute inset-x-7 bottom-7">
              <span className="g-index text-white/70">{t('home.regions')}</span>
              <p className="g-display mt-3 text-[clamp(34px,3.6vw,56px)] italic">{t('home.heroPhrase1')}</p>
            </div>
          </Reveal>

          {pillars.map(({ icon: Icon, title, body }, i) => (
            <Reveal
              key={title}
              delay={120 + i * 110}
              onMouseMove={trackPointer}
              className={`g-spot flex flex-col justify-between gap-10 rounded-[28px] border border-white/10 bg-white/[0.035] p-7 transition-colors duration-500 hover:border-white/20 md:p-8 ${
                i === 0 ? 'md:col-span-2' : ''
              }`}
            >
              <div className="flex items-start justify-between">
                <span className="grid h-12 w-12 place-items-center rounded-full border border-white/15 text-white">
                  <Icon size={20} strokeWidth={1.5} />
                </span>
                <span className="g-index text-white/40">{String(i + 1).padStart(2, '0')}</span>
              </div>
              <div>
                <h3 className="g-display text-[clamp(28px,2.4vw,38px)]">{title}</h3>
                <p className="mt-3 max-w-md text-[15px] leading-relaxed text-white/60">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
