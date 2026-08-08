const DEFAULT_MIN_STAY_NIGHTS = 4;
const GAIA_MIN_STAY_NIGHTS = 3;

/**
 * Project names containing "GAIA" (case-insensitive).
 * Still used for beach-fee display modes; min stay reads unit.min_nights.
 */
export function isGaiaUnit(unit) {
  const fields = [
    unit?.project,
    unit?.projectName,
    unit?.project_name,
    unit?.compound,
    unit?.destination,
    unit?.area,
    unit?.location,
  ];
  return fields.some((v) => String(v || '').toLowerCase().includes('gaia'));
}

/**
 * Prefer denormalized units.min_nights (from location_projects); default 4.
 */
export function getMinimumStayNights(unit) {
  const n = parseInt(unit?.min_nights, 10);
  if (Number.isFinite(n) && n >= 1) return n;
  return DEFAULT_MIN_STAY_NIGHTS;
}

export { DEFAULT_MIN_STAY_NIGHTS, GAIA_MIN_STAY_NIGHTS };
