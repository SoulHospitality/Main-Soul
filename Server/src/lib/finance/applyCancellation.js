const { pool, query } = require('../../config/db');
const { logAudit } = require('../audit');
const { syncReservationPaymentStatus } = require('../syncReservationPayment');
const { assertPeriodOpen } = require('./periodLock');
const { resolveCancelSettlement, round2 } = require('./cancelSettlement');

/** ADIB / CIB for a bank treasury account or one of its sub-accounts, else null (cash). */
function bankForTreasury(code) {
  const { getAccount } = require('./chartOfAccounts');
  const acct = getAccount(code);
  const root = acct?.parent_code || code;
  if (root === '101000') return 'adib';
  if (root === '102000') return 'cib';
  return null;
}

/** The CEO's cancellation: both approvals and the payout happen at once, recorded like finance's. */
async function settleByCeo(client, { reservationId, user, body, reason, settlement, collected }) {
  const { isTreasuryCode } = require('./chartOfAccounts');
  const { refreshCustomAccounts } = require('./customAccounts');
  await refreshCustomAccounts();
  const refund = round2(settlement.refund);
  const treasury = String(body.treasury_account_code || '').trim() || null;
  if (refund > 0.009) {
    if (!treasury) {
      const err = new Error('Choose the treasury the refund is paid from');
      err.status = 400;
      throw err;
    }
    if (!isTreasuryCode(treasury)) {
      const err = new Error('Choose a bank or cash treasury account');
      err.status = 400;
      throw err;
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  let paymentId = null;
  if (refund > 0.009) {
    await assertPeriodOpen(today);
    const bank = bankForTreasury(treasury);
    const { rows: pay } = await client.query(
      `INSERT INTO payments (
         reservation_id, amount, payment_date, payment_method, bank_account, treasury_account_code,
         status, is_approved, approved_by, approved_at, paid_at, notes, created_by, kind
       ) VALUES ($1, $2, $3::date, $4, $5, $6, 'successful', 1, $7, now(), now(), $8, $7, 'refund')
       RETURNING id`,
      [
        reservationId,
        -refund,
        today,
        bank ? 'bank_transfer' : 'cash',
        bank,
        treasury,
        user.id,
        `Refund on cancellation by the CEO${reason ? `: ${reason}` : ''}`,
      ]
    );
    paymentId = pay[0].id;
  }
  await client.query(
    `INSERT INTO reservation_cancel_requests
       (reservation_id, reason, requested_choice, requested_refund, collected, requested_by,
        manager_approved_by, manager_approved_at, admin_approved_by, admin_approved_at,
        status, refund_amount, treasury_account_code, refund_date, payment_id, decided_by, decided_at, decision_note)
     VALUES ($1, $2, $3, $4, $5, $6, $6, now(), $6, now(), 'approved', $4, $7, $8::date, $9, $6, now(), 'Done by the CEO')`,
    [
      reservationId,
      reason || null,
      settlement.choice,
      refund,
      round2(collected),
      user.id,
      refund > 0.009 ? treasury : null,
      refund > 0.009 ? today : null,
      paymentId,
    ]
  );
}

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

    // Money already collected: staff send the refund to finance for approval. The CEO never waits —
    // the refund is approved and paid out from the chosen treasury right away.
    const byCeo = user?.role === 'admin';
    const hasMoney = collected > 0.009;
    const needsFinance = hasMoney && !byCeo;
    if (hasMoney && byCeo) {
      await settleByCeo(client, { reservationId, user, body, reason, settlement, collected });
    } else if (needsFinance) {
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
      : hasMoney
        ? `Cancellation by the CEO: ${requested}, done`
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
