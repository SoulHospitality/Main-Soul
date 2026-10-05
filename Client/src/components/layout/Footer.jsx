import { Link, useLocation } from 'react-router-dom';
import { ArrowUp } from 'lucide-react';
import { brand, whatsappHref, listingWhatsAppMessage } from '../../theme/brand';
import { useLocale } from '../../context/LocaleContext';
import { ArrowDot, Reveal, RevealLines, useCairoTime } from '../ui/Editorial';
import { FacebookIcon, InstagramIcon, WhatsAppIcon } from './SocialIcons';

function FooterLink({ label, href }) {
  return (
    <Link to={href} className="g-link w-fit text-[15px] text-white/70 transition-colors hover:text-white">
      {label}
    </Link>
  );
}

function FooterColumn({ title, children }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="g-index mb-2 text-white/40">{title}</p>
      {children}
    </div>
  );
}

export default function Footer() {
  const { t } = useLocale();
  const { pathname } = useLocation();
  const time = useCairoTime();

  return (
    <footer className="g-grain relative mt-20 overflow-hidden bg-soul-ink text-white sm:mt-24">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(1100px 600px at 100% 0%, rgba(40,63,94,0.75), transparent 60%), radial-gradient(800px 480px at 0% 100%, rgba(242,140,40,0.10), transparent 60%)',
        }}
      />

      <div className="g-shell relative z-[2]">
        <div className="grid gap-10 border-b border-white/10 py-20 md:py-28 lg:grid-cols-[1.4fr_1fr] lg:items-end">
          <div>
            <Reveal className="mb-6 flex items-center gap-3 text-white/55">
              <span className="g-dot" />
              <span className="g-index">{t('footer.ctaEyebrow')}</span>
            </Reveal>
            <RevealLines
              className="g-display text-[clamp(48px,7.4vw,118px)]"
              lines={[t('footer.ctaLead'), <em key="em">{t('footer.ctaEm')}</em>]}
            />
          </div>
          <Reveal delay={200} className="flex flex-col gap-6 lg:items-end lg:text-end">
            <p className="max-w-md text-[15px] leading-relaxed text-white/65">{t('footer.ctaBody')}</p>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <a
                href={whatsappHref(listingWhatsAppMessage(pathname))}
                target="_blank"
                rel="noreferrer"
                className="g-btn g-btn-light"
              >
                <WhatsAppIcon className="h-4 w-4 text-[#25d366]" />
                {t('nav.whatsappUs')}
                <ArrowDot />
              </a>
              <Link to="/contact" className="g-btn g-btn-glass">
                {t('footer.contact')}
              </Link>
            </div>
          </Reveal>
        </div>

        <div className="grid grid-cols-2 gap-10 py-14 md:grid-cols-4 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div className="col-span-2 flex flex-col gap-5 md:col-span-4 lg:col-span-1">
            <img
              src="/soul-brand/soul-logo.png"
              alt={brand.name}
              className="h-16 w-auto self-start object-contain brightness-0 invert"
            />
            <p className="max-w-sm text-sm leading-7 text-white/55">{t('footer.tagline')}</p>
            <div className="flex items-center gap-2">
              <a
                href={brand.social.instagram}
                target="_blank"
                rel="noreferrer"
                aria-label={t('footer.instagram')}
                className="grid h-10 w-10 place-items-center rounded-full border border-white/15 text-white/80 transition-colors hover:bg-white hover:text-soul-ink"
              >
                <InstagramIcon className="h-4 w-4" />
              </a>
              <a
                href={brand.social.facebook}
                target="_blank"
                rel="noreferrer"
                aria-label={t('footer.facebook')}
                className="grid h-10 w-10 place-items-center rounded-full border border-white/15 text-white/80 transition-colors hover:bg-white hover:text-soul-ink"
              >
                <FacebookIcon className="h-4 w-4" />
              </a>
            </div>
          </div>

          <FooterColumn title={t('footer.explore')}>
            <FooterLink label={t('nav.stays')} href="/search" />
            <FooterLink label={t('nav.longTerm')} href="/long-term" />
            <FooterLink label={t('nav.destinations')} href="/compounds" />
            <FooterLink label={t('nav.wishlist')} href="/wishlist" />
          </FooterColumn>

          <FooterColumn title={t('footer.company')}>
            <FooterLink label={t('nav.about')} href="/about" />
            <FooterLink label={t('nav.becomeAHost')} href="/owners" />
            <FooterLink label={t('footer.workWithUs')} href="/careers" />
            <FooterLink label={t('nav.faq')} href="/faq" />
            <FooterLink label={t('footer.contact')} href="/contact" />
          </FooterColumn>

          <FooterColumn title={t('footer.reachUs')}>
            <a href={brand.mapsUrl} target="_blank" rel="noreferrer" className="g-link w-fit text-[15px] text-white/70 hover:text-white">
              {brand.address}
            </a>
            <a href={`tel:${brand.phoneDisplay}`} className="g-link w-fit font-num text-[15px] text-white/70 hover:text-white">
              {brand.phoneDisplay}
            </a>
            <a href={`mailto:${brand.email}`} className="g-link w-fit text-[15px] text-white/70 hover:text-white">
              {brand.email}
            </a>
          </FooterColumn>
        </div>
      </div>

      <div className="relative z-[2] overflow-hidden">
        <div className="g-ghost select-none whitespace-nowrap text-center text-[clamp(140px,31vw,520px)]" aria-hidden="true">
          Soul
        </div>
      </div>

      <div className="g-shell relative z-[2]">
        <div className="flex flex-col gap-4 border-t border-white/10 py-6 text-white/45 sm:flex-row sm:items-center sm:justify-between">
          <span className="g-index">{brand.copyright}</span>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link to="/terms" className="g-index g-link hover:text-white">{t('legal.terms')}</Link>
            <Link to="/privacy" className="g-index g-link hover:text-white">{t('legal.privacy')}</Link>
            <Link to="/refund-policy" className="g-index g-link hover:text-white">{t('legal.refund')}</Link>
            <span className="g-index">
              {t('nav.localTime')} · {time}
            </span>
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="g-index inline-flex items-center gap-2 text-white/70 transition-colors hover:text-white"
            >
              {t('footer.backToTop')}
              <span className="grid h-8 w-8 place-items-center rounded-full border border-white/20">
                <ArrowUp size={14} />
              </span>
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
