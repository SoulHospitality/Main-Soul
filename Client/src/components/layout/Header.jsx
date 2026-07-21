import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, Menu, User, X, Heart } from 'lucide-react';
import { brand, whatsappHref } from '../../theme/brand';
import { useCurrency } from '../../context/CurrencyContext';
import { useAuth } from '../../context/AuthContext';

const NAV = [
  { label: 'About Soul', to: '/about' },
  { label: 'FAQ', to: '/faq' },
  { label: 'Become a Host', to: '/owners' },
];

const PROPERTY_LINKS = [
  { label: 'Properties For Rent', to: '/search' },
  { label: 'Properties For Sale', to: '/for-sale' },
];

function isPropertiesPath(pathname) {
  return pathname.startsWith('/search') || pathname.startsWith('/for-sale') || pathname.startsWith('/listings');
}

export default function Header({ overHero = false }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);
  const propsRef = useRef(null);
  const { currency, setCurrency } = useCurrency();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!overHero) return undefined;
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [overHero]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  useEffect(() => {
    setPropsOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!propsOpen) return undefined;
    const onPointer = (e) => {
      if (propsRef.current && !propsRef.current.contains(e.target)) setPropsOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setPropsOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [propsOpen]);

  const solid = !overHero || scrolled;
  const linkCls = solid
    ? 'text-soul-blue/80 hover:text-soul-blue'
    : 'text-white/90 hover:text-white';
  const propsActive = isPropertiesPath(pathname);

  return (
    <>
      <header
        className={`${overHero ? 'fixed' : 'sticky'} top-0 inset-x-0 z-50 transition-all duration-300 ${
          solid ? 'soul-glass shadow-[0_1px_0_rgba(40,63,94,0.06)] backdrop-blur-md' : 'bg-transparent'
        }`}
      >
        <div className="relative mx-auto flex h-[88px] max-w-soul items-center justify-between gap-4 px-5 sm:px-8">
          <Link to="/" className="relative z-10 flex shrink-0 items-center gap-2">
            <img
              src="/soul-brand/soul-logo.png"
              alt={brand.name}
              className={`h-16 w-auto ${solid ? '' : 'brightness-0 invert'}`}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </Link>

          <nav className="pointer-events-none absolute inset-x-0 hidden items-center justify-center gap-5 lg:flex xl:gap-6">
            <div className="pointer-events-auto relative" ref={propsRef}>
              <button
                type="button"
                aria-expanded={propsOpen}
                aria-haspopup="menu"
                onClick={() => setPropsOpen((o) => !o)}
                className={`inline-flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-[0.16em] ${
                  propsActive || propsOpen
                    ? solid
                      ? 'text-soul-blue'
                      : 'text-white'
                    : linkCls
                }`}
              >
                Properties
                <ChevronDown
                  size={14}
                  strokeWidth={2.5}
                  className={`transition-transform ${propsOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {propsOpen && (
                <div
                  role="menu"
                  className="absolute left-1/2 top-full z-50 mt-3 min-w-[240px] -translate-x-1/2 overflow-hidden rounded-[14px] border border-soul-line bg-white p-1.5 shadow-[0_18px_50px_rgba(40,63,94,0.18)]"
                >
                  {PROPERTY_LINKS.map((item) => {
                    const active =
                      pathname === item.to ||
                      (item.to === '/search' && pathname.startsWith('/search')) ||
                      (item.to === '/for-sale' && pathname.startsWith('/for-sale'));
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        role="menuitem"
                        onClick={() => setPropsOpen(false)}
                        className={`block rounded-[10px] px-3.5 py-2.5 text-[13px] font-semibold transition ${
                          active
                            ? 'bg-soul-blue-50 text-soul-blue'
                            : 'text-soul-blue hover:bg-soul-blue-50/70'
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>

            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={`pointer-events-auto text-[13px] font-bold uppercase tracking-[0.16em] ${linkCls}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="relative z-10 flex items-center gap-2 sm:gap-3">
            <select
              aria-label="Currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={`hidden sm:block text-sm rounded-full border px-3 py-1.5 bg-transparent outline-none ${
                solid
                  ? 'border-soul-blue-100 text-soul-blue'
                  : 'border-white/30 text-white'
              }`}
            >
              <option value="EGP" className="text-soul-blue">EGP</option>
              <option value="USD" className="text-soul-blue">USD</option>
            </select>

            <Link
              to="/wishlist"
              className={`hidden md:grid h-9 w-9 place-items-center rounded-full ${
                solid ? 'text-soul-blue hover:bg-soul-blue-50' : 'text-white hover:bg-white/10'
              }`}
              aria-label="Wishlist"
            >
              <Heart size={18} />
            </Link>

            <button
              type="button"
              onClick={() => navigate(user ? '/account' : '/sign-in')}
              className={`btn-pill inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold border ${
                solid
                  ? 'bg-soul-blue-50 text-soul-blue border-soul-blue-100'
                  : 'bg-white/15 text-white border-white/25 backdrop-blur-sm'
              }`}
            >
              <User size={16} />
              <span className="hidden sm:inline">{user ? 'Account' : 'Sign In'}</span>
            </button>

            <button
              type="button"
              className={`lg:hidden grid h-10 w-10 place-items-center rounded-full ${
                solid ? 'text-soul-blue' : 'text-white'
              }`}
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={22} />
            </button>
          </div>
        </div>
      </header>

      {mobileOpen && (
        <MobileDrawer
          onClose={() => setMobileOpen(false)}
          currency={currency}
          setCurrency={setCurrency}
          user={user}
          pathname={pathname}
        />
      )}
    </>
  );
}

function MobileDrawer({ onClose, currency, setCurrency, user, pathname }) {
  const [propsOpen, setPropsOpen] = useState(isPropertiesPath(pathname));
  const panelRef = useRef(null);

  return (
    <div className="fixed inset-0 z-[60] lg:hidden">
      <button type="button" className="absolute inset-0 bg-soul-ink/50" aria-label="Close" onClick={onClose} />
      <div
        ref={panelRef}
        className="absolute right-0 top-0 h-full w-[min(100%,360px)] bg-white shadow-2xl flex flex-col"
      >
        <div className="h-[68px] px-5 flex items-center justify-between border-b border-soul-line">
          <span className="font-display text-xl text-soul-blue">Soul</span>
          <button type="button" onClick={onClose} className="h-10 w-10 grid place-items-center" aria-label="Close menu">
            <X size={22} />
          </button>
        </div>
        <nav className="flex-1 px-5 py-6 space-y-1 overflow-y-auto">
          <div className="border-b border-soul-line/60 pb-3 mb-1">
            <button
              type="button"
              onClick={() => setPropsOpen((o) => !o)}
              className="flex w-full items-center justify-between py-3 text-[13px] font-bold uppercase tracking-[0.16em] text-soul-blue"
              aria-expanded={propsOpen}
            >
              Properties
              <ChevronDown
                size={16}
                className={`transition-transform ${propsOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {propsOpen && (
              <div className="mt-1 space-y-1 pb-1">
                {PROPERTY_LINKS.map((item) => {
                  const active = pathname === item.to || pathname.startsWith(`${item.to}?`);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={onClose}
                      className={`block rounded-xl px-3 py-2.5 text-[13px] font-semibold ${
                        active
                          ? 'bg-soul-blue-50 text-soul-blue'
                          : 'text-soul-blue/80 hover:bg-soul-blue-50/60'
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={onClose}
              className="block border-b border-soul-line/60 py-3 text-[13px] font-bold uppercase tracking-[0.16em] text-soul-blue"
            >
              {item.label}
            </Link>
          ))}
          <Link to="/wishlist" onClick={onClose} className="block py-3 text-soul-blue font-medium border-b border-soul-line/60">
            Wishlist
          </Link>
          <Link
            to={user ? '/account' : '/sign-in'}
            onClick={onClose}
            className="block py-3 text-soul-blue font-medium border-b border-soul-line/60"
          >
            {user ? 'Account' : 'Sign In'}
          </Link>
          <div className="pt-4">
            <label className="soul-eyebrow text-soul-muted">Currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="mt-2 w-full border border-soul-line rounded-xl px-3 py-2 text-soul-blue"
            >
              <option value="EGP">EGP</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </nav>
        <div className="p-5 border-t border-soul-line">
          <a
            href={whatsappHref()}
            target="_blank"
            rel="noreferrer"
            className="btn-pill block text-center bg-soul-blue text-white py-3 font-semibold"
            onClick={onClose}
          >
            WhatsApp us
          </a>
        </div>
      </div>
    </div>
  );
}
