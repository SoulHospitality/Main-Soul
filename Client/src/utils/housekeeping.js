/** Fixed housekeeping: villa 2500 EGP, everything else 1500 EGP. */
export const HOUSEKEEPING_DEFAULT = 1500;
export const HOUSEKEEPING_VILLA = 2500;

export function isVilla(propertyType) {
  return String(propertyType || '').trim().toLowerCase() === 'villa';
}

export function housekeepingFeeForType(propertyType) {
  return isVilla(propertyType) ? HOUSEKEEPING_VILLA : HOUSEKEEPING_DEFAULT;
}

export function housekeepingFeeForUnit(unit) {
  return housekeepingFeeForType(unit?.property_type || unit?.type);
}
