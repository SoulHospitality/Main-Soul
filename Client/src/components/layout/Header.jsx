import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Menu, User, X, Heart } from 'lucide-react';
import { brand, whatsappHref } from '../../theme/brand';
import { useCurrency } from '../../context/CurrencyContext';
import { useAuth } from '../../context/AuthContext';

const NAV = [
  { label: 'Properties', to: '/search' },
  { label: 'About Soul', to: '/about' },
  { label: 'FAQ', to: '/faq' },
  { label: 'Become a Host', to: '/owners' },
];

export default function Header({ overHero = false }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { currency, setCurrency } = useCurrency();
  const { user } = useAuth();
  const navigate = useNavigate();

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

  const solid = !overHero || scrolled;
  const linkCls = solid
    ? 'text-soul-blue/80 hover:text-soul-blue'
    : 'text-white/90 hover:text-white';

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

          <nav className="pointer-events-none absolute inset-x-0 hidden items-center justify-center gap-7 lg:flex xl:gap-9">
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
        />
      )}
    </>
  );
}

function MobileDrawer({ onClose, currency, setCurrency, user }) {
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
