/**
 * Operations check-ins today + Housekeeping today cleans.
 */
const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { logAudit } = require('../../lib/audit');
const { syncReservationPaymentStatus } = require('../../lib/syncReservationPayment');
const { DEFAULT_CHECKLIST, ensurePreArrivalTasks } = require('../../jobs/housekeepingTasks');

const router = express.Router();

const OPS_ROLES = ['admin', 'operations'];
const HK_ROLES = ['admin', 'housekeeping'];
const HK_READ_ROLES = ['admin', 'housekeeping', 'operations'];

function todayCairoSql() {
  return `(timezone('Africa/Cairo', now()))::date`;
}

function remainingOf(row) {
  const total = Number(row.total_amount) || 0;
  const paid = Number(row.amount_paid) || 0;
  return Math.max(0, Math.round((total - paid) * 100) / 100);
}

function isHkCleaned(status) {
  return String(status || '').toLowerCase() === 'ready';
}

function moneySatisfied(row) {
  if (Number(row.ops_money_collected) === 1) return true;
  return remainingOf(row) <= 0.5;
}

async function fetchCheckinRow(reservationId) {
  const { rows } = await query(
    `SELECT r.*,
            COALESCE(u.title, u.unit_number, 'Unit') AS unit_title,
            u.unit_number,
            u.ops_status AS unit_ops_status,
            COALESCE(u.project, u.compound) AS project,
            t.id AS hk_task_id,
            t.status AS hk_task_status,
            COALESCE(t.source, 'pre_arrival') AS hk_task_source
     FROM reservations r
     JOIN units u ON u.id = r.unit_id
     LEFT JOIN LATERAL (
       SELECT ht.id, ht.status, ht.source
       FROM housekeeping_tasks ht
       WHERE ht.reservation_id = r.id
         AND COALESCE(ht.source, 'pre_arrival') = 'pre_arrival'
       ORDER BY ht.created_at DESC
       LIMIT 1
     ) t ON TRUE
     WHERE r.id = $1`,
    [reservationId]
  );
  return rows[0] || null;
}

function mapCheckin(row) {
  const remaining = remainingOf(row);
  const moneyCollected = moneySatisfied(row);
  const hkCleaned = isHkCleaned(row.hk_task_status);
  const handedOver = Number(row.ops_handed_over) === 1;
  return {
    id: row.id,
    guest_name: row.guest_name,
    guest_phone: row.guest_phone,
    unit_id: row.unit_id,
    unit_number: row.unit_number,
    unit_title: row.unit_title,
    project: row.project,
    check_in: row.check_in,
    check_out: row.check_out,
    status: row.status,
    total_amount: Number(row.total_amount) || 0,
    amount_paid: Number(row.amount_paid) || 0,
    remaining_amount: remaining,
    payment_status: row.payment_status,
    payment_method: row.payment_method,
    ops_money_collected: moneyCollected,
    ops_money_collected_amount: Number(row.ops_money_collected_amount) || 0,
    ops_money_collected_at: row.ops_money_collected_at,
    ops_handed_over: handedOver,
    ops_handed_over_at: row.ops_handed_over_at,
    hk_task_id: row.hk_task_id || null,
    hk_task_status: row.hk_task_status || null,
    hk_cleaned: hkCleaned,
    can_handover: moneyCollected && hkCleaned && !handedOver,
    unit_ops_status: row.unit_ops_status,
  };
}

router.get('/ops/checkins-today', requireRoles(...OPS_ROLES), async (req, res, next) => {
  try {
    try {
      await ensurePreArrivalTasks();
    } catch (err) {
      console.error('[ops/checkins-today] ensurePreArrivalTasks', err.message);
    }
    const { rows } = await query(
      `SELECT r.*,
              COALESCE(u.title, u.unit_number, 'Unit') AS unit_title,
              u.unit_number,
              u.ops_status AS unit_ops_status,
              COALESCE(u.project, u.compound) AS project,
              t.id AS hk_task_id,
              t.status AS hk_task_status,
              COALESCE(t.source, 'pre_arrival') AS hk_task_source
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       LEFT JOIN LATERAL (
         SELECT ht.id, ht.status, ht.source
         FROM housekeeping_tasks ht
         WHERE ht.reservation_id = r.id
           AND COALESCE(ht.source, 'pre_arrival') = 'pre_arrival'
         ORDER BY ht.created_at DESC
         LIMIT 1
       ) t ON TRUE
       WHERE r.check_in::date = ${todayCairoSql()}
         AND r.status IS DISTINCT FROM 'cancelled'
       ORDER BY r.check_in ASC, u.unit_number ASC NULLS LAST`
    );
    res.json(rows.map(mapCheckin));
  } catch (e) {
    next(e);
  }
});

