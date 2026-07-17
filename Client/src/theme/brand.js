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
  copyright: '© 2026 Soul Hospitality.',
};

export function whatsappHref(text = 'Hi Soul — I have a question') {
  const n = brand.whatsapp.replace(/\D/g, '');
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}
