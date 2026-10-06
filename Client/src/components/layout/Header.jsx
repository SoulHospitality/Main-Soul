import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Globe, Heart, User, X } from 'lucide-react';
import { brand, whatsappHref, listingWhatsAppMessage } from '../../theme/brand';
import { useCurrency } from '../../context/CurrencyContext';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../context/LocaleContext';
import { useCairoTime } from '../ui/Editorial';
import { FacebookIcon, InstagramIcon, WhatsAppIcon } from './SocialIcons';

const NAV = [
  { key: 'nav.stays', to: '/search', match: (p) => p.startsWith('/search') || p.startsWith('/listings') },
  { key: 'nav.about', to: '/about', match: (p) => p.startsWith('/about') },
  { key: 'nav.becomeAHost', to: '/owners', match: (p) => p.startsWith('/owners') || p.startsWith('/host-onboarding') },
  { key: 'nav.faq', to: '/faq', match: (p) => p.startsWith('/faq') },
];

const MENU_ITEMS = [
  { key: 'nav.stays', to: '/search', img: '/soul-brand/coast-hero-1.jpg' },
  { key: 'nav.destinations', to: '/compounds', img: '/compounds/fouka-bay.jpg' },
  { key: 'nav.about', to: '/about', img: '/soul-v2/interlude.jpg' },
  { key: 'nav.becomeAHost', to: '/owners', img: '/soul-brand/coast-3.jpg' },
  { key: 'nav.contact', to: '/contact', img: '/soul-brand/coast-4.jpg' },
];

function MenuGlyph({ open }) {
  return (
    <span className="relative block h-3 w-[18px]" aria-hidden="true">
      <span
        className={`absolute start-0 top-0 h-[1.5px] w-full bg-current transition-transform duration-500 ease-soul ${
          open ? 'translate-y-[5px] rotate-45' : ''
        }`}
      />
      <span
        className={`absolute bottom-0 end-0 h-[1.5px] bg-current transition-all duration-500 ease-soul ${
          open ? 'w-full -translate-y-[5px] -rotate-45' : 'w-2/3 group-hover:w-full'
        }`}
      />
    </span>
  );
}

