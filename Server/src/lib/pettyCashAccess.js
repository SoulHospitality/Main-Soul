const PETTY_CASH_LOCATIONS = ['north_coast', 'sokhna'];
const PETTY_CASH_ROLES = ['admin', 'operations_supervisor'];

/** Normalises a staff petty-cash scope: 'north_coast', 'sokhna', or 'both'. */
function normalizePettyCashScope(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'both' || PETTY_CASH_LOCATIONS.includes(v)) return v;
  return null;
}

function pettyCashLocationsFor(user) {
  if (user?.role === 'admin') return PETTY_CASH_LOCATIONS;
  if (user?.role !== 'operations_supervisor') return [];
  const scope = normalizePettyCashScope(user.petty_cash_location);
  if (scope === 'both') return PETTY_CASH_LOCATIONS;
  return scope ? [scope] : [];
}

function canUsePettyCashLocation(user, location) {
  return pettyCashLocationsFor(user).includes(location);
}

module.exports = {
  PETTY_CASH_LOCATIONS,
  PETTY_CASH_ROLES,
  normalizePettyCashScope,
  pettyCashLocationsFor,
  canUsePettyCashLocation,
};