router.post(
  '/ops/checkins-today/:reservationId/collect',
  requireRoles(...OPS_ROLES),
  async (req, res, next) => {
    try {
      const reservationId = Number(req.params.reservationId);
      const row = await fetchCheckinRow(reservationId);
      if (!row) return res.status(404).json({ error: 'Reservation not found' });
      if (String(row.status).toLowerCase() === 'cancelled') {
        return res.status(409).json({ error: 'Reservation is cancelled' });
      }
      if (row.check_in && String(row.check_in).slice(0, 10) !== undefined) {
        /* allow collect even if slightly off-day for handed stays still listed */
      }

      const remaining = remainingOf(row);
      if (remaining <= 0.5) {
        await query(
          `UPDATE reservations SET
             ops_money_collected = 1,
             ops_money_collected_at = COALESCE(ops_money_collected_at, now()),
             ops_money_collected_by = COALESCE(ops_money_collected_by, $2),
             ops_money_collected_amount = COALESCE(ops_money_collected_amount, 0),
             updated_at = now()
           WHERE id = $1`,
          [reservationId, req.user.id]
        );
        const updated = await fetchCheckinRow(reservationId);
        return res.json(mapCheckin(updated));
      }

      let amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount <= 0) amount = remaining;
      amount = Math.round(amount * 100) / 100;
      if (amount > remaining + 0.5) {
        return res.status(400).json({ error: `Amount cannot exceed remaining EGP ${remaining}` });
      }

      let method = String(req.body?.payment_method || 'cash').toLowerCase();
      if (!['cash', 'instapay', 'bank_transfer'].includes(method)) method = 'cash';

      await query(
        `INSERT INTO payments (
           reservation_id, amount, payment_date, payment_method,
           notes, created_by, status, is_approved, approved_by, approved_at, paid_at
         ) VALUES (
           $1, $2, CURRENT_DATE, $3,
           $4, $5, 'successful', 1, $5, now(), now()
         )`,
        [
          reservationId,
          amount,
          method,
          `[ops check-in] Collected at door by ${req.user.full_name || req.user.username || req.user.id}`,
          req.user.id,
        ]
      );

      await syncReservationPaymentStatus(reservationId);

      await query(
        `UPDATE reservations SET
           ops_money_collected = 1,
           ops_money_collected_at = now(),
           ops_money_collected_by = $2,
           ops_money_collected_amount = COALESCE(ops_money_collected_amount, 0) + $3,
           updated_at = now()
         WHERE id = $1`,
        [reservationId, req.user.id, amount]
      );

      await logAudit({
        userId: req.user.id,
        action: 'OPS_COLLECT_CHECKIN',
        entityType: 'reservation',
        entityId: reservationId,
        details: { amount, payment_method: method },
      });

      const updated = await fetchCheckinRow(reservationId);
      res.json(mapCheckin(updated));
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/ops/checkins-today/:reservationId/handover',
  requireRoles(...OPS_ROLES),
  async (req, res, next) => {
    try {
      const reservationId = Number(req.params.reservationId);
      const row = await fetchCheckinRow(reservationId);
      if (!row) return res.status(404).json({ error: 'Reservation not found' });
      if (Number(row.ops_handed_over) === 1) {
        return res.json(mapCheckin(row));
      }
      if (!moneySatisfied(row)) {
        return res.status(400).json({ error: 'Collect remaining balance before handover' });
      }
      if (!isHkCleaned(row.hk_task_status)) {
        return res.status(400).json({ error: 'Housekeeping must mark the unit cleaned first' });
      }

      await query(
        `UPDATE reservations SET
           ops_handed_over = 1,
           ops_handed_over_at = now(),
           ops_handed_over_by = $2,
           ops_money_collected = 1,
           status = 'checked_in',
           updated_at = now()
         WHERE id = $1`,
        [reservationId, req.user.id]
      );

      await query(
        `UPDATE units SET ops_status = 'occupied', updated_at = now() WHERE id = $1`,
        [row.unit_id]
      );

      await logAudit({
        userId: req.user.id,
        action: 'OPS_HANDOVER_CHECKIN',
        entityType: 'reservation',
        entityId: reservationId,
        details: { unit_id: row.unit_id },
      });

      const updated = await fetchCheckinRow(reservationId);
      res.json(mapCheckin(updated));
    } catch (e) {
      next(e);
    }
  }
);

router.get('/housekeeping/today-cleans', requireRoles(...HK_READ_ROLES), async (req, res, next) => {
  try {
    try {
      await ensurePreArrivalTasks();
    } catch (err) {
      console.error('[housekeeping/today-cleans] ensurePreArrivalTasks', err.message);
    }

    // Ensure every today check-in has a pre-arrival task (job covers today+tomorrow; double-check).
    const { rows: missing } = await query(
      `SELECT r.id AS reservation_id, r.unit_id, r.check_in
       FROM reservations r
       WHERE r.check_in::date = ${todayCairoSql()}
         AND r.status IS DISTINCT FROM 'cancelled'
         AND NOT EXISTS (
           SELECT 1 FROM housekeeping_tasks t
           WHERE t.reservation_id = r.id
             AND COALESCE(t.source, 'pre_arrival') = 'pre_arrival'
         )`
    );
    for (const m of missing) {
      await query(
        `INSERT INTO housekeeping_tasks (
           reservation_id, unit_id, status, checklist, due_at, source
         ) VALUES ($1, $2, 'pending', $3::jsonb, now(), 'pre_arrival')`,
        [m.reservation_id, m.unit_id, JSON.stringify(DEFAULT_CHECKLIST)]
      );
    }

    const { rows } = await query(
      `SELECT r.id AS reservation_id,
              r.guest_name,
              r.guest_phone,
              r.check_in,
              r.check_out,
              r.status AS reservation_status,
              u.id AS unit_id,
              u.unit_number,
              COALESCE(u.title, u.unit_number, 'Unit') AS unit_title,
              COALESCE(u.project, u.compound) AS project,
              t.id AS task_id,
              t.status AS task_status,
              t.accepted_at,
              t.started_at,
              t.submitted_at
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       LEFT JOIN LATERAL (
         SELECT ht.*
         FROM housekeeping_tasks ht
         WHERE ht.reservation_id = r.id
           AND COALESCE(ht.source, 'pre_arrival') = 'pre_arrival'
         ORDER BY ht.created_at DESC
         LIMIT 1
       ) t ON TRUE
       WHERE r.check_in::date = ${todayCairoSql()}
         AND r.status IS DISTINCT FROM 'cancelled'
       ORDER BY u.unit_number ASC NULLS LAST`
    );

    res.json(
      rows.map((r) => ({
        reservation_id: r.reservation_id,
        guest_name: r.guest_name,
        guest_phone: r.guest_phone,
        check_in: r.check_in,
        check_out: r.check_out,
        unit_id: r.unit_id,
        unit_number: r.unit_number,
        unit_title: r.unit_title,
        project: r.project,
        task_id: r.task_id,
        task_status: r.task_status || 'pending',
        cleaned: isHkCleaned(r.task_status),
      }))
    );
  } catch (e) {
    next(e);
  }
});

router.post(
  '/housekeeping/today-cleans/:taskId/cleaned',
  requireRoles(...HK_ROLES),
  async (req, res, next) => {
    try {
      const taskId = Number(req.params.taskId);
      const { rows: existing } = await query(`SELECT * FROM housekeeping_tasks WHERE id = $1`, [
        taskId,
      ]);
      const task = existing[0];
      if (!task) return res.status(404).json({ error: 'Task not found' });

      const { rows } = await query(
        `UPDATE housekeeping_tasks SET
           status = 'ready',
           assigned_to = COALESCE(assigned_to, $2),
           accepted_at = COALESCE(accepted_at, now()),
           started_at = COALESCE(started_at, now()),
           submitted_at = COALESCE(submitted_at, now()),
           updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [taskId, req.user.id]
      );

      // Unit available for handover (cleaned); Ops will set occupied on handover.
      if (task.unit_id) {
        await query(
          `UPDATE units SET
             ops_status = CASE WHEN ops_status = 'maintenance' THEN ops_status ELSE 'available' END,
             updated_at = now()
           WHERE id = $1`,
          [task.unit_id]
        );
      }

      await logAudit({
        userId: req.user.id,
        action: 'HK_MARK_CLEANED_TODAY',
        entityType: 'housekeeping_task',
        entityId: taskId,
        details: { reservation_id: task.reservation_id },
      });

      res.json({
        ...rows[0],
        cleaned: true,
      });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
