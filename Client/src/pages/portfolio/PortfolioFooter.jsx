import { brand, whatsappHref } from '../../theme/brand';

export default function PortfolioFooter() {
  return (
    <footer className="bg-[var(--pf-ink)] pt-20 text-[var(--pf-stone)]">
      <div className="pf-shell">
        <div className="grid gap-12 border-b border-white/10 pb-14 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <img src="/soul-brand/soul-logo.png" alt={brand.name} className="h-9 w-auto brightness-0 invert" />
            <p className="pf-serif mt-6 max-w-sm text-[26px] leading-snug text-white/85">
              More than a stay. A hospitality experience.
            </p>
          </div>
          <nav aria-label="Quick links">
            <p className="pf-eyebrow text-[var(--pf-gold)]">Explore</p>
            <ul className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {[
                ['The Soul Standard', '#soul-standard'],
                ['Destinations', '#destinations'],
                ['Partners', '#partners'],
                ['For owners', '#owners'],
              ].map(([label, href]) => (
                <li key={href}>
                  <a href={href} className="transition hover:text-white">{label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <div>
            <p className="pf-eyebrow text-[var(--pf-gold)]">Contact</p>
            <ul className="mt-5 space-y-3 text-sm">
              <li>
                <a href={brand.mapsUrl} target="_blank" rel="noreferrer" className="transition hover:text-white">{brand.address}</a>
              </li>
              <li>
                <a href={`tel:${brand.phoneDisplay}`} className="tabular-nums transition hover:text-white">{brand.phoneDisplay}</a>
              </li>
              <li>
                <a href={`mailto:${brand.email}`} className="transition hover:text-white">{brand.email}</a>
              </li>
              <li>
                <a href={whatsappHref()} target="_blank" rel="noreferrer" className="text-[var(--pf-gold)] transition hover:text-white">WhatsApp us</a>
              </li>
            </ul>
          </div>
        </div>
        <div className="flex flex-col gap-3 py-8 text-xs md:flex-row md:items-center md:justify-between">
          <p>{brand.copyright}</p>
          <div className="flex gap-6">
            <a href={brand.social.instagram} target="_blank" rel="noreferrer" className="hover:text-white">Instagram</a>
            <a href={brand.social.facebook} target="_blank" rel="noreferrer" className="hover:text-white">Facebook</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
