
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

  let adults = Math.max(0, Number(row.adults) || 0);
  let children = Math.max(0, Number(row.children) || 0);
  let nannyCount = Math.max(0, Number(row.nanny_count) || 0);
  if (adults <= 0 && Number(row.booking_adults) > 0) adults = Number(row.booking_adults);
  if (children <= 0 && Number(row.booking_children) > 0) children = Number(row.booking_children);
  if (nannyCount <= 0 && Number(row.booking_nanny) > 0) nannyCount = Number(row.booking_nanny);
  if (adults <= 0 && Number(row.booking_guests) > 0) {
    adults = Math.max(1, Number(row.booking_guests) - children - nannyCount);
  }

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
  let beachAccessPerAdult = 0;
  let beachAccessPerTeen = 0;
  let beachAccessMode = null;
  let beachAccessIncluded = false;
  try {
    const unitCtx = {
      property_type: row.property_type,
      cleaning_fee_egp: row.cleaning_fee_egp,
      access_fee_per_adult_egp: row.access_fee_per_adult_egp,
      access_fee_per_teen_egp: row.access_fee_per_teen_egp,
      access_card_count_included: row.access_card_count_included,
      security_deposit_egp: row.security_deposit_egp,
      project: row.project,
      compound: row.compound || row.project,
    };
    const fees = computeFees(unitCtx, {
      nights,
      subtotal: accommodation > 0 ? accommodation : Number(row.total_amount) || 0,
      adults: adults > 0 ? adults : 0,
      teens: children,
    });
    if (beachAccessFees <= 0) {
      beachAccessFees = Number(fees.access_fee_egp) || 0;
    }
    
    if (beachAccessFees <= 0 && adults <= 0 && Number(row.is_owner_reservation) !== 1) {
      const { resolveBeachAccessRates } = require('../../lib/beachAccess');
      const rates = resolveBeachAccessRates(unitCtx, nights);
      beachAccessPerAdult = Number(rates.adult) || 0;
      beachAccessPerTeen = Number(rates.extra) || 0;
      beachAccessMode = rates.mode || null;
      beachAccessIncluded = rates.mode === 'free';
      if (rates.billing === 'flat' && Number(rates.flat) > 0) {
        beachAccessFees = Number(rates.flat) || 0;
      }
    } else if (fees.beach_access) {
      beachAccessPerAdult = Number(fees.beach_access.adult) || 0;
      beachAccessPerTeen = Number(fees.beach_access.extra) || 0;
      beachAccessMode = fees.beach_access.mode || null;
      beachAccessIncluded = fees.beach_access.mode === 'free';
    }
    serviceFees = Number(fees.service_fee_egp) || 0;
    serviceFeePercent = Number(fees.service_fee_percent) || 0;
    securityDeposit = Number(fees.security_deposit_egp) || 0;
  } catch {}

  return {
    nights,
    price_per_night: pricePerNight,
    accommodation_amount: accommodation,
    housekeeping_fees: housekeepingFees,
    beach_access_fees: beachAccessFees,
    beach_access_per_adult: beachAccessPerAdult,
    beach_access_per_teen: beachAccessPerTeen,
    beach_access_mode: beachAccessMode,
    beach_access_included: beachAccessIncluded,
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
          COALESCE(u.unit_number, u.title, 'Unit') AS unit_title,
          u.unit_number,
          u.ops_status AS unit_ops_status,
          COALESCE(u.project, u.compound) AS project,
          u.property_type,
          u.cleaning_fee_egp,
          u.access_fee_per_adult_egp,
          u.access_fee_per_teen_egp,
          u.access_card_count_included,
          u.security_deposit_egp,
          b.adults AS booking_adults,
          b.children AS booking_children,
          b.nanny_count AS booking_nanny,
          b.guests AS booking_guests,
          t.id AS hk_task_id,
          t.status AS hk_task_status,
          COALESCE(t.source, 'pre_arrival') AS hk_task_source,
          t.assigned_to AS hk_assigned_to,
          ops_agent.id AS ops_assignee_id,
          ops_agent.full_name AS ops_assignee_name,
          ops_agent.staff_code AS ops_assignee_code,
          money_by.full_name AS ops_money_collected_by_name,
          hand_by.full_name AS ops_handed_over_by_name
   FROM reservations r
   JOIN units u ON u.id = r.unit_id
   LEFT JOIN bookings b ON b.id = r.booking_id
   LEFT JOIN staff_users ops_agent ON ops_agent.id = r.ops_assigned_to
   LEFT JOIN staff_users money_by ON money_by.id = r.ops_money_collected_by
   LEFT JOIN staff_users hand_by ON hand_by.id = r.ops_handed_over_by
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
    ops_money_collected_by_name: row.ops_money_collected_by_name || null,
    ops_handed_over_by_name: row.ops_handed_over_by_name || null,
    ops_handover_comment: row.ops_handover_comment || null,
    ops_handover_comment_at: row.ops_handover_comment_at || null,
    ops_handover_comment_by: row.ops_handover_comment_by || null,
    ops_comment_reviewed: Number(row.ops_comment_reviewed) === 1,
    ops_comment_reviewed_at: row.ops_comment_reviewed_at || null,
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

function parseHistoryRange(query) {
  const today = new Date();
  const toDefault = today.toISOString().slice(0, 10);
  const fromDefaultDate = new Date(today);
  fromDefaultDate.setUTCDate(fromDefaultDate.getUTCDate() - 30);
  const fromDefault = fromDefaultDate.toISOString().slice(0, 10);
  const from = String(query.from || query.from_date || fromDefault).slice(0, 10);
  const to = String(query.to || query.to_date || toDefault).slice(0, 10);
  return { from, to };
}

router.get('/ops/checkins-history', requireRoles(...OPS_ROLES), async (req, res, next) => {
  try {
    const { from, to } = parseHistoryRange(req.query);
    const params = [from, to];
    let scope = '';
    if (req.user.role === OPS_AGENT) {
      params.push(req.user.id);
      scope = ` AND r.ops_assigned_to = $${params.length}`;
    }

    const { rows } = await query(
      `${CHECKIN_SELECT}
       WHERE r.check_in::date >= $1::date
         AND r.check_in::date <= $2::date
         AND r.check_in::date < ${todayCairoSql()}
         AND r.status IS DISTINCT FROM 'cancelled'
         AND (
           COALESCE(r.ops_handed_over, 0) = 1
           OR COALESCE(r.ops_money_collected, 0) = 1
           OR r.ops_assigned_to IS NOT NULL
         )
         ${scope}
       ORDER BY r.check_in DESC, u.unit_number ASC NULLS LAST
       LIMIT 500`,
      params
    );
    res.json({ from, to, items: rows.map(mapCheckin) });
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
           ops_assigned_to = $2::int,
           ops_assigned_at = CASE WHEN $2::int IS NULL THEN NULL ELSE now() END,
           ops_assigned_by = CASE WHEN $2::int IS NULL THEN NULL ELSE $3::int END,
           updated_at = now()
         WHERE id = $1`,
        [reservationId, staffId || null, Number(req.user.id) || null]
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
  '/ops/checkins-today/:reservationId/comment',
  requireRoles(OPS_AGENT),
  async (req, res, next) => {
    try {
      const reservationId = Number(req.params.reservationId);
      const row = await fetchCheckinRow(reservationId);
      if (!row) return res.status(404).json({ error: 'Reservation not found' });
      const denied = assertOpsCanAct(req, row);
      if (denied) return res.status(403).json({ error: denied });
      if (Number(row.ops_handed_over) === 1) {
        return res.status(409).json({ error: 'Check-in already handed over' });
      }

      const comment = String(req.body?.comment || '').trim();
      if (!comment) return res.status(400).json({ error: 'Comment is required' });
      if (comment.length > 4000) {
        return res.status(400).json({ error: 'Comment is too long (max 4000 characters)' });
      }

      await query(
        `UPDATE reservations SET
           ops_handover_comment = $2,
           ops_handover_comment_at = now(),
           ops_handover_comment_by = $3,
           ops_comment_reviewed = 0,
           ops_comment_reviewed_at = NULL,
           ops_comment_reviewed_by = NULL,
           updated_at = now()
         WHERE id = $1`,
        [reservationId, comment, req.user.id]
      );

      await logAudit({
        userId: req.user.id,
        action: 'OPS_CHECKIN_COMMENT',
        entityType: 'reservation',
        entityId: reservationId,
        details: { comment_length: comment.length },
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

      
      let comment = String(req.body?.comment || row.ops_handover_comment || '').trim();
      if (req.user.role === OPS_AGENT) {
        if (!comment) {
          return res.status(400).json({
            error: 'Add a check-in comment before handing the unit to the guest',
          });
        }
        if (comment.length > 4000) {
          return res.status(400).json({ error: 'Comment is too long (max 4000 characters)' });
        }
      }

      await query(
        `UPDATE reservations SET
           ops_handed_over = 1,
           ops_handed_over_at = now(),
           ops_handed_over_by = $2,
           ops_money_collected = 1,
           ops_handover_comment = CASE
             WHEN $3::text IS NULL OR btrim($3::text) = '' THEN ops_handover_comment
             ELSE $3::text
           END,
           ops_handover_comment_at = CASE
             WHEN $3::text IS NULL OR btrim($3::text) = '' THEN ops_handover_comment_at
             ELSE now()
           END,
           ops_handover_comment_by = CASE
             WHEN $3::text IS NULL OR btrim($3::text) = '' THEN ops_handover_comment_by
             ELSE $2
           END,
           status = 'checked_in',
           updated_at = now()
         WHERE id = $1`,
        [reservationId, req.user.id, comment || null]
      );

      try {
        const { markReservationFullyCollected } = require('../../lib/settleReservationMoney');
        await markReservationFullyCollected(reservationId, {
          reason: 'ops_handover_settled',
          actorId: req.user.id,
        });
      } catch (err) {
        console.warn('[ops/handover] money settle failed', err.message);
      }

      await query(
        `UPDATE units SET ops_status = 'occupied', updated_at = now() WHERE id = $1`,
        [row.unit_id]
      );

      await logAudit({
        userId: req.user.id,
        action: 'OPS_HANDOVER_CHECKIN',
        entityType: 'reservation',
        entityId: reservationId,
        details: { unit_id: row.unit_id, has_comment: !!comment },
      });

      const updated = await fetchCheckinRow(reservationId);
      res.json(mapCheckin(updated));
    } catch (e) {
      next(e);
    }
  }
);

router.get('/ops/checkin-comments', requireRoles(...OPS_SUPER_ROLES), async (req, res, next) => {
  try {
    const { from, to } = parseHistoryRange(req.query);
    const status = String(req.query.status || 'all').toLowerCase();
    const params = [from, to];
    let reviewedFilter = '';
    if (status === 'pending') {
      reviewedFilter = ' AND COALESCE(r.ops_comment_reviewed, 0) = 0';
    } else if (status === 'reviewed') {
      reviewedFilter = ' AND COALESCE(r.ops_comment_reviewed, 0) = 1';
    }

    const { rows } = await query(
      `SELECT r.id,
              r.guest_name,
              r.guest_phone,
              r.check_in,
              r.check_out,
              r.ops_handed_over,
              r.ops_handed_over_at,
              r.ops_handover_comment,
              r.ops_handover_comment_at,
              r.ops_comment_reviewed,
              r.ops_comment_reviewed_at,
              u.unit_number,
              COALESCE(u.unit_number, u.title, 'Unit') AS unit_title,
              COALESCE(u.project, u.compound) AS project,
              agent.full_name AS comment_by_name,
              agent.staff_code AS comment_by_code,
              assignee.full_name AS ops_assignee_name,
              reviewer.full_name AS reviewed_by_name
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       LEFT JOIN staff_users agent ON agent.id = r.ops_handover_comment_by
       LEFT JOIN staff_users assignee ON assignee.id = r.ops_assigned_to
       LEFT JOIN staff_users reviewer ON reviewer.id = r.ops_comment_reviewed_by
       WHERE r.ops_handover_comment IS NOT NULL
         AND btrim(r.ops_handover_comment) <> ''
         AND COALESCE(r.ops_handover_comment_at, r.check_in)::date >= $1::date
         AND COALESCE(r.ops_handover_comment_at, r.check_in)::date <= $2::date
         ${reviewedFilter}
       ORDER BY
         COALESCE(r.ops_comment_reviewed, 0) ASC,
         r.ops_handover_comment_at DESC NULLS LAST
       LIMIT 500`,
      params
    );

    res.json({
      from,
      to,
      status,
      items: rows.map((r) => ({
        id: r.id,
        guest_name: r.guest_name,
        guest_phone: r.guest_phone,
        check_in: r.check_in,
        check_out: r.check_out,
        unit_number: r.unit_number,
        unit_title: r.unit_title,
        project: r.project,
        ops_handed_over: Number(r.ops_handed_over) === 1,
        ops_handed_over_at: r.ops_handed_over_at,
        comment: r.ops_handover_comment,
        comment_at: r.ops_handover_comment_at,
        comment_by_name: r.comment_by_name || null,
        comment_by_code: r.comment_by_code || null,
        ops_assignee_name: r.ops_assignee_name || null,
        reviewed: Number(r.ops_comment_reviewed) === 1,
        reviewed_at: r.ops_comment_reviewed_at || null,
        reviewed_by_name: r.reviewed_by_name || null,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/ops/checkin-comments/:reservationId/reviewed',
  requireRoles(...OPS_SUPER_ROLES),
  async (req, res, next) => {
    try {
      const reservationId = Number(req.params.reservationId);
      const reviewed = req.body?.reviewed === false || req.body?.reviewed === 0 ? 0 : 1;
      const { rows } = await query(
        `UPDATE reservations SET
           ops_comment_reviewed = $2,
           ops_comment_reviewed_at = CASE WHEN $2 = 1 THEN now() ELSE NULL END,
           ops_comment_reviewed_by = CASE WHEN $2 = 1 THEN $3 ELSE NULL END,
           updated_at = now()
         WHERE id = $1
           AND ops_handover_comment IS NOT NULL
           AND btrim(ops_handover_comment) <> ''
         RETURNING id, ops_comment_reviewed, ops_comment_reviewed_at`,
        [reservationId, reviewed, req.user.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Comment not found' });

      await logAudit({
        userId: req.user.id,
        action: reviewed ? 'OPS_COMMENT_REVIEWED' : 'OPS_COMMENT_UNREVIEWED',
        entityType: 'reservation',
        entityId: reservationId,
      });

      res.json({
        id: rows[0].id,
        reviewed: Number(rows[0].ops_comment_reviewed) === 1,
        reviewed_at: rows[0].ops_comment_reviewed_at,
      });
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
              COALESCE(u.unit_number, u.title, 'Unit') AS unit_title,
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

router.get('/housekeeping/cleans-history', requireRoles(...HK_READ_ROLES), async (req, res, next) => {
  try {
    const { from, to } = parseHistoryRange(req.query);
    const params = [from, to];
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
              COALESCE(u.unit_number, u.title, 'Unit') AS unit_title,
              COALESCE(u.project, u.compound) AS project,
              t.id AS task_id,
              t.status AS task_status,
              t.assigned_to,
              t.assigned_at,
              t.submitted_at,
              t.ready_at,
              hk_agent.full_name AS assignee_name,
              hk_agent.staff_code AS assignee_code
       FROM housekeeping_tasks t
       JOIN reservations r ON r.id = t.reservation_id
       JOIN units u ON u.id = COALESCE(t.unit_id, r.unit_id)
       LEFT JOIN staff_users hk_agent ON hk_agent.id = t.assigned_to
       WHERE COALESCE(t.source, 'pre_arrival') = 'pre_arrival'
         AND r.check_in::date >= $1::date
         AND r.check_in::date <= $2::date
         AND r.check_in::date < ${todayCairoSql()}
         AND r.status IS DISTINCT FROM 'cancelled'
         AND (
           t.status = 'ready'
           OR t.assigned_to IS NOT NULL
           OR t.submitted_at IS NOT NULL
         )
         ${scope}
       ORDER BY r.check_in DESC, u.unit_number ASC NULLS LAST
       LIMIT 500`,
      params
    );

    res.json({
      from,
      to,
      items: rows.map((r) => ({
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
        submitted_at: r.submitted_at || r.ready_at || null,
        assignee_name: r.assignee_name || null,
        assignee_code: r.assignee_code || null,
      })),
    });
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
           assigned_to = $2::int,
           assigned_at = CASE WHEN $2::int IS NULL THEN NULL ELSE now() END,
           assigned_by = CASE WHEN $2::int IS NULL THEN NULL ELSE $3::int END,
           updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [taskId, staffId || null, Number(req.user.id) || null]
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
