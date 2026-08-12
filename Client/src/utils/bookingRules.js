const DEFAULT_MIN_STAY_NIGHTS = 4;
const GAIA_MIN_STAY_NIGHTS = 3;


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
  const n = parseInt(unit?.min_nights, 10);
  if (Number.isFinite(n) && n >= 1) return n;
  return DEFAULT_MIN_STAY_NIGHTS;
}

export { DEFAULT_MIN_STAY_NIGHTS, GAIA_MIN_STAY_NIGHTS };
