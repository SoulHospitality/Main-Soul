/**
 * Operations check-ins today + Housekeeping today cleans + supervisor assignment.
 */
const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { logAudit } = require('../../lib/audit');
const { syncReservationPaymentStatus } = require('../../lib/syncReservationPayment');
const { DEFAULT_CHECKLIST, ensurePreArrivalTasks } = require('../../jobs/housekeepingTasks');
const { computeFees } = require('../../services/pricing');

const router = express.Router();

const OPS_AGENT = 'operations';
const OPS_SUPER = 'operations_supervisor';
const HK_AGENT = 'housekeeping';
const HK_SUPER = 'housekeeping_supervisor';

const OPS_ROLES = ['admin', OPS_AGENT, OPS_SUPER];
const OPS_SUPER_ROLES = ['admin', OPS_SUPER];
const HK_ROLES = ['admin', HK_AGENT, HK_SUPER];
const HK_SUPER_ROLES = ['admin', HK_SUPER];
const HK_READ_ROLES = ['admin', HK_AGENT, HK_SUPER, OPS_AGENT, OPS_SUPER];

function todayCairoSql() {
  return `(timezone('Africa/Cairo', now()))::date`;
}

function isOpsSupervisor(user) {
  return user?.role === 'admin' || user?.role === OPS_SUPER;
}

