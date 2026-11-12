const { query } = require('../config/db');
const { isWebsiteOriginReservation } = require('./reservationScope');

/** The optional service charge on a manual reservation, as a % of the nightly rate × nights. */
const SERVICE_PCT = 15;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const flag = (v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on';

/** Reads the service checkbox from a request body: true / false, or undefined when not sent. */
function serviceChoice(body) {
  if (!body || body.apply_service === undefined || body.apply_service === null || body.apply_service === '') return undefined;
  return flag(body.apply_service);
}

/**
 * Stores the service charge on a reservation: chosen = true applies 15%, false removes it,
 * undefined keeps the current choice but recalculates it (price or dates may have changed).
 * Website stays keep their own pricing (their service is already inside the total).
 */
async function applyServiceCharge(reservationId, chosen) {
  const { rows } = await query(
    `SELECT id, booking_id, booking_source, price_per_night, nights, service_fee_percent, is_owner_reservation
     FROM reservations WHERE id = $1`,
    [reservationId]
  );
  const r = rows[0];
  if (!r || isWebsiteOriginReservation(r)) return null;
  let pct;
  if (chosen === undefined) {
    if (r.service_fee_percent == null) return null;
    pct = Number(r.service_fee_percent) || 0;
  } else {
    pct = chosen ? SERVICE_PCT : 0;
  }
  if (Number(r.is_owner_reservation) === 1) pct = 0;
  const accommodation = round2((parseFloat(r.price_per_night) || 0) * (Number(r.nights) || 0));
  const service = round2(accommodation * (pct / 100));
  const { rows: saved } = await query(
    `UPDATE reservations SET service_fees = $2, service_fee_percent = $3, updated_at = now()
     WHERE id = $1 RETURNING service_fees, service_fee_percent`,
    [reservationId, service, pct]
  );
  return saved[0] || null;
}

/**
 * Keeps the down payment of a manual reservation as a real payment, which waits for finance in
 * Reservation collection. `force` creates it even when the amount did not change (new reservations).
 * A down payment finance already confirmed is never changed here.
 */
async function syncDownPayment(reservationId, user, { force = false, previous = null } = {}) {
  const { rows } = await query(
    `SELECT id, down_payment, status, booking_id, booking_source, is_owner_reservation, hold_expires_at,
            payment_method, bank_account
     FROM reservations WHERE id = $1`,
    [reservationId]
  );
  const r = rows[0];
  if (!r || isWebsiteOriginReservation(r)) return null;
  if (String(r.status || '').toLowerCase() === 'cancelled') return null;
  const want = round2(r.down_payment);
  const changed = previous == null || Math.abs(round2(previous) - want) > 0.009;
  if (!force && !changed) return null;

  const { rows: found } = await query(
    `SELECT * FROM payments
     WHERE reservation_id = $1 AND is_down_payment = true
       AND lower(COALESCE(status, '')) NOT IN ('cancelled', 'failed')
     ORDER BY id DESC LIMIT 1`,
    [reservationId]
  );
  const current = found[0];

  if (current) {
    if (current.finance_review_status === 'reviewed') return current;
    if (!(want > 0.009)) {
      await query(`UPDATE payments SET status = 'cancelled', finance_review_status = NULL WHERE id = $1`, [current.id]);
    } else if (Math.abs(round2(current.amount) - want) > 0.009) {
      await query(`UPDATE payments SET amount = $2 WHERE id = $1`, [current.id, want]);
    }
  } else {
    if (!(want > 0.009)) return null;
    // Holds and owner stays have no guest down payment to check.
    if (r.hold_expires_at || Number(r.is_owner_reservation) === 1) return null;
    let method = String(r.payment_method || 'cash').toLowerCase();
    if (!['cash', 'instapay', 'bank_transfer', 'credit_card', 'paymob_card', 'online', 'other'].includes(method)) method = 'cash';
    await query(
      `INSERT INTO payments (
         reservation_id, amount, payment_date, payment_method, bank_account, notes, created_by,
         status, is_approved, approved_by, approved_at, paid_at, kind, is_down_payment
       ) VALUES ($1, $2, CURRENT_DATE, $3, $4, 'Down payment (manual reservation)', $5,
         'successful', 1, $5, now(), now(), 'collection', true)`,
      [reservationId, want, method, ['instapay', 'bank_transfer'].includes(method) ? r.bank_account || null : null, user?.id || null]
    );
  }
  const { syncReservationPaymentStatus } = require('./syncReservationPayment');
  return syncReservationPaymentStatus(reservationId);
}

module.exports = { SERVICE_PCT, serviceChoice, applyServiceCharge, syncDownPayment };
