
const { query } = require('../config/db');

function paymentStatusFrom(totalAmount, amountPaid) {
  const total = Math.max(0, Number(totalAmount) || 0);
  const paid = Math.max(0, Number(amountPaid) || 0);
  if (paid <= 0.009) return 'pending';
  if (total > 0 && paid + 0.5 >= total) return 'paid';
  if (paid > 0) return 'partial';
  return 'pending';
}

async function syncReservationPaymentStatus(reservationId) {
  if (!reservationId) return null;

  const { rows: resRows } = await query(
    `SELECT id, total_amount, status, down_payment, booking_id FROM reservations WHERE id = $1`,
    [reservationId]
  );
  const reservation = resRows[0];
  if (!reservation) return null;

  const { rows: payRows } = await query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'successful' AND COALESCE(is_approved, 0) = 1
                                          AND COALESCE(kind, 'collection') <> 'forfeit'), 0)::float AS paid,
            COUNT(*) FILTER (WHERE status = 'successful' AND COALESCE(is_approved, 0) = 1)::int AS n,
            BOOL_OR(COALESCE(is_down_payment, false) OR notes = 'Down payment (manual reservation)') AS has_down_row
     FROM payments
     WHERE reservation_id = $1`,
    [reservationId]
  );
  const fromPayments = Number(payRows[0]?.paid) || 0;
  const paymentCount = Number(payRows[0]?.n) || 0;
  const down = Number(reservation.down_payment) || 0;
  // A manual stay's down payment counts until it exists as its own payment row (then the row counts).
  const downOutsideRows = !reservation.booking_id && !payRows[0]?.has_down_row ? down : 0;
  const amountPaid = amountPaidFromRows(fromPayments, paymentCount, down, downOutsideRows);
  const paymentStatus = paymentStatusFrom(reservation.total_amount, amountPaid);

  let nextStatus = reservation.status;
  if (
    String(reservation.status || '').toLowerCase() === 'pending' &&
    amountPaid > 0 &&
    paymentStatus !== 'pending'
  ) {
    nextStatus = 'confirmed';
  }

  const { rows } = await query(
    `UPDATE reservations
     SET amount_paid = $1,
         payment_status = $2,
         status = $3,
         updated_at = now()
     WHERE id = $4
     RETURNING *`,
    [amountPaid, paymentStatus, nextStatus, reservationId]
  );
  return rows[0] || null;
}

function amountPaidFromRows(fromPayments, paymentCount, down, downOutsideRows = 0) {
  const paid = Number(fromPayments) || 0;
  const count = Number(paymentCount) || 0;
  const deposit = Number(down) || 0;
  if (count > 0) return Math.max(0, paid + (Number(downOutsideRows) || 0));
  return paid > 0 ? paid : deposit;
}

module.exports = {
  syncReservationPaymentStatus,
  paymentStatusFrom,
  amountPaidFromRows,
};
