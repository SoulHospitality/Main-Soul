import { Link } from 'react-router-dom';
import { brand, whatsappHref } from '../../theme/brand';

export default function Footer() {
  return (
    <footer className="bg-soul-blue-dark text-white">
      <div className="mx-auto max-w-soul px-5 sm:px-8 py-14 md:py-16 grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="font-display text-2xl font-semibold">{brand.name}</div>
          <p className="mt-3 font-display italic text-white/70">By the water, with soul.</p>
          <p className="mt-4 text-sm text-white/60 max-w-xs leading-relaxed">
            Hand-picked vacation homes along Egypt’s North Coast and Red Sea — booked with clarity, hosted with care.
          </p>
        </div>
        <div>
          <div className="soul-eyebrow text-white/45 mb-4">Explore</div>
          <ul className="space-y-2.5 text-sm text-white/85">
            <li><Link to="/search" className="hover:text-white">Explore listings</Link></li>
            <li><Link to="/compounds" className="hover:text-white">Compounds</Link></li>
            <li><Link to="/wishlist" className="hover:text-white">Wishlist</Link></li>
            <li><Link to="/faq" className="hover:text-white">FAQ</Link></li>
          </ul>
        </div>
        <div>
          <div className="soul-eyebrow text-white/45 mb-4">Company</div>
          <ul className="space-y-2.5 text-sm text-white/85">
            <li><Link to="/about" className="hover:text-white">About us</Link></li>
            <li><Link to="/owners" className="hover:text-white">List your property</Link></li>
            <li><Link to="/careers" className="hover:text-white">Careers</Link></li>
            <li><Link to="/contact" className="hover:text-white">Contact</Link></li>
          </ul>
        </div>
        <div>
          <div className="soul-eyebrow text-white/45 mb-4">Contact</div>
          <ul className="space-y-2.5 text-sm text-white/85">
            <li>
              <a href={whatsappHref()} target="_blank" rel="noreferrer" className="hover:text-white">
                WhatsApp
              </a>
            </li>
            <li>
              <a href="mailto:hello@soulhospitality.co" className="hover:text-white">
                hello@soulhospitality.co
              </a>
            </li>
            <li><Link to="/terms" className="hover:text-white">Terms</Link></li>
            <li><Link to="/privacy" className="hover:text-white">Privacy</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 px-5 py-5 text-sm text-white/50 text-center">
        {brand.copyright}
      </div>
    </footer>
  );
}
