import { useEffect } from 'react';
import PortfolioHero from './PortfolioHero';
import SoulStandard from './SoulStandard';
import DestinationsGrid from './DestinationsGrid';
import PartnersTicker from './PartnersTicker';
import OwnersCta from './OwnersCta';
import PortfolioFooter from './PortfolioFooter';
import './portfolio.css';

const FONTS_ID = 'pf-fonts';
const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=Inter:wght@400;500;600&display=swap';

/** Soul Hospitality brand portfolio: /portfolio */
export default function PortfolioPage() {
  useEffect(() => {
    document.title = 'Portfolio · Soul Hospitality';
    // The serif and sans for this page only; the rest of the site keeps its own fonts.
    // Shared by link only: ask search engines not to list it.
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    document.head.appendChild(robots);
    if (!document.getElementById(FONTS_ID)) {
      const link = document.createElement('link');
      link.id = FONTS_ID;
      link.rel = 'stylesheet';
      link.href = FONTS_HREF;
      document.head.appendChild(link);
    }
    return () => robots.remove();
  }, []);

  return (
    <div className="pf relative min-h-screen">
      <a href="#top" className="absolute left-5 top-5 z-30 md:left-10 md:top-7" aria-label="Soul Hospitality">
        <img src="/soul-brand/soul-logo.png" alt="Soul Hospitality" className="h-8 w-auto brightness-0 invert md:h-9" />
      </a>
      <main id="top">
        <PortfolioHero />
        <SoulStandard />
        <DestinationsGrid />
        <PartnersTicker />
        <OwnersCta />
      </main>
      <PortfolioFooter />
    </div>
  );
}
