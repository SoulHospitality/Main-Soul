const { query } = require('../config/db');
const { appliesToUnit, describeScope } = require('./offerScope');

function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function mapOffer(row) {
  if (!row) return null;
  const scope = { unit_ids: row.unit_ids || [], projects: row.projects || [], destinations: row.destinations || [] };
  return {
    ...row,
    discount_percent: Number(row.discount_percent),
    starts_on: row.starts_on ? String(row.starts_on).slice(0, 10) : null,
    ends_on: row.ends_on ? String(row.ends_on).slice(0, 10) : null,
    ...scope,
    applies_to: describeScope(scope),
  };
}

let cache = { at: 0, day: null, rows: [] };

/** Offers running today (cached for a minute: every price quote asks). */
async function activeOffers() {
  const day = cairoToday();
  if (cache.day === day && Date.now() - cache.at < 60000) return cache.rows;
  try {
    const { rows } = await query(
      `SELECT * FROM offers
       WHERE active = true
         AND (starts_on IS NULL OR starts_on <= $1::date)
         AND (ends_on IS NULL OR ends_on >= $1::date)
       ORDER BY discount_percent DESC, id DESC`,
      [day]
    );
    cache = { at: Date.now(), day, rows: rows.map(mapOffer) };
  } catch (err) {
    if (err.code !== '42P01') console.warn('[offers] load failed', err.message);
    cache = { at: Date.now(), day, rows: [] };
  }
  return cache.rows;
}

function clearOfferCache() {
  cache = { at: 0, day: null, rows: [] };
}

/** The biggest running offer for a unit, if any. */
async function bestOfferForUnit(unit) {
  if (!unit) return null;
  const offers = await activeOffers();
  return offers.find((o) => appliesToUnit(o, unit)) || null;
}

module.exports = { activeOffers, bestOfferForUnit, clearOfferCache, mapOffer, cairoToday };
