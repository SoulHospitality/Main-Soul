const { query } = require('../config/db');
const { fetchUpstreamBusyDates } = require('./ical');
const { getMinimumStayNights } = require('../lib/minStay');

function nightsBetween(checkin, checkout) {
  const a = new Date(`${checkin}T00:00:00`);
  const b = new Date(`${checkout}T00:00:00`);
  return Math.max(0, Math.round((b - a) / 86400000));
}

function addDaysIso(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localIso(d);
}

function localIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function eachNight(checkin, checkout) {
  const nights = nightsBetween(checkin, checkout);
  const out = [];
  for (let i = 0; i < nights; i++) out.push(addDaysIso(checkin, i));
  return out;
}

async function priceForNight(wpPostId, dateStr) {
  const { rows } = await query(
    `SELECT price, currency, source FROM unit_daily_prices WHERE wp_post_id = $1 AND date = $2`,
    [wpPostId, dateStr]
  );
  return rows[0] || null;
}

async function getDailyPriceMap(wpPostId, from, to) {
  const { rows } = await query(
    `SELECT date::text AS date, price, currency, source
     FROM unit_daily_prices
     WHERE wp_post_id = $1 AND date >= $2 AND date < $3
     ORDER BY date`,
    [wpPostId, from, to]
  );
  const map = {};
  for (const r of rows) map[r.date] = Number(r.price);
  return { map, rows };
}

function computeFees(unit, { nights, subtotal, adults = 1, teens = 0 }) {
  const { housekeepingFeeForUnit } = require('../lib/housekeeping');
  const { resolveBeachAccessRates } = require('../lib/beachAccess');
  const cleaning = housekeepingFeeForUnit(unit);
  const beach = resolveBeachAccessRates(unit, nights);
  const accessAdult = Number(beach.adult || 0) * Math.max(0, Number(adults) || 0);
  const accessTeen = Number(beach.extra || 0) * Math.max(0, Number(teens) || 0);
  const access = accessAdult + accessTeen;
  // Guest checkout: flat 15% service fees + taxes on accommodation subtotal.
  const servicePct = 15;
  const service = Math.round(Number(subtotal || 0) * (servicePct / 100));
  const deposit = Number(unit?.security_deposit_egp || 0);
  const lines = [];
  if (cleaning > 0) lines.push({ key: 'cleaning', label: 'Housekeeping fee', amount: cleaning });
  if (access > 0) lines.push({ key: 'access', label: 'Access cards', amount: access });
  if (service > 0) {
    lines.push({
      key: 'service',
      label: `Service fees + Taxes (${servicePct}%)`,
      amount: service,
    });
  }
  return {
    lines,
    cleaning_fee_egp: cleaning,
    access_fee_egp: access,
    service_fee_egp: service,
    service_fee_percent: servicePct,
    security_deposit_egp: deposit,
    fees_total: cleaning + access + service,
    beach_access: beach,
  };
}

/**
 * Quote a stay. Missing daily price ⇒ unavailable (soul-website parity).
 */
async function quoteStay({
  wpPostId,
  checkin,
  checkout,
  unit,
  adults = 1,
  teens = 0,
  skipBlockCheck = false,
}) {
  const nights = nightsBetween(checkin, checkout);
  if (nights <= 0) throw Object.assign(new Error('Invalid date range'), { status: 400 });

  const minNights = getMinimumStayNights(unit);
  if (nights < minNights) {
    return { available: false, reason: `Minimum stay is ${minNights} nights`, nights };
  }

  if (!skipBlockCheck) {
    const blocked = await getBlockedDates(wpPostId, checkin, checkout, { includeUnpriced: false });
    const blockedSet = new Set(blocked.map((b) => b.date));
    for (const dateStr of eachNight(checkin, checkout)) {
      if (blockedSet.has(dateStr)) {
        return { available: false, reason: `Date ${dateStr} is unavailable`, nights };
      }
    }
  }

  let subtotal = 0;
  const perNight = [];
  for (const dateStr of eachNight(checkin, checkout)) {
    const row = await priceForNight(wpPostId, dateStr);
    if (!row) {
      return { available: false, reason: `No price for ${dateStr}`, nights };
    }
    subtotal += Number(row.price);
    perNight.push({ date: dateStr, price: Number(row.price), currency: row.currency });
  }

  const fees = computeFees(unit, { nights, subtotal, adults, teens });
  const total = subtotal + fees.fees_total;

  return {
    available: true,
    nights,
    perNight,
    subtotal,
    ...fees,
    total_egp: total,
    currency: unit?.price_currency || 'EGP',
  };
}