function isHkSupervisor(user) {
  return user?.role === 'admin' || user?.role === HK_SUPER;
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

function paymentBreakdown(row) {
  const nights = Number(row.nights) || 0;
  const pricePerNight = Number(row.price_per_night) || 0;
  const accommodation = Math.round(pricePerNight * nights * 100) / 100;
  const housekeepingFees = Number(row.housekeeping_fees) || 0;
  const insurance = Number(row.insurance) || 0;
  const utilities = Number(row.utilities_amount) || 0;
  const downPayment = Number(row.down_payment) || 0;
  const adults = Math.max(0, Number(row.adults) || 0);
  const children = Math.max(0, Number(row.children) || 0);
  const nannyCount = Math.max(0, Number(row.nanny_count) || 0);

  // Prefer the real beach amount stored on the reservation (import / manual).
  let beachAccessFees = Number(row.beach_access_fees);
  if (!Number.isFinite(beachAccessFees) || beachAccessFees < 0) beachAccessFees = 0;

  if (beachAccessFees <= 0 && row.notes) {
    const m = String(row.notes).match(/Beach pass:\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
    if (m) {
      const parsed = Number(String(m[1]).replace(/,/g, ''));
      if (Number.isFinite(parsed) && parsed > 0) beachAccessFees = parsed;
    }
  }

  let serviceFees = 0;
  let serviceFeePercent = 0;
  let securityDeposit = 0;
  try {
    const fees = computeFees(
      {
        property_type: row.property_type,
        cleaning_fee_egp: row.cleaning_fee_egp,
        access_fee_per_adult_egp: row.access_fee_per_adult_egp,
        access_fee_per_teen_egp: row.access_fee_per_teen_egp,
        access_card_count_included: row.access_card_count_included,
        security_deposit_egp: row.security_deposit_egp,
        project: row.project,
        compound: row.compound || row.project,
      },
      {
        nights,
        subtotal: accommodation > 0 ? accommodation : Number(row.total_amount) || 0,
        // Do not invent a guest — only use recorded party size for recomputes.
        adults,
        teens: children,
      }
    );
    if (beachAccessFees <= 0) {
      beachAccessFees = Number(fees.access_fee_egp) || 0;
    }
    serviceFees = Number(fees.service_fee_egp) || 0;
    serviceFeePercent = Number(fees.service_fee_percent) || 0;
    securityDeposit = Number(fees.security_deposit_egp) || 0;
  } catch {
    /* ignore fee compute errors */
  }

  return {
    nights,
    price_per_night: pricePerNight,
    accommodation_amount: accommodation,
    housekeeping_fees: housekeepingFees,
    beach_access_fees: beachAccessFees,
    service_fees: serviceFees,
    service_fee_percent: serviceFeePercent,
    insurance,
    utilities_amount: utilities,
    down_payment: downPayment,
    owner_collected_type: row.owner_collected_type || null,
    owner_collected_amount: Number(row.owner_collected_amount) || 0,
    adults,
    children,
    nanny_count: nannyCount,
    guests_total: adults + children + nannyCount,
    security_deposit: securityDeposit,
  };
}

const CHECKIN_SELECT = `
  SELECT r.*,
          COALESCE(u.title, u.unit_number, 'Unit') AS unit_title,
          u.unit_number,
          u.ops_status AS unit_ops_status,
          COALESCE(u.project, u.compound) AS project,
          u.property_type,
          u.cleaning_fee_egp,
          u.access_fee_per_adult_egp,
          u.access_fee_per_teen_egp,
          u.access_card_count_included,
          u.security_deposit_egp,
          t.id AS hk_task_id,
          t.status AS hk_task_status,
          COALESCE(t.source, 'pre_arrival') AS hk_task_source,
          t.assigned_to AS hk_assigned_to,
          ops_agent.id AS ops_assignee_id,
          ops_agent.full_name AS ops_assignee_name,
          ops_agent.staff_code AS ops_assignee_code
   FROM reservations r
   JOIN units u ON u.id = r.unit_id
   LEFT JOIN staff_users ops_agent ON ops_agent.id = r.ops_assigned_to
   LEFT JOIN LATERAL (
     SELECT ht.id, ht.status, ht.source, ht.assigned_to
     FROM housekeeping_tasks ht
     WHERE ht.reservation_id = r.id
       AND COALESCE(ht.source, 'pre_arrival') = 'pre_arrival'
     ORDER BY ht.created_at DESC
     LIMIT 1
   ) t ON TRUE
`;

async function fetchCheckinRow(reservationId) {
  const { rows } = await query(`${CHECKIN_SELECT} WHERE r.id = $1`, [reservationId]);
  return rows[0] || null;
}

function mapCheckin(row) {
  const remaining = remainingOf(row);
  const moneyCollected = moneySatisfied(row);
  const hkCleaned = isHkCleaned(row.hk_task_status);
  const handedOver = Number(row.ops_handed_over) === 1;
  const breakdown = paymentBreakdown(row);
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
    payment_breakdown: breakdown,
    ops_money_collected: moneyCollected,
    ops_money_collected_amount: Number(row.ops_money_collected_amount) || 0,
    ops_money_collected_at: row.ops_money_collected_at,
    ops_handed_over: handedOver,
    ops_handed_over_at: row.ops_handed_over_at,
    ops_assigned_to: row.ops_assigned_to || null,
    ops_assigned_at: row.ops_assigned_at || null,
    ops_assignee_name: row.ops_assignee_name || null,
    ops_assignee_code: row.ops_assignee_code || null,
    hk_task_id: row.hk_task_id || null,
    hk_task_status: row.hk_task_status || null,
    hk_cleaned: hkCleaned,
    hk_assigned_to: row.hk_assigned_to || null,
    can_handover: moneyCollected && hkCleaned && !handedOver,
    unit_ops_status: row.unit_ops_status,
  };
}

function assertOpsCanAct(req, row) {
  if (isOpsSupervisor(req.user)) return null;
  if (req.user.role !== OPS_AGENT) return 'Forbidden';
  if (!row.ops_assigned_to || Number(row.ops_assigned_to) !== Number(req.user.id)) {
    return 'This check-in is not assigned to you';
  }
  return null;
}

function assertHkCanAct(req, task) {
  if (isHkSupervisor(req.user)) return null;
  if (req.user.role !== HK_AGENT) return 'Forbidden';
  if (!task.assigned_to || Number(task.assigned_to) !== Number(req.user.id)) {
    return 'This clean is not assigned to you';
  }
  return null;
}

router.get('/ops/agents', requireRoles(...OPS_SUPER_ROLES), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, full_name, username, staff_code
       FROM staff_users
       WHERE role = $1 AND is_active = 1
       ORDER BY full_name ASC NULLS LAST, username ASC`,
      [OPS_AGENT]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get('/housekeeping/agents', requireRoles(...HK_SUPER_ROLES), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, full_name, username, staff_code
       FROM staff_users
       WHERE role = $1 AND is_active = 1
       ORDER BY full_name ASC NULLS LAST, username ASC`,
      [HK_AGENT]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get('/ops/checkins-today', requireRoles(...OPS_ROLES), async (req, res, next) => {
  try {
    try {
      await ensurePreArrivalTasks();
    } catch (err) {
      console.error('[ops/checkins-today] ensurePreArrivalTasks', err.message);
    }

    const params = [];
    let scope = '';
    if (req.user.role === OPS_AGENT) {
      params.push(req.user.id);
      scope = ` AND r.ops_assigned_to = $${params.length}`;
    }

    const { rows } = await query(
      `${CHECKIN_SELECT}
       WHERE r.check_in::date = ${todayCairoSql()}
         AND r.status IS DISTINCT FROM 'cancelled'
         ${scope}
       ORDER BY r.check_in ASC, u.unit_number ASC NULLS LAST`,
      params
    );
    res.json(rows.map(mapCheckin));
  } catch (e) {
    next(e);
  }
});

router.post(
  '/ops/checkins-today/:reservationId/assign',
  requireRoles(...OPS_SUPER_ROLES),
  async (req, res, next) => {
    try {
      const reservationId = Number(req.params.reservationId);
      const staffId = req.body?.staff_id != null ? Number(req.body.staff_id) : null;
      const row = await fetchCheckinRow(reservationId);
      if (!row) return res.status(404).json({ error: 'Reservation not found' });

      if (staffId) {
        const { rows: agents } = await query(
          `SELECT id FROM staff_users WHERE id = $1 AND role = $2 AND is_active = 1`,
          [staffId, OPS_AGENT]
        );
        if (!agents[0]) return res.status(400).json({ error: 'Select an active operations agent' });
      }

      await query(
        `UPDATE reservations SET
           ops_assigned_to = $2,
           ops_assigned_at = CASE WHEN $2::int IS NULL THEN NULL ELSE now() END,
           ops_assigned_by = CASE WHEN $2::int IS NULL THEN NULL ELSE $3 END,
           updated_at = now()
         WHERE id = $1`,
        [reservationId, staffId || null, req.user.id]
      );

      await logAudit({
        userId: req.user.id,
        action: 'OPS_ASSIGN_CHECKIN',
        entityType: 'reservation',
        entityId: reservationId,
        details: { staff_id: staffId || null },
      });

      const updated = await fetchCheckinRow(reservationId);
      res.json(mapCheckin(updated));
    } catch (e) {
      next(e);
    }
  }
);

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
      const denied = assertOpsCanAct(req, row);
      if (denied) return res.status(403).json({ error: denied });

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
      const denied = assertOpsCanAct(req, row);
      if (denied) return res.status(403).json({ error: denied });
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

    const params = [];
    let scope = '';
    if (req.user.role === HK_AGENT) {
      params.push(req.user.id);
      scope = ` AND t.assigned_to = $${params.length}`;
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
              t.assigned_to,
              t.assigned_at,
              hk_agent.full_name AS assignee_name,
              hk_agent.staff_code AS assignee_code,
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
       LEFT JOIN staff_users hk_agent ON hk_agent.id = t.assigned_to
       WHERE r.check_in::date = ${todayCairoSql()}
         AND r.status IS DISTINCT FROM 'cancelled'
         ${scope}
       ORDER BY u.unit_number ASC NULLS LAST`,
      params
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
        assigned_to: r.assigned_to || null,
        assigned_at: r.assigned_at || null,
        assignee_name: r.assignee_name || null,
        assignee_code: r.assignee_code || null,
      }))
    );
  } catch (e) {
    next(e);
  }
});

router.post(
  '/housekeeping/today-cleans/:taskId/assign',
  requireRoles(...HK_SUPER_ROLES),
  async (req, res, next) => {
    try {
      const taskId = Number(req.params.taskId);
      const staffId = req.body?.staff_id != null ? Number(req.body.staff_id) : null;
      const { rows: existing } = await query(`SELECT * FROM housekeeping_tasks WHERE id = $1`, [
        taskId,
      ]);
      const task = existing[0];
      if (!task) return res.status(404).json({ error: 'Task not found' });

      if (staffId) {
        const { rows: agents } = await query(
          `SELECT id FROM staff_users WHERE id = $1 AND role = $2 AND is_active = 1`,
          [staffId, HK_AGENT]
        );
        if (!agents[0]) {
          return res.status(400).json({ error: 'Select an active housekeeping agent' });
        }
      }

      const { rows } = await query(
        `UPDATE housekeeping_tasks SET
           assigned_to = $2,
           assigned_at = CASE WHEN $2::int IS NULL THEN NULL ELSE now() END,
           assigned_by = CASE WHEN $2::int IS NULL THEN NULL ELSE $3 END,
           updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [taskId, staffId || null, req.user.id]
      );

      await logAudit({
        userId: req.user.id,
        action: 'HK_ASSIGN_TODAY_CLEAN',
        entityType: 'housekeeping_task',
        entityId: taskId,
        details: { staff_id: staffId || null, reservation_id: task.reservation_id },
      });

      let assignee = null;
      if (rows[0]?.assigned_to) {
        const { rows: agents } = await query(
          `SELECT id, full_name, staff_code FROM staff_users WHERE id = $1`,
          [rows[0].assigned_to]
        );
        assignee = agents[0] || null;
      }

      res.json({
        ...rows[0],
        cleaned: isHkCleaned(rows[0].status),
        assignee_name: assignee?.full_name || null,
        assignee_code: assignee?.staff_code || null,
      });
    } catch (e) {
      next(e);
    }
  }
);

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
      const denied = assertHkCanAct(req, task);
      if (denied) return res.status(403).json({ error: denied });

      const { rows } = await query(
        `UPDATE housekeeping_tasks SET
           status = 'ready',
           assigned_to = COALESCE(assigned_to, $2),
           accepted_at = COALESCE(accepted_at, now()),
           started_at = COALESCE(started_at, now()),
           submitted_at = COALESCE(submitted_at, now()),
           ready_at = COALESCE(ready_at, now()),
           updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [taskId, req.user.id]
      );

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
