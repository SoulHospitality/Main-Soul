const { query } = require('../config/db');
const { resolveListingStatus } = require('./unitCompleteness');

async function unitHasPrice(unitId, { priceFallback, wpPostId } = {}) {
  let fallback = Number(priceFallback);
  let postId = wpPostId;
  if (unitId && (priceFallback === undefined || wpPostId === undefined)) {
    const { rows } = await query(
      `SELECT price_fallback, wp_post_id FROM units WHERE id = $1`,
      [unitId]
    );
    if (!rows[0]) return false;
    if (priceFallback === undefined) fallback = Number(rows[0].price_fallback);
    if (wpPostId === undefined) postId = rows[0].wp_post_id;
  }
  if (Number(fallback) > 0) return true;
  if (!postId) return false;
  const { rows: priced } = await query(
    `SELECT 1 FROM unit_daily_prices WHERE wp_post_id = $1 AND price > 0 LIMIT 1`,
    [postId]
  );
  return Boolean(priced[0]);
}

/** Recompute draft/published from completeness. Returns fresh unit row. */
async function syncUnitListingStatus(unitId, { requestedStatus = null } = {}) {
  const { rows } = await query(`SELECT * FROM units WHERE id = $1`, [unitId]);
  const unit = rows[0];
  if (!unit) return null;

  const terminal = new Set(['archived', 'cancelled', 'delisted']);
  // Leave terminal units alone unless an explicit terminal change is requested
  if (terminal.has(unit.status) && !(requestedStatus && terminal.has(requestedStatus))) {
    return unit;
  }

  const hasPrice =
    String(unit.listing_type || 'rent').toLowerCase() === 'sale'
      ? true
      : await unitHasPrice(unitId, {
          priceFallback: unit.price_fallback,
          wpPostId: unit.wp_post_id,
        });
  const resolved = resolveListingStatus({
    unit,
    hasPrice,
    requestedStatus,
    previousStatus: unit.status,
  });
  if (resolved.status === unit.status) {
    return { ...unit, _completeness: resolved };
  }
  const { rows: updated } = await query(
    `UPDATE units SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [resolved.status, unitId]
  );
  return { ...updated[0], _completeness: resolved };
}

async function enforceDraftWithoutPrice(unitId) {
  const synced = await syncUnitListingStatus(unitId);
  const complete = synced?._completeness?.complete;
  const hasPrice = complete
    ? true
    : !(synced?._completeness?.missing || []).includes('price (fallback or daily rates)');
  return {
    demoted: synced && synced.status === 'draft',
    hasPrice: Boolean(hasPrice),
    unit: synced,
    completeness: synced?._completeness,
  };
}

module.exports = {
  unitHasPrice,
  syncUnitListingStatus,
  enforceDraftWithoutPrice,
};
