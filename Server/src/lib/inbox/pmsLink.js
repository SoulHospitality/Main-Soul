const { q } = require('./db');
const { phoneTail } = require('./http');

// Bridges between inbox customers/leads and PMS reservations, units and prices.

const PHONE_TAIL_SQL = (col) => `right(regexp_replace(COALESCE(${col}, ''), '\\D', '', 'g'), 10)`;

/** PMS reservations and website bookings made with this phone number, newest first. */
async function guestHistory(phone) {
  const tail = phoneTail(phone);
  if (!tail) return { reservations: [], bookings: [] };
  const reservations = await q.all(
    `SELECT r.id, r.guest_name, r.check_in::text AS check_in, r.check_out::text AS check_out, r.nights, r.status,
            r.total_amount, r.amount_paid, r.payment_status, r.booking_source, r.sales_person_id,
            sp.full_name AS sales_person_name, u.id AS unit_id, u.title AS unit_title, u.unit_number, u.compound
     FROM reservations r
     JOIN units u ON u.id = r.unit_id
     LEFT JOIN staff_users sp ON sp.id = r.sales_person_id
     WHERE ${PHONE_TAIL_SQL('r.guest_phone')} = ?
     ORDER BY r.check_in DESC LIMIT 25`,
    tail,
  );
  const bookings = await q.all(
    `SELECT b.id, b.guest_name, b.checkin::text AS check_in, b.checkout::text AS check_out, b.status, b.total_egp,
            u.title AS unit_title, u.compound
     FROM bookings b
     LEFT JOIN units u ON u.wp_post_id = b.listing_wp_id
     WHERE ${PHONE_TAIL_SQL('b.guest_phone')} = ?
     ORDER BY b.checkin DESC LIMIT 25`,
    tail,
  ).catch(() => []);
  return { reservations, bookings };
}

/** True when the phone has a stay that is upcoming or in progress (not cancelled). */
async function hasActiveStay(phone) {
  const tail = phoneTail(phone);
  if (!tail) return false;
  const row = await q.get(
    `SELECT 1 AS x FROM reservations r
     WHERE ${PHONE_TAIL_SQL('r.guest_phone')} = ? AND r.status <> 'cancelled' AND r.check_out >= CURRENT_DATE
     LIMIT 1`,
    tail,
  );
  return Boolean(row);
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Units free for [checkIn, checkOut) with the nightly prices on file.
 * Same occupancy rules as the guest website search, without requiring every night to be priced.
 */
async function availableUnits({ checkIn, checkOut, project = null, guests = null, bedrooms = null, includeLongTerm = false, limit = 60 }) {
  if (!ISO.test(checkIn || '') || !ISO.test(checkOut || '') || checkOut <= checkIn) return null;
  const where = ["u.status = 'published'"];
  const params = [checkIn, checkOut];
  if (!includeLongTerm) where.push("COALESCE(u.listing_type, 'short_term') <> 'long_term'");
  if (project && project !== 'Other') {
    params.push(project);
    where.push(`u.compound ILIKE $${params.length}`);
  }
  if (Number(guests) > 0) {
    params.push(Number(guests));
    where.push(`COALESCE(u.guests, 0) >= $${params.length}`);
  }
  if (Number(bedrooms) > 0) {
    params.push(Number(bedrooms));
    where.push(`COALESCE(u.beds, 0) >= $${params.length}`);
  }
  params.push(Math.min(200, Math.max(1, Number(limit) || 60)));
  const limitIdx = params.length;
  const sql = `
    SELECT u.id, u.title, u.unit_number, u.compound, u.beds, u.baths, u.guests, u.listing_type,
           u.cover_url, u.price_currency, p.priced_nights, p.total,
           ($2::date - $1::date) AS nights
    FROM units u
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE COALESCE(dp.price, 0) > 0)::int AS priced_nights,
             COALESCE(SUM(dp.price) FILTER (WHERE COALESCE(dp.price, 0) > 0), 0)::float AS total
      FROM unit_daily_prices dp
      WHERE dp.wp_post_id = u.wp_post_id AND dp.date >= $1::date AND dp.date < $2::date
    ) p ON true
    WHERE ${where.join(' AND ')}
      AND NOT EXISTS (
        SELECT 1 FROM unit_ical_blocks b JOIN unit_ota_feeds f ON f.id = b.feed_id
        WHERE b.wp_post_id = u.wp_post_id AND b.date >= $1::date AND b.date < $2::date)
      AND NOT EXISTS (
        SELECT 1 FROM unit_blocked_dates b
        WHERE b.wp_post_id = u.wp_post_id AND b.date >= $1::date AND b.date < $2::date
          AND COALESCE(b.source, 'manual') NOT IN ('reservation', 'reservation_import', 'booking'))
      AND NOT EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.unit_id = u.id AND r.status <> 'cancelled'
          AND r.check_in < $2::date AND r.check_out > $1::date)
      AND NOT EXISTS (
        SELECT 1 FROM bookings bk
        WHERE bk.listing_wp_id = u.wp_post_id AND bk.status IN ('confirmed', 'pending', 'held')
          AND (bk.hold_expires_at IS NULL OR bk.hold_expires_at > now())
          AND bk.checkin < $2::date AND bk.checkout > $1::date)
    ORDER BY (p.priced_nights = ($2::date - $1::date)) DESC, p.total ASC NULLS LAST, u.compound, u.title
    LIMIT $${limitIdx}`;
  const { pool } = require('../../config/db');
  const { rows } = await pool.query(sql, params);
  return rows.map((r) => ({
    ...r,
    fully_priced: r.priced_nights === r.nights,
    avg_per_night: r.priced_nights ? Math.round(r.total / r.priced_nights) : null,
  }));
}

/** Short text for the AI: what is free for the lead's dates (shared only by the agent). */
async function availabilityFacts(lead) {
  if (!lead?.check_in || !lead?.check_out) return '';
  const units = await availableUnits({
    checkIn: lead.check_in, checkOut: lead.check_out, project: lead.project, guests: lead.guests, limit: 8,
  }).catch(() => null);
  if (!units) return '';
  if (!units.length) return `No units are free in ${lead.project || 'any project'} from ${lead.check_in} to ${lead.check_out}.`;
  const lines = units
    .filter((u) => u.fully_priced)
    .map((u) => `- ${u.compound}: ${u.beds} bedrooms, up to ${u.guests} guests, total ${Math.round(u.total)} EGP for ${u.nights} nights`);
  return `${units.length} unit(s) free from ${lead.check_in} to ${lead.check_out}${lead.project ? ` in ${lead.project}` : ''}.\n${lines.join('\n')}`;
}

async function getReservation(id) {
  return q.get(
    `SELECT r.id, r.unit_id, r.guest_name, r.guest_phone, r.check_in::text AS check_in, r.check_out::text AS check_out,
            r.status, r.total_amount, r.sales_person_id, u.compound
     FROM reservations r JOIN units u ON u.id = r.unit_id WHERE r.id = ?`,
    id,
  );
}

module.exports = { guestHistory, hasActiveStay, availableUnits, availabilityFacts, getReservation };
