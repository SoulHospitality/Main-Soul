import { useMemo } from 'react';
import { useSiteContent } from '../../hooks/useSiteContent';

const CLD = 'https://res.cloudinary.com/zqhyzmvl/image/upload/';

/**
 * Built-in portfolio copy. The Website page (PMS › Website › Portfolio page) can override any of it;
 * an empty field or an empty list keeps what is here.
 */
export const PORTFOLIO_DEFAULTS = {
  sections: { standard: true, destinations: true, partners: true, owners: true },
  hero: {
    eyebrow: 'Soul Hospitality · Portfolio',
    title: 'Where the sea',
    title_light: 'meets stillness.',
    intro: 'Curated boutique properties across Egypt’s most inspiring destinations.',
  },
  standard: {
    eyebrow: 'The Soul Standard',
    title: 'Three promises,',
    title_light: 'every stay.',
    intro: 'Hospitality is in the details nobody sees. These are the ones we never skip, in every home we look after.',
    pillars: [
      { title: 'Verified Luxury', body: 'Handpicked homes, each inspected in person for comfort, quality and calm before a guest arrives.' },
      { title: 'Seamless Booking', body: 'Clear pricing with nothing hidden, and instant WhatsApp assistance from the first question to checkout.' },
      { title: 'Dedicated Hospitality', body: 'An on-ground team that supports you throughout the stay, from arrival to the last morning.' },
    ],
  },
  destinations: {
    eyebrow: 'The Portfolio',
    title: 'Destinations',
    title_light: 'with a sense of place.',
    intro: 'Coast, mountain and city: each address chosen for its light, its quiet and the way it feels to come home to.',
    cards: [
      { name: 'IL Monte Galala', location: 'Ain Sokhna', match: 'monte, galala', image: `${CLD}v1786047803/soul-hospitality/projects/1786047802826-511683623.jpg` },
      { name: 'G-Cribs', location: 'El Gouna', match: 'g-cribs, gcribs', image: `${CLD}v1788182196/soul-hospitality/projects/1788182196293-image001.png.jpg` },
      { name: '90 Avenue & Azad', location: 'New Cairo', match: '90 avenue, azad', image: `${CLD}v1794060213/soul-hospitality/projects/1794060212475-Sunlit_Mediterranean_Resort_Courtyard.png` },
      { name: 'Hacienda West', location: 'North Coast', match: 'hacienda', image: `${CLD}v1786048064/soul-hospitality/projects/1786048064105-hacienda-west-prices.jpg` },
    ],
  },
  partners: {
    eyebrow: 'Trusted partners',
    title: 'Alongside Egypt’s',
    title_light: 'finest developers.',
    intro: 'Our homes sit in master-planned communities by the developers shaping Egypt’s coast and capital.',
    logos: [
      { name: 'Tatweer Misr', logo: `${CLD}v1784205791/Tatweer-Misr-removebg-preview_xjltqj.png`, size: 'l' },
      { name: 'Palm Hills', logo: `${CLD}v1784205791/Palm-Hills-removebg-preview_xnnjvq.png`, size: 'm' },
      { name: 'Mountain View', logo: `${CLD}v1784205735/images__2_-removebg-preview_w5bwps.png`, size: 'xl' },
      { name: 'Emaar', logo: `${CLD}v1783598502/Emaar-Properties_rbhrww.png`, size: 's' },
      { name: 'Sabbour Consulting', logo: `${CLD}v1784205791/Sabbour-removebg-preview_dwdeem.png`, size: 'm' },
    ],
  },
  owners: {
    eyebrow: 'For owners',
    title: 'Your home,',
    title_light: 'our care.',
    intro: 'Hand your property to a team that treats hospitality as a craft. You keep the peace of mind; we take care of everything else.',
    image: '/soul-brand/coast-hero-3.jpg',
    quote: 'We look after it as if it were our own.',
    button: 'List your property',
    points: [
      { title: 'Guest operations', body: 'Check-ins, housekeeping, maintenance and round-the-clock guest support, handled by our team.' },
      { title: 'Pricing guidance', body: 'Season-aware nightly rates that keep your home booked without underselling it.' },
      { title: 'Boutique management', body: 'Professional listing, photography and a monthly owner statement you can read in a minute.' },
    ],
  },
  footer: { tagline: 'More than a stay.', tagline_light: 'A hospitality experience.' },
};

/** Logo heights by size; written out in full so the styles are built. */
export const LOGO_HEIGHTS = { s: 'h-6 md:h-8', m: 'h-10 md:h-12', l: 'h-11 md:h-14', xl: 'h-16 md:h-20' };

/** Saved text wins only when filled in; saved lists win only when they have items. */
export function mergePortfolio(saved) {
  const src = saved && typeof saved === 'object' ? saved : {};
  const out = {};
  for (const [key, def] of Object.entries(PORTFOLIO_DEFAULTS)) {
    const s = src[key] && typeof src[key] === 'object' ? src[key] : {};
    if (key === 'sections') {
      out.sections = Object.fromEntries(Object.keys(def).map((k) => [k, s[k] !== false]));
      continue;
    }
    out[key] = {};
    for (const [field, value] of Object.entries(def)) {
      if (Array.isArray(value)) out[key][field] = Array.isArray(s[field]) && s[field].length ? s[field] : value;
      else out[key][field] = String(s[field] || '').trim() ? s[field] : value;
    }
  }
  return out;
}

export function usePortfolioContent() {
  const { content, loaded } = useSiteContent();
  const merged = useMemo(() => mergePortfolio(content?.portfolio), [content]);
  return { ...merged, loaded };
}
