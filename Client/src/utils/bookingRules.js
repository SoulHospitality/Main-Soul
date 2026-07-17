const MIN_STAY_NIGHTS = 4;
const GAIA_MIN_STAY_NIGHTS = 3;

/**
 * GAIA project → 3 nights; all other projects → 4 nights.
 */
export function isGaiaUnit(unit) {
  const fields = [
    unit?.project,
    unit?.projectName,
    unit?.project_name,
    unit?.compound,
    unit?.destination,
    unit?.location,
  ];
  return fields.some((v) => String(v || '').trim().toLowerCase() === 'gaia');
}

export function getMinimumStayNights(unit) {
  return isGaiaUnit(unit) ? GAIA_MIN_STAY_NIGHTS : MIN_STAY_NIGHTS;
}
