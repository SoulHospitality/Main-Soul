import { useEffect } from 'react';
import PortfolioHero from './PortfolioHero';
import SoulStandard from './SoulStandard';
import DestinationsGrid from './DestinationsGrid';
import PartnersTicker from './PartnersTicker';
import OwnersCta from './OwnersCta';
import PortfolioFooter from './PortfolioFooter';
import './portfolio.css';

/** Soul Hospitality brand portfolio: /portfolio (shared by link only). */
export default function PortfolioPage() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Portfolio · Soul Hospitality';
    // Shared by link only: ask search engines not to list it.
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    document.head.appendChild(robots);
    return () => {
      robots.remove();
      document.title = prevTitle;
    };
  }, []);

  return (
    <div className="pf relative min-h-screen">
      <a href="#top" className="absolute left-5 top-5 z-30 md:left-10 md:top-7" aria-label="Soul Hospitality">
        <img src="/soul-brand/soul-logo.png" alt="Soul Hospitality" className="h-11 w-auto brightness-0 invert md:h-14" />
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
