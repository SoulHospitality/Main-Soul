const OTA_PLATFORM_LABELS = {
  airbnb: 'Airbnb',
  booking: 'Booking.com',
  travigo: 'Travigo',
  other: 'OTA',
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

export function otaBlockLabel(source) {
  if (!isOtaBlockSource(source)) return null;
  const platform = otaPlatformFromSource(source);
  return `${OTA_PLATFORM_LABELS[platform] || 'OTA'} block`;
}

export function otaBlockBadge(source) {
  if (!isOtaBlockSource(source)) return null;
  const platform = otaPlatformFromSource(source);
  if (platform === 'airbnb') return 'AB';
  if (platform === 'booking') return 'BK';
  if (platform === 'travigo') return 'TV';
  return 'OTA';
}
