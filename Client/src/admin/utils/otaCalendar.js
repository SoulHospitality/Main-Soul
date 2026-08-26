const OTA_PLATFORM_LABELS = {
  airbnb: 'Airbnb',
  booking: 'Booking.com',
  travigo: 'Travigo',
  other: 'OTA',
};

const OTA_LOOK = {
  airbnb: {
    badge: 'AB',
    label: 'Airbnb · outside booking',
    hatch: 'repeating-linear-gradient(135deg, #FF5A5F 0 3px, #fff5f5 3px 7px)',
    badgeClass: 'bg-[#FF5A5F] text-white shadow-sm',
    ringClass: 'ring-1 ring-inset ring-[#FF5A5F]',
    cellBg: 'bg-[#fff1f2]',
  },
  booking: {
    badge: 'BK',
    label: 'Booking.com · outside booking',
    hatch: 'repeating-linear-gradient(135deg, #003580 0 3px, #eef3fb 3px 7px)',
    badgeClass: 'bg-[#003580] text-white shadow-sm',
    ringClass: 'ring-1 ring-inset ring-[#003580]',
    cellBg: 'bg-[#e8eef8]',
  },
  travigo: {
    badge: 'TV',
    label: 'Travigo · outside booking',
    hatch: 'repeating-linear-gradient(135deg, #6d28d9 0 3px, #f5f3ff 3px 7px)',
    badgeClass: 'bg-[#6d28d9] text-white shadow-sm',
    ringClass: 'ring-1 ring-inset ring-[#6d28d9]',
    cellBg: 'bg-[#f3e8ff]',
  },
  other: {
    badge: 'OTA',
    label: 'OTA · outside booking',
    hatch: 'repeating-linear-gradient(135deg, #4338ca 0 3px, #eef2ff 3px 7px)',
    badgeClass: 'bg-[#4338ca] text-white shadow-sm',
    ringClass: 'ring-1 ring-inset ring-[#4338ca]',
    cellBg: 'bg-[#eef2ff]',
  },
};

export function isOtaBlockSource(source) {
  return source === 'ical' || String(source || '').startsWith('ical:');
}

export function otaBlockRank(source) {
  return isOtaBlockSource(source) ? 2 : 0;
}

export function otaPlatformFromSource(source) {
  if (!isOtaBlockSource(source)) return null;
  if (source === 'ical') return 'other';
  return source.split(':')[1] || 'other';
}

export function otaBlockLook(source) {
  if (!isOtaBlockSource(source)) return null;
  return OTA_LOOK[otaPlatformFromSource(source)] || OTA_LOOK.other;
}

export function otaBlockLabel(source) {
  return otaBlockLook(source)?.label || null;
}

export function otaBlockBadge(source) {
  return otaBlockLook(source)?.badge || null;
}
