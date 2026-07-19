/**
 * Guest capacity from bedrooms.
 * Studio (0 or empty) → 2; otherwise 2 × bedrooms.
 */
function guestsFromBedrooms(bedrooms) {
  const n = Number(bedrooms);
  if (!Number.isFinite(n) || n <= 0) return 2;
  return Math.round(n) * 2;
}

module.exports = { guestsFromBedrooms };
