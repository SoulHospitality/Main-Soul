export const brand = {
  id: 'soul',
  name: 'Soul Hospitality',
  tagline: 'From booking to your final stroll, Enjoy with Soul.',
  domain: import.meta.env.VITE_SITE_URL || 'https://soulhospitality.co',
  colors: {
    primary: '#283F5E',
    accent: '#F28C28',
    muted: '#5D6A83',
  },
  whatsapp: import.meta.env.VITE_WHATSAPP_NUMBER || '+201500009344',
  phoneDisplay: '01500009344',
  email: 'info@soulhospitality.co',
  address: 'New Cairo - Sadat Axis',
  mapsUrl: 'https://maps.app.goo.gl/faiBKHKQtouzMC6q7',
  social: {
    facebook: 'https://www.facebook.com/shaheenzhospitality/',
    instagram: 'https://www.instagram.com/soulhospitalityy/',
  },
  copyright: '© 2026 Soul Hospitality. All rights reserved.',
};


export function whatsappHref(text) {
  const n = brand.whatsapp.replace(/\D/g, '');
  const base = `https://wa.me/${n}`;
  const message = text === undefined ? 'Hi Soul — I have a question' : text;
  if (!message) return base;
  return `${base}?text=${encodeURIComponent(message)}`;
}


export function listingWhatsAppMessage(pathnameOrUrl) {
  const raw = String(pathnameOrUrl || '').trim();
  if (!raw) return 'Hi Soul — I have a question';

  let listingUrl = raw;
  if (raw.startsWith('/')) {
    const base = String(brand.domain || '').replace(/\/$/, '');
    listingUrl = `${base}${raw}`;
  } else if (!/^https?:\/\//i.test(raw) && typeof window !== 'undefined') {
    listingUrl = `${window.location.origin}${raw.startsWith('/') ? raw : `/${raw}`}`;
  }

  if (!/\/listings\//i.test(listingUrl)) {
    return 'Hi Soul — I have a question';
  }

  return `${listingUrl}\nعندي استفسار بخصوص الوحده دي`;
}
