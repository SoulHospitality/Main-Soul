/**
 * Guest-listing completeness: incomplete units stay draft and never appear to guests.
 */

function hasText(v) {
  return String(v || '').trim().length > 0;
}

function hasPhotos(unit) {
  if (hasText(unit.cover_url)) return true;
  if (Array.isArray(unit.photo_urls) && unit.photo_urls.some((u) => hasText(u))) return true;
  return false;
}

/**
 * @param {object} unit - unit row or merged create/update fields
 * @param {{ hasPrice?: boolean }} opts
 * @returns {{ complete: boolean, missing: string[] }}
 */
function assessUnitCompleteness(unit, { hasPrice = false } = {}) {
  const missing = [];
  if (!hasText(unit.title || unit.name)) missing.push('title');
  if (!hasText(unit.compound || unit.project)) missing.push('project');
  if (!hasText(unit.property_type || unit.type)) missing.push('property type');
  if (unit.beds == null || unit.beds === '' || Number.isNaN(Number(unit.beds))) missing.push('bedrooms');
  if (unit.baths == null || unit.baths === '' || Number.isNaN(Number(unit.baths))) missing.push('bathrooms');
  if (!(Number(unit.guests) >= 1)) missing.push('guests');
  if (!hasPrice && !(Number(unit.price_fallback || unit.price_per_night) > 0)) {
    missing.push('price (fallback or daily rates)');
  }
  if (!hasPhotos(unit)) missing.push('photos');

  return { complete: missing.length === 0, missing };
}

/**
 * Resolve guest listing status.
 * - Incomplete → always draft (hidden from guests)
 * - Complete on create → published
 * - Complete + explicit draft on update → draft (admin can hold)
 * - Complete + published / previously published → published
 * - Terminal statuses (archived/cancelled/delisted) preserved when requested
 */
function resolveListingStatus({
  unit,
  hasPrice = false,
  requestedStatus = null,
  previousStatus = null,
  isCreate = false,
} = {}) {
  const terminal = new Set(['archived', 'cancelled', 'delisted']);
  if (requestedStatus && terminal.has(requestedStatus)) {
    return { status: requestedStatus, ...assessUnitCompleteness(unit, { hasPrice }) };
  }

  const assessment = assessUnitCompleteness(unit, { hasPrice });
  if (!assessment.complete) {
    return { status: 'draft', ...assessment };
  }

  // Create: complete units go live for guests
  if (isCreate) {
    return { status: 'published', ...assessment };
  }

  if (requestedStatus === 'draft') {
    return { status: 'draft', ...assessment };
  }
  if (requestedStatus === 'published') {
    return { status: 'published', ...assessment };
  }

  // Update without status change: keep previous if still valid
  if (previousStatus === 'published') {
    return { status: 'published', ...assessment };
  }
  if (previousStatus && terminal.has(previousStatus)) {
    return { status: previousStatus, ...assessment };
  }
  return { status: previousStatus || 'draft', ...assessment };
}

module.exports = {
  assessUnitCompleteness,
  resolveListingStatus,
  hasPhotos,
};
