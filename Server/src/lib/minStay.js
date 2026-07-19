const MIN_STAY_NIGHTS = 4;
const GAIA_MIN_STAY_NIGHTS = 3;

/** Project names containing "GAIA" (case-insensitive) use the shorter stay. */
function isGaiaUnit(unit = {}) {
  const fields = [
    unit.project,
    unit.projectName,
    unit.project_name,
    unit.compound,
    unit.destination,
    unit.area,
    unit.location,
  ];
  return fields.some((v) => String(v || '').toLowerCase().includes('gaia'));
}

function getMinimumStayNights(unit) {
  return isGaiaUnit(unit) ? GAIA_MIN_STAY_NIGHTS : MIN_STAY_NIGHTS;
}

module.exports = {
  MIN_STAY_NIGHTS,
  GAIA_MIN_STAY_NIGHTS,
  isGaiaUnit,
  getMinimumStayNights,
};
