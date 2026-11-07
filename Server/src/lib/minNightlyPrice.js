const { query } = require('../config/db');

/**
 * Each unit's "minimum nightly price" (stored as units.price_fallback). It no longer fills the
 * schedule: it is the floor a reservation's nightly price can't go under. Owner stays and holds are
 * exempt, and the CEO can still go lower.
 */
async function minimumNightlyPrice(unitId) {
  if (!unitId) return 0;
  const { rows } = await query(`SELECT price_fallback, listing_type FROM units WHERE id = $1`, [unitId]);
  if (!rows[0] || String(rows[0].listing_type || 'rent') === 'long_term') return 0;
  return Math.max(0, Number(rows[0].price_fallback) || 0);
}

async function assertAboveMinimum({ unitId, pricePerNight, user, isOwnerStay = false, isHold = false }) {
  if (isOwnerStay || isHold || user?.role === 'admin') return;
  const price = Number(pricePerNight);
  if (!Number.isFinite(price) || price <= 0) return;
  const min = await minimumNightlyPrice(unitId);
  if (min > 0 && price + 0.009 < min) {
    const err = new Error(
      `The nightly price can't be under this unit's minimum of EGP ${Math.round(min).toLocaleString('en-US')}. Ask the CEO if it must be lower.`
    );
    err.status = 400;
    err.code = 'below_min_price';
    throw err;
  }
}

module.exports = { minimumNightlyPrice, assertAboveMinimum };
