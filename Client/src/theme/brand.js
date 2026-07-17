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

/** Empty string = plain wa.me link (no prefilled text). Undefined = default greeting. */
export function whatsappHref(text) {
  const n = brand.whatsapp.replace(/\D/g, '');
  const base = `https://wa.me/${n}`;
  const message = text === undefined ? 'Hi Soul — I have a question' : text;
  if (!message) return base;
  return `${base}?text=${encodeURIComponent(message)}`;
}
