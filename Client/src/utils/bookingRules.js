const MIN_STAY_NIGHTS = 4;
const GAIA_MIN_STAY_NIGHTS = 3;

/**
 * Project names containing "GAIA" (case-insensitive) → 3 nights; all others → 4.
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

export function getMinimumStayNights(unit) {
  return isGaiaUnit(unit) ? GAIA_MIN_STAY_NIGHTS : MIN_STAY_NIGHTS;
}
