import { brand, whatsappHref } from '../../theme/brand';

const SECTIONS = [
  ['The Soul Standard', '#soul-standard'],
  ['Destinations', '#destinations'],
  ['Partners', '#partners'],
  ['For owners', '#owners'],
];

export default function PortfolioFooter() {
  return (
    <footer className="pf-grad pt-20 text-white/75">
      <div className="pf-shell">
        <div className="grid gap-12 border-b border-white/10 pb-14 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <img src="/soul-brand/soul-logo.png" alt={brand.name} className="h-12 w-auto brightness-0 invert" />
            <p className="g-display mt-8 max-w-sm text-[clamp(24px,2.4vw,34px)] text-white">
              More than a stay.
              <span className="block font-light text-white/70">A hospitality experience.</span>
            </p>
          </div>
          <nav aria-label="Sections">
            <p className="g-index flex items-center gap-3 text-[var(--pf-vista)]">
              <span className="g-dot" /> Explore
            </p>
            <ul className="mt-6 space-y-3 text-[15px]">
              {SECTIONS.map(([label, href]) => (
                <li key={href}>
                  <a href={href} className="transition hover:text-white">{label}</a>
                </li>
              ))}
            </ul>
          </nav>
          <div>
            <p className="g-index flex items-center gap-3 text-[var(--pf-vista)]">
              <span className="g-dot" /> Contact
            </p>
            <ul className="mt-6 space-y-3 text-[15px]">
              <li>
                <a href={brand.mapsUrl} target="_blank" rel="noreferrer" className="transition hover:text-white">{brand.address}</a>
              </li>
              <li>
                <a href={`tel:${brand.phoneDisplay}`} className="font-num transition hover:text-white">{brand.phoneDisplay}</a>
              </li>
              <li>
                <a href={`mailto:${brand.email}`} className="transition hover:text-white">{brand.email}</a>
              </li>
              <li>
                <a href={whatsappHref()} target="_blank" rel="noreferrer" className="font-medium text-[var(--pf-vista)] transition hover:text-white">WhatsApp us</a>
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