export default function Header({ overHero = false }) {
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const lastY = useRef(0);
  const { currency, setCurrency } = useCurrency();
  const { user } = useAuth();
  const { t, locale, toggleLocale } = useLocale();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 24);
      if (overHero) {
        if (y > 360 && y > lastY.current + 6) setHidden(true);
        else if (y < lastY.current - 6 || y < 360) setHidden(false);
      }
      lastY.current = y;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [overHero]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const solid = !overHero || scrolled;
  const ink = solid ? 'text-soul-blue' : 'text-white';

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-50 px-3 pt-3 transition-transform duration-700 ease-soul sm:px-5 ${
          hidden && !menuOpen ? '-translate-y-[140%]' : ''
        }`}
      >
        <div
          className={`relative mx-auto flex h-16 max-w-wide items-center justify-between gap-3 rounded-full pe-2 ps-4 transition-all duration-500 ease-soul sm:ps-5 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:ps-2 ${
            solid
              ? 'border border-soul-line bg-white/80 shadow-[0_18px_48px_-28px_rgba(22,35,58,0.55)] backdrop-blur-xl'
              : 'border border-white/15 bg-white/[0.07] backdrop-blur-md'
          }`}
        >
          <nav className="hidden justify-self-start lg:flex">
            <div className="flex items-center gap-0.5">
              {NAV.map((item) => {
                const active = item.match(pathname);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-medium transition-colors duration-300 xl:px-4 ${
                      solid
                        ? active
                          ? 'bg-soul-blue-50 text-soul-blue'
                          : 'text-soul-blue/70 hover:bg-soul-blue-50/70 hover:text-soul-blue'
                        : active
                          ? 'bg-white/15 text-white'
                          : 'text-white/80 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {t(item.key)}
                  </Link>
                );
              })}
            </div>
          </nav>

          <Link to="/" className="relative z-10 flex shrink-0 items-center lg:justify-self-center" aria-label={brand.name}>
            <img
              src="/soul-brand/soul-logo.png"
              alt={brand.name}
              className={`h-11 w-auto transition duration-500 ${solid ? '' : 'brightness-0 invert'}`}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </Link>

          <div className="relative z-10 flex items-center gap-1 justify-self-end sm:gap-1.5">
            <button
              type="button"
              onClick={toggleLocale}
              className={`hidden h-10 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors sm:inline-flex ${ink} ${
                solid ? 'hover:bg-soul-blue-50' : 'hover:bg-white/10'
              }`}
              aria-label={locale === 'en' ? t('nav.switchToAr') : t('nav.switchToEn')}
            >
              <Globe size={15} strokeWidth={1.8} />
              <span>{locale === 'en' ? 'ع' : 'EN'}</span>
            </button>

            <select
              aria-label={t('common.currency')}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={`g-index hidden h-10 cursor-pointer rounded-full border-0 bg-transparent px-2 outline-none md:block ${ink} ${
                solid ? 'hover:bg-soul-blue-50' : 'hover:bg-white/10'
              }`}
            >
              <option value="EGP" className="text-soul-blue">EGP</option>
              <option value="USD" className="text-soul-blue">USD</option>
            </select>

            <Link
              to="/wishlist"
              className={`hidden h-10 w-10 place-items-center rounded-full transition-colors md:grid ${ink} ${
                solid ? 'hover:bg-soul-blue-50' : 'hover:bg-white/10'
              }`}
              aria-label={t('nav.wishlist')}
            >
              <Heart size={17} strokeWidth={1.8} />
            </Link>

            <button
              type="button"
              onClick={() => navigate(user ? '/account' : '/sign-in')}
              className={`inline-flex h-11 items-center gap-2 rounded-full px-3 text-[13px] font-semibold transition-all duration-300 sm:px-4 ${
                solid
                  ? 'bg-soul-blue text-white hover:bg-soul-blue-dark'
                  : 'bg-white text-soul-blue hover:bg-soul-paper'
              }`}
            >
              <User size={16} strokeWidth={1.9} />
              <span className="hidden sm:inline">{user ? t('nav.account') : t('nav.signIn')}</span>
            </button>

            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className={`group inline-flex h-11 items-center gap-2.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors ${ink} ${
                solid ? 'hover:bg-soul-blue-50' : 'hover:bg-white/10'
              }`}
              aria-label={t('nav.openMenu')}
              aria-expanded={menuOpen}
            >
              <MenuGlyph open={false} />
              <span className="hidden xl:inline">{t('nav.menu')}</span>
            </button>
          </div>
        </div>
      </header>

      {!overHero ? <div aria-hidden="true" className="h-[88px]" /> : null}

      {menuOpen ? (
        <FullMenu
          onClose={() => setMenuOpen(false)}
          pathname={pathname}
          user={user}
          currency={currency}
          setCurrency={setCurrency}
        />
      ) : null}
    </>
  );
}

function FullMenu({ onClose, pathname, user, currency, setCurrency }) {
  const { t, locale, toggleLocale } = useLocale();
  const time = useCairoTime();
  const [hover, setHover] = useState(null);
  const activeIndex = MENU_ITEMS.findIndex((item) => pathname.startsWith(item.to));
  const preview = hover ?? (activeIndex >= 0 ? activeIndex : 0);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="g-menu-in g-grain fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-soul-ink text-white"
      role="dialog"
      aria-modal="true"
      aria-label={t('nav.menu')}
    >
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(900px 520px at 85% 110%, rgba(19,78,94,0.35), transparent 60%), radial-gradient(800px 500px at 0% 0%, rgba(40,63,94,0.55), transparent 60%)',
        }}
      />

      <div className="g-shell relative z-[2] flex w-full items-center justify-between pt-6">
        <Link to="/" onClick={onClose} aria-label={brand.name}>
          <img src="/soul-brand/soul-logo.png" alt={brand.name} className="h-11 w-auto brightness-0 invert" />
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="g-btn g-btn-glass !px-4 !py-3"
          aria-label={t('nav.closeMenu')}
        >
          <span className="hidden sm:inline">{t('nav.close')}</span>
          <X size={16} />
        </button>
      </div>

      <div className="g-shell relative z-[2] grid w-full flex-1 gap-10 py-10 lg:grid-cols-[1fr_38%] lg:items-center lg:py-12">
        <nav onMouseLeave={() => setHover(null)}>
          <ul className="flex flex-col">
            {MENU_ITEMS.map((item, i) => {
              const dim = hover != null && hover !== i;
              return (
                <li key={item.to} className="g-menu-item border-b border-white/10 first:border-t" style={{ '--i': i }}>
                  <Link
                    to={item.to}
                    onClick={onClose}
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    className={`group flex items-baseline gap-5 py-3 transition-all duration-500 ease-soul sm:gap-8 sm:py-4 ${
                      dim ? 'opacity-35' : 'opacity-100'
                    }`}
                  >
                    <span
                      className={`g-index w-8 shrink-0 transition-colors ${
                        hover === i || (hover == null && activeIndex === i) ? 'text-white' : 'text-white/45'
                      }`}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="g-display text-[clamp(38px,6.4vw,92px)] transition-transform duration-700 ease-soul group-hover:translate-x-3 group-hover:italic rtl:group-hover:-translate-x-3">
                      {t(item.key)}
                    </span>
                    <ArrowUpRight
                      size={28}
                      strokeWidth={1.3}
                      className="ms-auto hidden shrink-0 self-center text-white/0 transition-all duration-500 group-hover:text-white/80 sm:block rtl:-scale-x-100"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="relative hidden aspect-[4/5] max-h-[68vh] w-full overflow-hidden rounded-[32px] lg:block">
          {MENU_ITEMS.map((item, i) => (
            <img
              key={item.img}
              src={item.img}
              alt=""
              loading="lazy"
              className={`absolute inset-0 h-full w-full object-cover transition-all duration-[1100ms] ease-soul ${
                i === preview ? 'scale-100 opacity-100' : 'scale-110 opacity-0'
              }`}
            />
          ))}
          <div className="absolute inset-0 bg-gradient-to-t from-soul-ink/70 via-transparent to-transparent" />
          <div className="absolute inset-x-6 bottom-6 flex items-end justify-between gap-4">
            <span className="g-display text-4xl italic">{t(MENU_ITEMS[preview].key)}</span>
            <span className="g-index text-white/70">
              {String(preview + 1).padStart(2, '0')} / {String(MENU_ITEMS.length).padStart(2, '0')}
            </span>
          </div>
        </div>
      </div>

      <div className="g-shell relative z-[2] w-full pb-8">
        <div className="grid gap-6 border-t border-white/10 pt-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-2 text-sm">
            <span className="g-index text-white/45">{t('nav.yourStay')}</span>
            <Link to={user ? '/account' : '/sign-in'} onClick={onClose} className="g-link w-fit text-white/85 hover:text-white">
              {user ? t('nav.account') : t('nav.signIn')}
            </Link>
            <Link to="/wishlist" onClick={onClose} className="g-link w-fit text-white/85 hover:text-white">
              {t('nav.wishlist')}
            </Link>
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <span className="g-index text-white/45">{t('nav.preferences')}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={toggleLocale} className="g-btn g-btn-glass !px-3.5 !py-2.5 !text-xs">
                <Globe size={14} /> {locale === 'en' ? t('nav.switchToAr') : t('nav.switchToEn')}
              </button>
              <select
                aria-label={t('common.currency')}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="g-index h-[38px] cursor-pointer rounded-full border border-white/30 bg-white/10 px-3 text-white outline-none"
              >
                <option value="EGP" className="text-soul-blue">EGP</option>
                <option value="USD" className="text-soul-blue">USD</option>
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <span className="g-index text-white/45">{t('nav.talkToUs')}</span>
            <a
              href={whatsappHref(listingWhatsAppMessage(pathname))}
              target="_blank"
              rel="noreferrer"
              className="g-link inline-flex w-fit items-center gap-2 text-white/85 hover:text-white"
            >
              <WhatsAppIcon className="h-4 w-4 text-[#25d366]" />
              {t('nav.whatsappUs')}
            </a>
            <a href={`mailto:${brand.email}`} className="g-link w-fit text-white/85 hover:text-white">
              {brand.email}
            </a>
          </div>
          <div className="flex items-end justify-between gap-4 lg:flex-col lg:items-end">
            <div className="flex items-center gap-2">
              <a
                href={brand.social.instagram}
                target="_blank"
                rel="noreferrer"
                aria-label={t('footer.instagram')}
                className="grid h-10 w-10 place-items-center rounded-full border border-white/20 transition-colors hover:bg-white hover:text-soul-ink"
              >
                <InstagramIcon className="h-4 w-4" />
              </a>
              <a
                href={brand.social.facebook}
                target="_blank"
                rel="noreferrer"
                aria-label={t('footer.facebook')}
                className="grid h-10 w-10 place-items-center rounded-full border border-white/20 transition-colors hover:bg-white hover:text-soul-ink"
              >
                <FacebookIcon className="h-4 w-4" />
              </a>
            </div>
            <span className="g-index text-white/55">
              {t('nav.localTime')} · {time}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
