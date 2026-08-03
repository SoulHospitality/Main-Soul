/**
 * Guest capacity from bedrooms (+ optional nanny room).
 * Studio (0 or empty) → 2.
 * Otherwise: beds × 2, plus 1 when has_nanny_room.
 */
function guestsFromBedrooms(bedrooms, hasNannyRoom = false) {
  const n = Number(bedrooms);
  if (!Number.isFinite(n) || n <= 0) return 2;
  const base = Math.round(n) * 2;
  return hasNannyRoom ? base + 1 : base;
}

module.exports = { guestsFromBedrooms };
