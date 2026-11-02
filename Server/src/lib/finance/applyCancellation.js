const { pool, query } = require('../../config/db');
const { logAudit } = require('../audit');
const { syncReservationPaymentStatus } = require('../syncReservationPayment');
const { assertPeriodOpen } = require('./periodLock');
const { resolveCancelSettlement, round2 } = require('./cancelSettlement');

async function applyCancellation({ reservationId, user, body = {} }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existingRows } = await client.query(
      `SELECT * FROM reservations WHERE id = $1 FOR UPDATE`,
      [reservationId]
    );
    const existing = existingRows[0];
    if (!existing) {
      const err = new Error('Not found');
      err.status = 404;
      throw err;
    }
    if (String(existing.status) === 'cancelled') {
      const err = new Error('This reservation is already cancelled');
      err.status = 409;
      throw err;
    }
    await assertPeriodOpen(existing.check_in, 'This stay');

    const { rows: sumRows } = await client.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0)::float AS collected
       FROM payments
       WHERE reservation_id = $1
         AND status = 'successful'
         AND COALESCE(is_approved, 0) = 1`,
      [reservationId]
    );
    const collected = Number(sumRows[0]?.collected) || 0;
    const settlement = resolveCancelSettlement({
      cancelType: body.cancel_type,
      settlement: body.settlement,
      refundAmount: body.refund_amount,
      collected,
    });
    const reason = String(body.reason || '').trim();

    // Money already collected is never refunded here: finance approves the refund, its amount and treasury.
    const needsFinance = collected > 0.009;
    if (needsFinance) {
      await client.query(
        `INSERT INTO reservation_cancel_requests
           (reservation_id, reason, requested_choice, requested_refund, collected, requested_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [reservationId, reason || null, settlement.choice, settlement.refund, round2(collected), user?.id || null]
      );
    }

    const requested = settlement.choice === 'forfeit'
      ? `deposit kept (${settlement.kept})`
      : settlement.choice === 'partial_refund'
        ? `refund ${settlement.refund}, keep ${settlement.kept}`
        : `full refund ${settlement.refund}`;
    const noteLine = needsFinance
      ? `Cancellation: ${requested} requested, waiting for finance approval`
      : 'Cancellation: nothing collected';
    const { rows } = await client.query(
      `UPDATE reservations SET
         status = 'cancelled',
         notes = CASE
           WHEN $1::text IS NULL OR $1 = '' THEN COALESCE(notes || E'\n', '') || $2
           ELSE COALESCE(notes || E'\n', '') || ('Cancel: ' || $1) || E'\n' || $2
         END,
         updated_at = now()
       WHERE id = $3 AND status <> 'cancelled'
       RETURNING *`,
      [reason || null, noteLine, reservationId]
    );
    const updated = rows[0];
    if (!updated) {
      const err = new Error('Not found');
      err.status = 404;
      throw err;
    }

    try {
      await client.query('SAVEPOINT housekeeping_cancel');
      await client.query(
        `UPDATE housekeeping_tasks
         SET status = 'cancelled', updated_at = now()
         WHERE reservation_id = $1 AND status IS DISTINCT FROM 'ready'`,
        [reservationId]
      );
      await client.query('RELEASE SAVEPOINT housekeeping_cancel');
    } catch (_) {
      await client.query('ROLLBACK TO SAVEPOINT housekeeping_cancel');
    }

    await client.query('COMMIT');

    try {
      await syncReservationPaymentStatus(reservationId);
    } catch (err) {
      console.warn('[reservations] payment sync after cancel failed', err.message);
    }

    try {
      const { syncBlocksForReservation } = require('../reservationBlocks');
      await syncBlocksForReservation(updated);
    } catch (err) {
      console.warn('[reservations] block release on cancel failed', err.message);
    }

    if (updated.booking_id) {
      try {
        const { cancelWebsiteBooking } = require('../../services/bookingWorkflow');
        await cancelWebsiteBooking(updated.booking_id, reason || settlement.choice);
      } catch (err) {
        console.warn('[reservations] website booking cancel failed', err.message);
      }
    }

    try {
      const { notifyCancelRequest } = require('../../services/pmsNotifications');
      await notifyCancelRequest(updated, user, reason);
    } catch (_) {}

    await logAudit({
      userId: user?.id,
      action: 'CANCEL_RESERVATION',
      entityType: 'reservation',
      entityId: updated.id,
      details: {
        before: {
          status: existing.status,
          amount_paid: existing.amount_paid,
          payment_status: existing.payment_status,
        },
        after: {
          status: 'cancelled',
          settlement: settlement.choice,
          requested_refund: settlement.refund,
          kept: settlement.kept,
          finance_request: needsFinance,
        },
        reason: reason || null,
      },
    });

    const { rows: fresh } = await query(`SELECT * FROM reservations WHERE id = $1`, [reservationId]);
    return fresh[0] || updated;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* already finished */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { applyCancellation };
