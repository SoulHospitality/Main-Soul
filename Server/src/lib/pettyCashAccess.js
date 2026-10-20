const { query } = require('../config/db');

const PETTY_CASH_LOCATIONS = ['north_coast', 'sokhna'];
const PETTY_CASH_ROLES = ['admin', 'operations_supervisor', 'finance', 'finance_manager'];

const FALLBACK_ACCOUNTS = [
  { location_key: 'north_coast', name: 'North Coast', destination: 'North Coast', opening_amount: 0 },
  { location_key: 'sokhna', name: 'Sokhna', destination: 'Ain Sokhna', opening_amount: 0 },
];

/** Normalises a staff petty-cash scope: 'north_coast', 'sokhna', or 'both'. */
function normalizePettyCashScope(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'both' || PETTY_CASH_LOCATIONS.includes(v)) return v;
  return null;
}

async function listPettyCashAccounts() {
  try {
    const { rows } = await query(
      `SELECT id, location_key, name, destination, treasury_account_code,
              opening_amount::float AS opening_amount, created_by, created_at
       FROM petty_cash_accounts
       ORDER BY id`
    );
    if (rows.length) return rows;
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }
  return FALLBACK_ACCOUNTS;
}

async function pettyCashLocationsFor(user) {
  const accounts = await listPettyCashAccounts();
  const keys = accounts.map((row) => row.location_key);
  if (user?.role === 'admin' || user?.role === 'finance' || user?.role === 'finance_manager') return keys;
  if (user?.role !== 'operations_supervisor') return [];
  const scope = normalizePettyCashScope(user.petty_cash_location);
  if (scope === 'both') return PETTY_CASH_LOCATIONS.filter((key) => keys.includes(key));
  return scope && keys.includes(scope) ? [scope] : [];
}

async function canUsePettyCashLocation(user, location) {
  const keys = await pettyCashLocationsFor(user);
  return keys.includes(location);
}

module.exports = {
  PETTY_CASH_LOCATIONS,
  PETTY_CASH_ROLES,
  normalizePettyCashScope,
  listPettyCashAccounts,
  pettyCashLocationsFor,
  canUsePettyCashLocation,
};
