

const { isGaiaUnit } = require('./minStay');
const { isFreeBeachProject, beachAccessRequiresManualEntry } = require('./beachAccess');

function hasText(v) {
  return String(v || '').trim().length > 0;
}


function hasNumberSet(v) {
  if (v === undefined || v === null || v === '') return false;
  return Number.isFinite(Number(v));
}

function hasPhotos(unit) {
  if (hasText(unit.cover_url)) return true;
  if (Array.isArray(unit.photo_urls) && unit.photo_urls.some((u) => hasText(u))) return true;
  return false;
}

function hasAmenities(unit) {
  if (!Array.isArray(unit.amenities)) return false;
  return unit.amenities.some((a) => hasText(a));
}

function descriptionText(unit) {
  return unit.the_property || unit.description || unit.short_description || '';
}

function beachAdult(unit) {
  return unit.access_fee_per_adult_egp ?? unit.beach_access_price;
}

function beachExtra(unit) {
  return unit.access_fee_per_teen_egp ?? unit.beach_access_extra_guest;
}

function beachDays(unit) {
  return unit.access_card_count_included ?? unit.beach_access_days;
}

function isSaleUnit(unit) {
  return String(unit?.listing_type || 'rent').toLowerCase() === 'sale';
}


function assessUnitCompleteness(unit, { hasPrice = false } = {}) {
  const missing = [];
  const sale = isSaleUnit(unit);

  if (!hasText(unit.title || unit.name)) missing.push('title');
  if (!hasText(unit.compound || unit.project)) missing.push('project');
  if (!hasText(unit.area || unit.destination)) missing.push('destination');
  if (!hasText(unit.property_type || unit.type)) missing.push('property type');
  if (!hasText(unit.unit_number)) missing.push('unit number');
  if (!hasText(unit.view)) missing.push('view');
  if (unit.beds == null || unit.beds === '' || Number.isNaN(Number(unit.beds))) missing.push('bedrooms');
  if (unit.baths == null || unit.baths === '' || Number.isNaN(Number(unit.baths))) missing.push('bathrooms');
  if (unit.floor == null || unit.floor === '' || Number.isNaN(Number(unit.floor))) missing.push('floor');
  if (!(Number(unit.guests) >= 1)) missing.push('guests');

  if (sale) {
    if (!(Number(unit.size_m2 || unit.area_sqft || unit.unit_area) > 0)) {
      missing.push('area (m²)');
    }
  } else {
    if (!hasPrice && !(Number(unit.price_fallback || unit.price_per_night) > 0)) {
      missing.push('price (fallback or daily rates)');
    }
    if (!hasNumberSet(unit.utilities_cost)) missing.push('utilities cost');
    if (beachAccessRequiresManualEntry(unit)) {
      if (!hasNumberSet(beachAdult(unit))) missing.push('beach access price');
      if (!hasNumberSet(beachExtra(unit))) missing.push('beach access extra guest');
      if (!(Number(beachDays(unit)) >= 1)) missing.push('beach access period');
    }
  }

  if (!hasText(descriptionText(unit))) missing.push('description');
  if (!hasAmenities(unit)) missing.push('amenities');
  if (!hasText(unit.source_url || unit.location_link)) missing.push('location link');
  if (!hasPhotos(unit)) missing.push('photos');

  return { complete: missing.length === 0, missing };
}


function resolveListingStatus({
  unit,
  hasPrice = false,
} = {}) {
  const assessment = assessUnitCompleteness(unit, { hasPrice });
  return {
    status: assessment.complete ? 'published' : 'draft',
    ...assessment,
  };
}

module.exports = {
  assessUnitCompleteness,
  resolveListingStatus,
  hasPhotos,
  isSaleUnit,
  isGaiaUnit,
  isFreeBeachProject,
  beachAccessRequiresManualEntry,
};
