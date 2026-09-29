const RENT = 'rent';
const LONG_TERM = 'long_term';
const LISTING_TYPES = [RENT, LONG_TERM];

function normalizeListingType(value, fallback = RENT) {
  const v = String(value || '').trim().toLowerCase().replace(/-/g, '_');
  if (v === LONG_TERM || v === 'longterm' || v === 'long_term_rent' || v === 'sale') return LONG_TERM;
  if (v === RENT) return RENT;
  return fallback;
}

function isLongTermUnit(unit) {
  return normalizeListingType(unit?.listing_type) === LONG_TERM;
}

module.exports = { RENT, LONG_TERM, LISTING_TYPES, normalizeListingType, isLongTermUnit };