async function isDateBlocked(wpPostId, dateStr) {
  const blocked = await getBlockedDates(wpPostId, dateStr, addDaysIso(dateStr, 1));
  return blocked.some((b) => b.date === dateStr);
}

/**
 * Blocked nights for guest calendar / quote.
 * Sources: manual blocks, live OTA iCal, pending/confirmed bookings,
 * active PMS reservations, unpriced nights.
 * `unit_ical_blocks` is NOT used for guest truth (admin cache only).
 */
async function getBlockedDates(wpPostId, from, to, { includeUnpriced = true } = {}) {
  const byDate = new Map();

  const push = (date, source) => {
    if (!date || date < from || date >= to) return;
    if (!byDate.has(date)) byDate.set(date, source);
  };

  const { rows: manual } = await query(
    `SELECT date::text AS date FROM unit_blocked_dates
     WHERE wp_post_id = $1 AND date >= $2 AND date < $3`,
    [wpPostId, from, to]
  );
  for (const r of manual) push(r.date, 'manual');

  const { rows: bookings } = await query(
    `SELECT d::text AS date FROM bookings b,
       generate_series(b.checkin, b.checkout - 1, interval '1 day') d
     WHERE b.listing_wp_id = $1
       AND b.status IN ('confirmed','pending','held')
       AND (b.hold_expires_at IS NULL OR b.hold_expires_at > now())
       AND d >= $2::date AND d < $3::date`,
    [wpPostId, from, to]
  );
  for (const r of bookings) push(r.date, 'booking');

  // PMS reservations (admin/owner stays) so delete frees the guest calendar
  const { rows: reservations } = await query(
    `SELECT d::text AS date FROM reservations r
       JOIN units u ON u.id = r.unit_id
       , generate_series(r.check_in, r.check_out - 1, interval '1 day') d
     WHERE u.wp_post_id = $1
       AND r.status <> 'cancelled'
       AND d >= $2::date AND d < $3::date`,
    [wpPostId, from, to]
  );
  for (const r of reservations) push(r.date, 'reservation');

  try {
    const live = await fetchUpstreamBusyDates(wpPostId, from, to);
    for (const date of live) push(date, 'ical');
  } catch (err) {
    console.warn('[pricing] live iCal failed', wpPostId, err.message);
    // Fallback to cache if live fetch fails
    const { rows: cached } = await query(
      `SELECT date::text AS date FROM unit_ical_blocks
       WHERE wp_post_id = $1 AND date >= $2 AND date < $3`,
      [wpPostId, from, to]
    );
    for (const r of cached) push(r.date, 'ical');
  }

  if (includeUnpriced) {
    const { map } = await getDailyPriceMap(wpPostId, from, to);
    for (let d = new Date(`${from}T00:00:00`); localIso(d) < to; d.setDate(d.getDate() + 1)) {
      const iso = localIso(d);
      if (map[iso] == null) push(iso, 'unpriced');
    }
  }

  return [...byDate.entries()]
    .map(([date, source]) => ({ date, source }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = {
  nightsBetween,
  priceForNight,
  getDailyPriceMap,
  quoteStay,
  isDateBlocked,
  getBlockedDates,
  computeFees,
  eachNight,
  addDaysIso,
  localIso,
};
