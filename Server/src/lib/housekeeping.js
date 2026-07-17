/**
 * Fixed housekeeping fees (Soul Hospitality policy).
 * Villa → 2500 EGP; all other property types → 1500 EGP.
 */

const HOUSEKEEPING_DEFAULT = 1500;
const HOUSEKEEPING_VILLA = 2500;

function isVilla(propertyType) {
  return String(propertyType || '').trim().toLowerCase() === 'villa';
}

function housekeepingFeeForType(propertyType) {
  return isVilla(propertyType) ? HOUSEKEEPING_VILLA : HOUSEKEEPING_DEFAULT;
}

function housekeepingFeeForUnit(unit) {
  return housekeepingFeeForType(unit?.property_type || unit?.type);
}

module.exports = {
  HOUSEKEEPING_DEFAULT,
  HOUSEKEEPING_VILLA,
  isVilla,
  housekeepingFeeForType,
  housekeepingFeeForUnit,
};
