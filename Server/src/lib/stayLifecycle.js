/**
 * Stay lifecycle shared by operations, housekeeping and the units list:
 *   check-in  → stay checked_in, unit occupied
 *   checkout  → stay checked_out, unit needs_cleaning, a turnover clean is created for that day
 *   cleaned   → unit available (in the cleaning route)
 * A unit marked "maintenance" keeps that status until someone clears it.
 */
const { query } = require('../config/db');

const CHECKLIST = [
  { key: 'beds', label: 'Beds made / linen changed', done: false },
  { key: 'bathrooms', label: 'Bathrooms cleaned', done: false },
  { key: 'kitchen', label: 'Kitchen / kitchenette cleaned', done: false },
  { key: 'floors', label: 'Floors vacuumed / mopped', done: false },
  { key: 'trash', label: 'Trash removed', done: false },
  { key: 'amenities', label: 'Amenities restocked', done: false },
];

function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function markUnitOccupied(unitId) {
  if (!unitId) return;
  await query(
    `UPDATE units SET ops_status = 'occupied', updated_at = now()
     WHERE id = $1 AND COALESCE(ops_status, 'available') <> 'maintenance'`,
    [unitId]
  );
}

/**
 * Ends a stay: status checked_out, unit needs cleaning, one turnover clean dated the checkout day.
 * Safe to call twice; returns false when the stay was cancelled or already checked out.
 */
async function completeCheckout(reservationId, { actorId = null } = {}) {
  const { rows } = await query(
    `UPDATE reservations SET status = 'checked_out', checked_out_at = now(), checked_out_by = $2, updated_at = now()
     WHERE id = $1 AND status IN ('confirmed', 'checked_in', 'pending')
     RETURNING id, unit_id, to_char(check_out, 'YYYY-MM-DD') AS check_out`,
    [reservationId, actorId]
  );
  const stay = rows[0];
  if (!stay) return false;
  await query(
    `UPDATE units SET ops_status = 'needs_cleaning', updated_at = now()
     WHERE id = $1 AND COALESCE(ops_status, 'available') <> 'maintenance'`,
    [stay.unit_id]
  );
  const cleanDate = stay.check_out && stay.check_out < cairoToday() ? cairoToday() : stay.check_out || cairoToday();
  await query(
    `INSERT INTO housekeeping_tasks (reservation_id, unit_id, status, checklist, due_at, clean_date, source, created_by, notes)
     SELECT $1, $2, 'pending', $3::jsonb, $4::date, $4::date, 'checkout', $5, 'Turnover clean after checkout'
     WHERE NOT EXISTS (SELECT 1 FROM housekeeping_tasks WHERE reservation_id = $1 AND source = 'checkout')`,
    [stay.id, stay.unit_id, JSON.stringify(CHECKLIST), cleanDate, actorId]
  );
  return true;
}

/**
 * Stays whose checkout day has passed but nobody closed: closed automatically so unit status, cleaning
 * and reports stay true. Runs with the housekeeping sweep.
 */
async function closePastCheckouts() {
  const { rows } = await query(
    `SELECT id FROM reservations
     WHERE status IN ('confirmed', 'checked_in') AND check_out < $1::date AND check_out >= $1::date - 7
     ORDER BY check_out LIMIT 200`,
    [cairoToday()]
  );
  let closed = 0;
  for (const r of rows) if (await completeCheckout(r.id)) closed += 1;
  return closed;
}

module.exports = { markUnitOccupied, completeCheckout, closePastCheckouts, cairoToday };
