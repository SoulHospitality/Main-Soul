/** Booking platforms (OTAs) a reservation can come from; a channel manager maps its channels to these. */
const OTA_PLATFORMS = ['airbnb', 'booking', 'travigo', 'other'];

const OTA_PLATFORM_LABELS = {
  airbnb: 'Airbnb',
  booking: 'Booking.com',
  travigo: 'Travigo / Trivago',
  other: 'Other',
};

function normalizeOtaPlatform(value) {
  const p = String(value || '')
    .trim()
    .toLowerCase();
  return OTA_PLATFORMS.includes(p) ? p : null;
}

function detectPlatformFromUrl(url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('airbnb')) return 'airbnb';
  if (u.includes('booking.com')) return 'booking';
  if (u.includes('travago') || u.includes('trivago')) return 'travigo';
  return 'other';
}

module.exports = {
  OTA_PLATFORMS,
  OTA_PLATFORM_LABELS,
  normalizeOtaPlatform,
  detectPlatformFromUrl,
};
