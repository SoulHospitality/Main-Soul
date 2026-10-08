
const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { logAudit } = require('../../lib/audit');
const { syncReservationPaymentStatus } = require('../../lib/syncReservationPayment');
const { DEFAULT_CHECKLIST, ensurePreArrivalTasks } = require('../../jobs/housekeepingTasks');
const {
  upload,
  attachCloudinaryUrls,
  setCloudinaryFolder,
  FOLDER_PAYMENTS,
  FOLDER_INSPECTIONS,
} = require('../../config/cloudinary');
const { recordOpsPettyCash } = require('../../lib/opsPettyCash');
const { normalizeBankAccount } = require('../../lib/reservationCurrency');

const router = express.Router();

function fileUrl(file) {
  return file ? file.secure_url || file.path || null : null;
}

/** Multipart bodies send nested objects as JSON strings. */
function parseJsonField(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function logAssignment({ reservationId = null, taskId = null, kind, fromId, toId, reason, userId }) {
  await query(
    `INSERT INTO ops_assignment_log
       (reservation_id, housekeeping_task_id, kind, from_staff_id, to_staff_id, reason, changed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [reservationId, taskId, kind, fromId || null, toId || null, reason || null, userId || null]
  );
}

/** Changing an existing assignee to someone else needs a reason. */
function reassignReasonError(previousId, nextId, reason) {
  const changing = previousId && Number(previousId) !== Number(nextId || 0);
  if (changing && !String(reason || '').trim()) {
    return 'Add a reason for changing the assignment';
  }
  return null;
}

async function notifyGuestOfAgent(row, staffId) {
  try {
    const { rows } = await query(`SELECT id, full_name, phone FROM staff_users WHERE id = $1`, [staffId]);
    if (!rows[0]) return;
    const { sendCheckinAgentWhatsApp } = require('../../services/guestWhatsApp');
    await sendCheckinAgentWhatsApp(row, rows[0]);
  } catch (err) {
    console.warn('[ops/assign] guest WhatsApp failed', err.message);
  }
}

const OPS_AGENT = 'operations';
const OPS_SUPER = 'operations_supervisor';

const OPS_ROLES = ['admin', OPS_AGENT, OPS_SUPER];
const OPS_SUPER_ROLES = ['admin', OPS_SUPER];
const HK_READ_ROLES = ['admin', OPS_AGENT, OPS_SUPER];
const HK_SUPER_ROLES = ['admin', OPS_SUPER];
const HK_ROLES = ['admin', OPS_AGENT, OPS_SUPER];

function todayCairoSql() {
  return `(timezone('Africa/Cairo', now()))::date`;
}

function cairoTodayYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd)
    .slice(0, 10)
    .split('-')
    .map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + Number(days || 0)));
  return dt.toISOString().slice(0, 10);
}

/** Ops list ranges: today | tomorrow | week | month (default). */
function parseOpsDateRange(rangeRaw) {
  const key = String(rangeRaw || 'month')
    .trim()
    .toLowerCase();
  const today = cairoTodayYmd();

  if (key === 'today') {
    return { range: 'today', from: today, to: today };
  }
  if (key === 'tomorrow') {
    const tomorrow = addDaysYmd(today, 1);
    return { range: 'tomorrow', from: tomorrow, to: tomorrow };
  }
  if (key === 'week') {
    const [y, m, d] = today.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const from = addDaysYmd(today, mondayOffset);
    const to = addDaysYmd(from, 6);
    return { range: 'week', from, to };
  }

  const [y, m] = today.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { range: 'month', from, to };
}

function isOpsSupervisor(user) {
  return user?.role === 'admin' || user?.role === OPS_SUPER;
}

function isHkSupervisor(user) {
  return user?.role === 'admin' || user?.role === OPS_SUPER;
}

function roundMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.round(v * 100) / 100;
}

/** Full stay bill = sum of all line items (not accommodation-only). */
function fullBillTotalFromParts(parts) {
  return roundMoney(
    (Number(parts.accommodation_amount) || 0) +
      (Number(parts.housekeeping_fees) || 0) +
      (Number(parts.beach_access_fees) || 0) +
      (Number(parts.service_fees) || 0) +
      (Number(parts.insurance) || 0)
  );
}

function remainingOf(row, billTotal = null) {
  const total =
    billTotal != null && Number.isFinite(Number(billTotal))
      ? Number(billTotal)
      : Number(row.total_amount) || 0;
  const paid = Number(row.amount_paid) || 0;
  return Math.max(0, Math.round((total - paid) * 100) / 100);
}

/** Apply door-edited bill lines, then return the refreshed check-in row. */
async function applyCollectBillEdits(reservationId, bill, row) {
  if (!bill || typeof bill !== 'object') return row;

  const nights = Number(row.nights) || 0;
  const accommodation = roundMoney(bill.accommodation_amount);
  const housekeeping = roundMoney(bill.housekeeping_fees);
  const beach = roundMoney(bill.beach_access_fees);
  const service = roundMoney(bill.service_fees);
  const insurance = roundMoney(bill.insurance);
  const utilities =
    bill.utilities_amount != null ? roundMoney(bill.utilities_amount) : roundMoney(row.utilities_amount);

  const finalTotal = roundMoney(accommodation + housekeeping + beach + service + insurance);
  if (!(finalTotal > 0) && remainingOf(row) > 0.5) {
    const err = new Error('Edited bill total must be greater than zero');
    err.status = 400;
    throw err;
  }

  const paid = roundMoney(row.amount_paid);
  if (finalTotal + 0.5 < paid) {
    const err = new Error(
      `Final bill (EGP ${finalTotal}) cannot be less than already paid (EGP ${paid})`
    );
    err.status = 400;
    throw err;
  }

  const pricePerNight =
    nights > 0 ? roundMoney(accommodation / nights) : roundMoney(row.price_per_night);

  await query(
    `UPDATE reservations SET
       price_per_night = $2,
       housekeeping_fees = $3,
       beach_access_fees = $4,
       insurance = $5,
       utilities_amount = $6,
       total_amount = $7,
       updated_at = now()
     WHERE id = $1`,
    [reservationId, pricePerNight, housekeeping, beach, insurance, utilities, finalTotal]
  );

  return fetchCheckinRow(reservationId);
}

function isHkCleaned(status) {
  return String(status || '').toLowerCase() === 'ready';
}

function moneySatisfied(row) {
  if (Number(row.ops_money_collected) === 1) return true;
  const breakdown = paymentBreakdown(row);
  return remainingOf(row, breakdown.full_bill_total) <= 0.5;
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
  let serviceFeePercent = 15;
  try {
    const subtotal = accommodation > 0 ? accommodation : Number(row.total_amount) || 0;
    serviceFees = Math.round(Number(subtotal || 0) * (serviceFeePercent / 100));
  } catch {}

  const parts = {
    accommodation_amount: accommodation,
    housekeeping_fees: housekeepingFees,
    beach_access_fees: beachAccessFees,
    service_fees: serviceFees,
    insurance,
    utilities_amount: utilities,
  };
  const lineSum = fullBillTotalFromParts(parts);
  const storedTotal = roundMoney(row.total_amount);
  // Prefer line-item sum; if DB total is higher (legacy lump / edited extras), keep it.
  const totalAmount = storedTotal > lineSum + 0.5 ? storedTotal : lineSum;

  return {
    nights,
    price_per_night: pricePerNight,
    ...parts,
    service_fee_percent: serviceFeePercent,
    down_payment: downPayment,
    owner_collected_type: row.owner_collected_type || null,
    owner_collected_amount: Number(row.owner_collected_amount) || 0,
    adults,
    children,
    nanny_count: nannyCount,
    guests_total: adults + children + nannyCount,
    total_amount: totalAmount,
    full_bill_total: totalAmount,
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
          co_agent.full_name AS ops_checkout_assignee_name,
          money_by.full_name AS ops_money_collected_by_name,
          hand_by.full_name AS ops_handed_over_by_name,
          sp.full_name AS sales_person_name,
          creator.full_name AS created_by_name,
          cancel_by.full_name AS ops_cancelled_by_name
   FROM reservations r
   JOIN units u ON u.id = r.unit_id
   LEFT JOIN bookings b ON b.id = r.booking_id
   LEFT JOIN staff_users ops_agent ON ops_agent.id = r.ops_assigned_to
   LEFT JOIN staff_users co_agent ON co_agent.id = r.ops_checkout_assigned_to
   LEFT JOIN staff_users sp ON sp.id = r.sales_person_id
   LEFT JOIN staff_users creator ON creator.id = r.created_by
   LEFT JOIN staff_users cancel_by ON cancel_by.id = r.ops_cancelled_by
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
  const breakdown = paymentBreakdown(row);
  const billTotal = Number(breakdown.full_bill_total) || Number(breakdown.total_amount) || 0;
  const remaining = remainingOf(row, billTotal);
  const moneyCollected =
    Number(row.ops_money_collected) === 1 || remaining <= 0.5;
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
    total_amount: billTotal,
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
    nights: Number(row.nights) || 0,
    price_per_night: Number(row.price_per_night) || 0,
    sales_person_name: row.sales_person_name || row.sales_label || null,
    created_by_name: row.created_by_name || null,
    booking_source: row.booking_source || null,
    notes: row.notes || null,
    ops_checkout_assigned_to: row.ops_checkout_assigned_to || null,
    ops_checkout_assignee_name: row.ops_checkout_assignee_name || null,
    ops_cancelled_at: row.ops_cancelled_at || null,
    ops_cancelled_by_name: row.ops_cancelled_by_name || null,
    ops_cancel_comment: row.ops_cancel_comment || null,
    ops_cancel_refund_amount: Number(row.ops_cancel_refund_amount) || 0,
    ops_adjust_amount: row.ops_adjust_amount != null ? Number(row.ops_adjust_amount) : null,
    ops_adjust_comment: row.ops_adjust_comment || null,
    ops_adjust_at: row.ops_adjust_at || null,
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
  if (req.user.role !== OPS_AGENT) return 'Forbidden';
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
      [OPS_AGENT]
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

    const { range, from, to } = parseOpsDateRange(req.query.range || req.query.period);
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
         AND r.status IS DISTINCT FROM 'cancelled'
         ${scope}
       ORDER BY r.check_in ASC, u.unit_number ASC NULLS LAST`,
      params
    );
    res.json({ range, from, to, items: rows.map(mapCheckin) });
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
         AND (r.check_in::date < ${todayCairoSql()} OR r.ops_cancelled_at IS NOT NULL)
         AND (r.status IS DISTINCT FROM 'cancelled' OR r.ops_cancelled_at IS NOT NULL)
         AND (
           COALESCE(r.ops_handed_over, 0) = 1
           OR COALESCE(r.ops_money_collected, 0) = 1
           OR r.ops_assigned_to IS NOT NULL
           OR r.ops_cancelled_at IS NOT NULL
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
      const reason = String(req.body?.reason || '').trim();
      const reasonError = reassignReasonError(row.ops_assigned_to, staffId, reason);
      if (reasonError) return res.status(400).json({ error: reasonError });
      if (Number(row.ops_assigned_to || 0) === Number(staffId || 0)) {
        return res.json(mapCheckin(row));
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

      // Single assign: same ops agent owns the linked pre-arrival clean.
      await query(
        `UPDATE housekeeping_tasks SET
           assigned_to = $2::int,
           assigned_at = CASE WHEN $2::int IS NULL THEN NULL ELSE now() END,
           assigned_by = CASE WHEN $2::int IS NULL THEN NULL ELSE $3::int END,
           updated_at = now()
         WHERE reservation_id = $1
           AND COALESCE(source, 'pre_arrival') = 'pre_arrival'`,
        [reservationId, staffId || null, Number(req.user.id) || null]
      );

      await logAudit({
        userId: req.user.id,
        action: 'OPS_ASSIGN_CHECKIN',
        entityType: 'reservation',
        entityId: reservationId,
        details: { staff_id: staffId || null, also_assigned_clean: true, reason: reason || null },
      });
      await logAssignment({
        reservationId,
        kind: 'checkin',
        fromId: row.ops_assigned_to,
        toId: staffId,
        reason,
        userId: req.user.id,
      });
      if (staffId) await notifyGuestOfAgent(row, staffId);

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
  upload.single('proof'),
  setCloudinaryFolder(FOLDER_PAYMENTS),
  attachCloudinaryUrls,
  async (req, res, next) => {
    try {
      const reservationId = Number(req.params.reservationId);
      if (req.body && typeof req.body.bill === 'string') req.body.bill = parseJsonField(req.body.bill);
      const proofUrl = fileUrl(req.file);
      const proofName = req.file?.originalname || null;
      let row = await fetchCheckinRow(reservationId);
      if (!row) return res.status(404).json({ error: 'Reservation not found' });
      if (String(row.status).toLowerCase() === 'cancelled') {
        return res.status(409).json({ error: 'Reservation is cancelled' });
      }
      const denied = assertOpsCanAct(req, row);
      if (denied) return res.status(403).json({ error: denied });

      const collectMode = String(req.body?.collect_mode || 'full').toLowerCase() === 'custom'
        ? 'custom'
        : 'full';
      const collectComment = String(req.body?.comment || req.body?.note || '').trim();
      let billApplied = null;
      if (collectMode === 'custom' && req.body?.bill) {
        if (!collectComment) {
          return res.status(400).json({
            error: 'A comment is required when editing the bill before collect',
          });
        }
        const before = {
          total_amount: Number(row.total_amount) || 0,
          price_per_night: Number(row.price_per_night) || 0,
          housekeeping_fees: Number(row.housekeeping_fees) || 0,
          beach_access_fees: Number(row.beach_access_fees) || 0,
          insurance: Number(row.insurance) || 0,
          utilities_amount: Number(row.utilities_amount) || 0,
        };
        row = await applyCollectBillEdits(reservationId, req.body.bill, row);
        billApplied = {
          before,
          after: {
            total_amount: Number(row.total_amount) || 0,
            price_per_night: Number(row.price_per_night) || 0,
            housekeeping_fees: Number(row.housekeeping_fees) || 0,
            beach_access_fees: Number(row.beach_access_fees) || 0,
            insurance: Number(row.insurance) || 0,
            utilities_amount: Number(row.utilities_amount) || 0,
            bill: req.body.bill,
          },
          comment: collectComment,
        };
      }

      const remaining = remainingOf(row, paymentBreakdown(row).full_bill_total);
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
        if (billApplied) {
          await logAudit({
            userId: req.user.id,
            action: 'OPS_EDIT_CHECKIN_BILL',
            entityType: 'reservation',
            entityId: reservationId,
            details: billApplied,
          });
        }
        const updated = await fetchCheckinRow(reservationId);
        return res.json(mapCheckin(updated));
      }

      // Full / custom both collect the full remaining after any bill edit.
      let amount = remaining;
      if (collectMode === 'full') {
        const requested = Number(req.body?.amount);
        if (Number.isFinite(requested) && requested > 0) {
          amount = Math.round(requested * 100) / 100;
        }
      }
      amount = Math.round(amount * 100) / 100;
      if (amount > remaining + 0.5) {
        return res.status(400).json({ error: `Amount cannot exceed remaining EGP ${remaining}` });
      }

      const instapayAccount = normalizeBankAccount(req.body?.bank_account);
      const splits = [];
      const cashAmt = Number(req.body?.cash_amount);
      const instapayAmt = Number(req.body?.instapay_amount);
      const hasSplit =
        (Number.isFinite(cashAmt) && cashAmt > 0) || (Number.isFinite(instapayAmt) && instapayAmt > 0);

      if (hasSplit) {
        const cash = Number.isFinite(cashAmt) && cashAmt > 0 ? Math.round(cashAmt * 100) / 100 : 0;
        const instapay =
          Number.isFinite(instapayAmt) && instapayAmt > 0 ? Math.round(instapayAmt * 100) / 100 : 0;
        if (cash > 0) splits.push({ amount: cash, payment_method: 'cash' });
        if (instapay > 0) splits.push({ amount: instapay, payment_method: 'instapay' });
        const splitTotal = Math.round((cash + instapay) * 100) / 100;
        if (Math.abs(splitTotal - amount) > 0.05) {
          return res.status(400).json({
            error: `Cash + InstaPay (EGP ${splitTotal}) must equal the collected amount (EGP ${amount})`,
          });
        }
        if (splitTotal > remaining + 0.5) {
          return res.status(400).json({ error: `Amount cannot exceed remaining EGP ${remaining}` });
        }
        amount = splitTotal;
      } else {
        let method = String(req.body?.payment_method || 'cash').toLowerCase();
        if (!['cash', 'instapay', 'bank_transfer', 'other'].includes(method)) method = 'cash';
        if (method === 'other' && !collectComment) {
          return res.status(400).json({ error: 'A comment is required when the payment method is Other' });
        }
        splits.push({ amount, payment_method: method });
      }
      if (splits.some((s) => s.payment_method === 'instapay') && !instapayAccount) {
        return res.status(400).json({ error: 'Choose the ADIB or CIB account for InstaPay' });
      }

      const noteBase = collectComment
        ? `[ops check-in] ${collectComment}`
        : `[ops check-in] Collected at door by ${req.user.full_name || req.user.username || req.user.id}`;
      for (const part of splits) {
        const { rows: payRows } = await query(
          `INSERT INTO payments (
             reservation_id, amount, payment_date, payment_method,
             notes, created_by, status, is_approved, approved_by, approved_at, paid_at,
             document_path, document_name, bank_account
           ) VALUES (
             $1, $2, CURRENT_DATE, $3,
             $4, $5, 'successful', 1, $5, now(), now(), $6, $7, $8
           ) RETURNING id`,
          [
            reservationId,
            part.amount,
            part.payment_method,
            splits.length > 1 ? `${noteBase} · ${part.payment_method} share` : noteBase,
            req.user.id,
            proofUrl,
            proofName,
            ['instapay', 'bank_transfer'].includes(part.payment_method) ? instapayAccount : null,
          ]
        );
        if (part.payment_method === 'cash') {
          await recordOpsPettyCash({
            entryType: 'in',
            amount: part.amount,
            description: `Check-in collection — ${row.guest_name || 'Guest'} (${row.unit_number || row.unit_title || 'unit'})`,
            unitId: row.unit_id,
            reservationId,
            userId: req.user.id,
            source: 'ops_collection',
            sourceRef: payRows[0]?.id,
            proofUrl,
            proofName,
            notes: collectComment || null,
          });
        }
      }

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

      if (billApplied) {
        await logAudit({
          userId: req.user.id,
          action: 'OPS_EDIT_CHECKIN_BILL',
          entityType: 'reservation',
          entityId: reservationId,
          details: billApplied,
        });
      }

      await logAudit({
        userId: req.user.id,
        action: 'OPS_COLLECT_CHECKIN',
        entityType: 'reservation',
        entityId: reservationId,
        details: {
          collect_mode: collectMode,
          amount,
          proof_url: proofUrl,
          comment: collectComment || null,
          splits: splits.map((s) => ({
            amount: s.amount,
            payment_method: s.payment_method,
          })),
        },
      });

      const updated = await fetchCheckinRow(reservationId);
      res.json(mapCheckin(updated));
    } catch (e) {
      if (e.status === 400) return res.status(400).json({ error: e.message });
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

const REFUND_METHODS = ['cash', 'instapay', 'bank_transfer'];

/** Ops cancels a check-in at the door: mandatory comment plus the amount handed back. */
router.post(
  '/ops/checkins-today/:reservationId/cancel',
  requireRoles(...OPS_ROLES),
  async (req, res, next) => {
    try {
      const reservationId = Number(req.params.reservationId);
      const row = await fetchCheckinRow(reservationId);
      if (!row) return res.status(404).json({ error: 'Reservation not found' });
      if (String(row.status).toLowerCase() === 'cancelled') {
        return res.status(409).json({ error: 'Reservation is already cancelled' });
      }
      const denied = assertOpsCanAct(req, row);
      if (denied) return res.status(403).json({ error: denied });

      const comment = String(req.body?.comment || '').trim();
      if (!comment) return res.status(400).json({ error: 'A comment is required to cancel a check-in' });
      if (req.body?.refund_amount == null || req.body.refund_amount === '') {
        return res.status(400).json({ error: 'Enter the amount to refund (0 if nothing)' });
      }
      const refund = roundMoney(req.body.refund_amount);
      const paid = roundMoney(row.amount_paid);
      if (refund > paid + 0.5) {
        return res.status(400).json({ error: `Refund cannot exceed the amount paid (EGP ${paid})` });
      }
      let method = String(req.body?.refund_method || 'cash').toLowerCase();
      if (!REFUND_METHODS.includes(method)) method = 'cash';

      await query(
        `UPDATE reservations SET
           status = 'cancelled',
           ops_cancelled_at = now(),
           ops_cancelled_by = $2,
           ops_cancel_comment = $3,
           ops_cancel_refund_amount = $4,
           ops_cancel_refund_method = $5,
           updated_at = now()
         WHERE id = $1`,
        [reservationId, req.user.id, comment, refund, refund > 0 ? method : null]
      );

      if (refund > 0) {
        const { rows: payRows } = await query(
          `INSERT INTO payments (
             reservation_id, amount, payment_date, payment_method,
             notes, created_by, status, is_approved, approved_by, approved_at, paid_at
           ) VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, 'successful', 1, $5, now(), now())
           RETURNING id`,
          [reservationId, -refund, method, `[ops cancel] ${comment}`, req.user.id]
        );
        if (method === 'cash') {
          await recordOpsPettyCash({
            entryType: 'out',
            amount: refund,
            description: `Check-in cancelled refund — ${row.guest_name || 'Guest'} (${row.unit_number || row.unit_title || 'unit'})`,
            unitId: row.unit_id,
            reservationId,
            userId: req.user.id,
            source: 'ops_refund',
            sourceRef: payRows[0]?.id,
            notes: comment,
          });
        }
      }

      await query(`DELETE FROM commissions WHERE reservation_id = $1`, [reservationId]).catch(() => {});
      await query(
        `UPDATE housekeeping_tasks SET status = 'cancelled', updated_at = now()
         WHERE reservation_id = $1 AND status IS DISTINCT FROM 'ready'`,
        [reservationId]
      ).catch(() => {});
      try {
        const { rows: full } = await query(`SELECT * FROM reservations WHERE id = $1`, [reservationId]);
        const { syncBlocksForReservation } = require('../../lib/reservationBlocks');
        await syncBlocksForReservation(full[0]);
        if (full[0]?.booking_id) {
          const { cancelWebsiteBooking } = require('../../services/bookingWorkflow');
          await cancelWebsiteBooking(full[0].booking_id, 'cancelled_by_ops');
        }
      } catch (err) {
        console.warn('[ops/cancel] block release failed', err.message);
      }
      await syncReservationPaymentStatus(reservationId).catch(() => {});

      await logAudit({
        userId: req.user.id,
        action: 'OPS_CANCEL_CHECKIN',
        entityType: 'reservation',
        entityId: reservationId,
        details: { comment, refund_amount: refund, refund_method: refund > 0 ? method : null },
      });

      const updated = await fetchCheckinRow(reservationId);
      res.json(mapCheckin(updated));
    } catch (e) {
      next(e);
    }
  }
);

/** Ops changes the stay length and flags the money difference (collect more / refund). */
router.post(
  '/ops/checkins-today/:reservationId/change-dates',
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

      const comment = String(req.body?.comment || '').trim();
      if (!comment) return res.status(400).json({ error: 'A comment is required to change the stay' });
      const checkIn = String(req.body?.check_in || row.check_in).slice(0, 10);
      const checkOut = String(req.body?.check_out || row.check_out).slice(0, 10);
      const nights = Math.round((new Date(`${checkOut}T00:00:00Z`) - new Date(`${checkIn}T00:00:00Z`)) / 86400000);
      if (!(nights >= 1)) return res.status(400).json({ error: 'Check-out must be after check-in' });

      const { rows: clash } = await query(
        `SELECT id FROM reservations
         WHERE unit_id = $1 AND id <> $2
           AND status IS DISTINCT FROM 'cancelled'
           AND check_in < $4::date AND check_out > $3::date
         LIMIT 1`,
        [row.unit_id, reservationId, checkIn, checkOut]
      );
      if (clash[0]) {
        return res.status(409).json({ error: `Those dates overlap reservation #${clash[0].id}` });
      }

      const oldBill = paymentBreakdown(row).full_bill_total;
      const oldLines = paymentBreakdown({ ...row, total_amount: 0 }).full_bill_total;
      const newLines = paymentBreakdown({ ...row, nights, total_amount: 0 }).full_bill_total;
      const newTotal = roundMoney(oldBill + (newLines - oldLines));
      const computedAdjust = Math.round((newTotal - oldBill) * 100) / 100;
      const adjust =
        req.body?.adjust_amount != null && req.body.adjust_amount !== '' && Number.isFinite(Number(req.body.adjust_amount))
          ? Math.round(Number(req.body.adjust_amount) * 100) / 100
          : computedAdjust;

      const { rows: before } = await query(`SELECT * FROM reservations WHERE id = $1`, [reservationId]);
      const { rows: after } = await query(
        `UPDATE reservations SET
           check_in = $2::date,
           check_out = $3::date,
           nights = $4,
           total_amount = $5,
           ops_adjust_amount = $6,
           ops_adjust_comment = $7,
           ops_adjust_at = now(),
           ops_adjust_by = $8,
           updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [reservationId, checkIn, checkOut, nights, roundMoney(oldBill + adjust), adjust, comment, req.user.id]
      );
      try {
        const { resyncReservationBlocks } = require('../../lib/reservationBlocks');
        await resyncReservationBlocks(before[0], after[0]);
      } catch (err) {
        console.warn('[ops/change-dates] block resync failed', err.message);
      }
      await syncReservationPaymentStatus(reservationId).catch(() => {});

      await logAudit({
        userId: req.user.id,
        action: 'OPS_CHANGE_STAY',
        entityType: 'reservation',
        entityId: reservationId,
        details: {
          from: { check_in: row.check_in, check_out: row.check_out, nights: row.nights, total: oldBill },
          to: { check_in: checkIn, check_out: checkOut, nights, total: roundMoney(oldBill + adjust) },
          adjust_amount: adjust,
          comment,
        },
      });

      const updated = await fetchCheckinRow(reservationId);
      res.json(mapCheckin(updated));
    } catch (e) {
      next(e);
    }
  }
);

/** Check-in / check-out comments (agents on their own stays, the manager on any). */
router.post('/ops/reservations/:reservationId/comments', requireRoles(...OPS_ROLES), async (req, res, next) => {
  try {
    const reservationId = Number(req.params.reservationId);
    const row = await fetchCheckinRow(reservationId);
    if (!row) return res.status(404).json({ error: 'Reservation not found' });
    if (!isOpsSupervisor(req.user)) {
      const mine = [row.ops_assigned_to, row.ops_checkout_assigned_to].some(
        (id) => id && Number(id) === Number(req.user.id)
      );
      if (!mine) return res.status(403).json({ error: 'This stay is not assigned to you' });
    }
    const comment = String(req.body?.comment || '').trim();
    if (!comment) return res.status(400).json({ error: 'Comment is required' });
    const kind = String(req.body?.kind || 'checkin').toLowerCase() === 'checkout' ? 'checkout' : 'checkin';
    const { rows } = await query(
      `INSERT INTO ops_reservation_comments (reservation_id, kind, comment, created_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [reservationId, kind, comment.slice(0, 4000), req.user.id]
    );
    res.status(201).json({ ...rows[0], created_by_name: req.user.full_name || req.user.username || null });
  } catch (e) {
    next(e);
  }
});

/** Full check-in history for one stay: bill, payments, assignments, comments, audit trail. */
router.get('/ops/reservations/:reservationId/history', requireRoles(...OPS_ROLES), async (req, res, next) => {
  try {
    const reservationId = Number(req.params.reservationId);
    const row = await fetchCheckinRow(reservationId);
    if (!row) return res.status(404).json({ error: 'Reservation not found' });
    if (!isOpsSupervisor(req.user)) {
      const mine = [row.ops_assigned_to, row.ops_checkout_assigned_to].some(
        (id) => id && Number(id) === Number(req.user.id)
      );
      if (!mine) return res.status(403).json({ error: 'This stay is not assigned to you' });
    }
    const [payments, assignments, comments, audit] = await Promise.all([
      query(
        `SELECT p.id, p.amount, p.payment_method, p.notes, p.status, p.document_path,
                p.created_at, s.full_name AS created_by_name
         FROM payments p LEFT JOIN staff_users s ON s.id = p.created_by
         WHERE p.reservation_id = $1 ORDER BY p.created_at ASC`,
        [reservationId]
      ),
      query(
        `SELECT l.*, f.full_name AS from_name, t.full_name AS to_name, c.full_name AS changed_by_name
         FROM ops_assignment_log l
         LEFT JOIN staff_users f ON f.id = l.from_staff_id
         LEFT JOIN staff_users t ON t.id = l.to_staff_id
         LEFT JOIN staff_users c ON c.id = l.changed_by
         WHERE l.reservation_id = $1 ORDER BY l.created_at ASC`,
        [reservationId]
      ),
      query(
        `SELECT c.*, s.full_name AS created_by_name
         FROM ops_reservation_comments c LEFT JOIN staff_users s ON s.id = c.created_by
         WHERE c.reservation_id = $1 ORDER BY c.created_at ASC`,
        [reservationId]
      ),
      query(
        `SELECT a.id, a.action, a.details, a.created_at, s.full_name AS user_name
         FROM audit_log a LEFT JOIN staff_users s ON s.id = a.user_id
         WHERE a.entity_type = 'reservation' AND a.entity_id::text = $1::text
           AND a.action LIKE 'OPS_%'
         ORDER BY a.created_at ASC`,
        [String(reservationId)]
      ).catch(() => ({ rows: [] })),
    ]);
    res.json({
      reservation: mapCheckin(row),
      handover_comment: row.ops_handover_comment || null,
      payments: payments.rows,
      assignments: assignments.rows,
      comments: comments.rows,
      events: audit.rows,
    });
  } catch (e) {
    next(e);
  }
});

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

/** Cleaning phase for one task (see HkTodayCleans for labels). */
function cleaningPhase(r) {
  const status = String(r.task_status || 'pending').toLowerCase();
  if (status === 'ready') return 'cleaned';
  if (status === 'in_progress') return 'in_progress';
  const cleanDate = r.clean_date ? String(r.clean_date).slice(0, 10) : null;
  const prevOut = r.prev_check_out ? String(r.prev_check_out).slice(0, 10) : null;
  const nextIn = r.check_in ? String(r.check_in).slice(0, 10) : null;
  if (prevOut && nextIn && prevOut === nextIn) return 'checkout_in';
  if (prevOut && cleanDate && prevOut === cleanDate && !nextIn) return 'checkout';
  const lastClean = r.last_cleaned_at ? new Date(r.last_cleaned_at) : null;
  if (lastClean && (!prevOut || lastClean >= new Date(`${prevOut}T00:00:00Z`))) return 'reclean';
  return 'checkout';
}

router.get('/housekeeping/today-cleans', requireRoles(...HK_READ_ROLES), async (req, res, next) => {
  try {
    try {
      await ensurePreArrivalTasks();
    } catch (err) {
      console.error('[housekeeping/today-cleans] ensurePreArrivalTasks', err.message);
    }

    const { range, from, to } = parseOpsDateRange(req.query.range || 'today');

    const { rows: missing } = await query(
      `SELECT r.id AS reservation_id, r.unit_id
       FROM reservations r
       WHERE r.check_in::date BETWEEN $1::date AND $2::date
         AND r.status IS DISTINCT FROM 'cancelled'
         AND NOT EXISTS (
           SELECT 1 FROM housekeeping_tasks t
           WHERE t.reservation_id = r.id
             AND COALESCE(t.source, 'pre_arrival') = 'pre_arrival'
         )`,
      [from, to]
    );
    for (const m of missing) {
      await query(
        `INSERT INTO housekeeping_tasks (
           reservation_id, unit_id, status, checklist, due_at, source
         ) VALUES ($1, $2, 'pending', $3::jsonb, now(), 'pre_arrival')
         ON CONFLICT DO NOTHING`,
        [m.reservation_id, m.unit_id, JSON.stringify(DEFAULT_CHECKLIST)]
      );
    }

    const params = [from, to];
    let scope = '';
    if (req.user.role === OPS_AGENT) {
      params.push(req.user.id);
      scope = ` AND t.assigned_to = $${params.length}`;
    }

    const { rows } = await query(
      `WITH base AS (
         SELECT t.*,
                COALESCE(t.clean_date, r.check_in::date, t.due_at::date) AS eff_date,
                r.id AS res_id, r.guest_name AS res_guest, r.guest_phone AS res_phone,
                r.check_in AS res_in, r.check_out AS res_out, r.status AS res_status
         FROM housekeeping_tasks t
         LEFT JOIN reservations r ON r.id = t.reservation_id
         WHERE COALESCE(t.source, 'pre_arrival') IN ('pre_arrival', 'manual')
           AND t.status IS DISTINCT FROM 'cancelled'
           AND (t.reservation_id IS NULL OR r.status IS DISTINCT FROM 'cancelled')
       )
       SELECT b.id AS task_id,
              b.status AS task_status,
              COALESCE(b.source, 'pre_arrival') AS source,
              b.eff_date AS clean_date,
              b.assigned_to,
              b.assigned_at,
              b.started_at,
              b.ready_at,
              b.due_at,
              u.id AS unit_id,
              u.unit_number,
              COALESCE(u.unit_number, u.title, 'Unit') AS unit_title,
              COALESCE(u.project, u.compound) AS project,
              COALESCE(b.res_id, nxt.id) AS reservation_id,
              COALESCE(b.res_guest, nxt.guest_name) AS guest_name,
              COALESCE(b.res_phone, nxt.guest_phone) AS guest_phone,
              COALESCE(b.res_in, nxt.check_in) AS check_in,
              COALESCE(b.res_out, nxt.check_out) AS check_out,
              prev.id AS prev_reservation_id,
              prev.guest_name AS prev_guest_name,
              prev.check_out AS prev_check_out,
              lc.last_cleaned_at,
              hk_agent.full_name AS assignee_name,
              hk_agent.staff_code AS assignee_code,
              creator.full_name AS created_by_name
       FROM base b
       JOIN units u ON u.id = b.unit_id
       LEFT JOIN LATERAL (
         SELECT r2.id, r2.guest_name, r2.guest_phone, r2.check_in, r2.check_out
         FROM reservations r2
         WHERE b.res_id IS NULL AND r2.unit_id = b.unit_id
           AND r2.status IS DISTINCT FROM 'cancelled'
           AND r2.check_in::date >= b.eff_date
         ORDER BY r2.check_in ASC LIMIT 1
       ) nxt ON TRUE
       LEFT JOIN LATERAL (
         SELECT r3.id, r3.guest_name, r3.check_out
         FROM reservations r3
         WHERE r3.unit_id = b.unit_id
           AND r3.status IS DISTINCT FROM 'cancelled'
           AND r3.id IS DISTINCT FROM COALESCE(b.res_id, nxt.id)
           AND r3.check_out::date <= COALESCE(b.res_in::date, nxt.check_in::date, b.eff_date)
         ORDER BY r3.check_out DESC LIMIT 1
       ) prev ON TRUE
       LEFT JOIN LATERAL (
         SELECT MAX(COALESCE(t4.ready_at, t4.submitted_at)) AS last_cleaned_at
         FROM housekeeping_tasks t4
         WHERE t4.unit_id = b.unit_id AND t4.id <> b.id AND t4.status = 'ready'
       ) lc ON TRUE
       LEFT JOIN staff_users hk_agent ON hk_agent.id = b.assigned_to
       LEFT JOIN staff_users creator ON creator.id = b.created_by
       WHERE b.eff_date BETWEEN $1::date AND $2::date
         ${scope.replace('t.assigned_to', 'b.assigned_to')}
       ORDER BY b.eff_date ASC, u.unit_number ASC NULLS LAST`,
      params
    );

    res.json({
      range,
      from,
      to,
      items: rows.map((r) => ({
        task_id: r.task_id,
        task_status: r.task_status || 'pending',
        source: r.source,
        phase: cleaningPhase(r),
        clean_date: r.clean_date,
        reservation_id: r.reservation_id || null,
        guest_name: r.guest_name || null,
        guest_phone: r.guest_phone || null,
        check_in: r.check_in || null,
        check_out: r.check_out || null,
        prev_reservation_id: r.prev_reservation_id || null,
        prev_guest_name: r.prev_guest_name || null,
        prev_check_out: r.prev_check_out || null,
        last_cleaned_at: r.last_cleaned_at || null,
        unit_id: r.unit_id,
        unit_number: r.unit_number,
        unit_title: r.unit_title,
        project: r.project,
        cleaned: isHkCleaned(r.task_status),
        in_progress: String(r.task_status) === 'in_progress',
        started_at: r.started_at || null,
        ready_at: r.ready_at || null,
        assigned_to: r.assigned_to || null,
        assigned_at: r.assigned_at || null,
        assignee_name: r.assignee_name || null,
        assignee_code: r.assignee_code || null,
        created_by_name: r.created_by_name || null,
        due_at: r.due_at || null,
      })),
    });
  } catch (e) {
    next(e);
  }
});

/** Operations Manager adds a unit to clean on a given date. */
router.post('/housekeeping/cleans', requireRoles(...HK_SUPER_ROLES), async (req, res, next) => {
  try {
    const unitId = String(req.body?.unit_id || '').trim();
    const cleanDate = String(req.body?.clean_date || '').slice(0, 10);
    if (!unitId) return res.status(400).json({ error: 'Choose a unit' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) return res.status(400).json({ error: 'Choose a clean date' });
    const { rows: unit } = await query(`SELECT id FROM units WHERE id = $1`, [unitId]);
    if (!unit[0]) return res.status(404).json({ error: 'Unit not found' });
    const staffId = req.body?.staff_id ? Number(req.body.staff_id) : null;
    const { rows } = await query(
      `INSERT INTO housekeeping_tasks (
         unit_id, status, checklist, due_at, clean_date, source, created_by,
         assigned_to, assigned_at, assigned_by, notes
       ) VALUES ($1, 'pending', $2::jsonb, $3::date, $3::date, 'manual', $4,
         $5::int, CASE WHEN $5::int IS NULL THEN NULL ELSE now() END,
         CASE WHEN $5::int IS NULL THEN NULL ELSE $4::int END, $6)
       RETURNING *`,
      [
        unitId,
        JSON.stringify(DEFAULT_CHECKLIST),
        cleanDate,
        req.user.id,
        staffId,
        String(req.body?.notes || '').trim() || null,
      ]
    );
    await logAudit({
      userId: req.user.id,
      action: 'HK_ADD_MANUAL_CLEAN',
      entityType: 'housekeeping_task',
      entityId: rows[0].id,
      details: { unit_id: unitId, clean_date: cleanDate },
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.patch('/housekeeping/cleans/:taskId/date', requireRoles(...HK_SUPER_ROLES), async (req, res, next) => {
  try {
    const taskId = Number(req.params.taskId);
    const cleanDate = String(req.body?.clean_date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) return res.status(400).json({ error: 'Choose a clean date' });
    const { rows } = await query(
      `UPDATE housekeeping_tasks SET clean_date = $2::date, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [taskId, cleanDate]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Task not found' });
    await logAudit({
      userId: req.user.id,
      action: 'HK_CHANGE_CLEAN_DATE',
      entityType: 'housekeeping_task',
      entityId: taskId,
      details: { clean_date: cleanDate },
    });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.delete('/housekeeping/cleans/:taskId', requireRoles(...HK_SUPER_ROLES), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE housekeeping_tasks SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND source = 'manual' RETURNING id`,
      [Number(req.params.taskId)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Only manual cleans can be removed' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/housekeeping/cleans-history', requireRoles(...HK_READ_ROLES), async (req, res, next) => {
  try {
    const { from, to } = parseHistoryRange(req.query);
    const params = [from, to];
    let scope = '';
    if (req.user.role === OPS_AGENT) {
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

/** Per-unit rollup: last cleaned, times cleaned, last assignee who cleaned it. */
router.get('/housekeeping/unit-cleans-summary', requireRoles(...HK_READ_ROLES), async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const params = [];
    const filters = [`COALESCE(u.listing_type, 'rent') IN ('rent', 'long_term')`];

    if (q) {
      params.push(`%${q}%`);
      filters.push(
        `(u.unit_number ILIKE $${params.length} OR COALESCE(u.project, u.compound, '') ILIKE $${params.length} OR COALESCE(u.title, '') ILIKE $${params.length})`
      );
    }

    let agentScopeJoin = '';
    let agentScopeWhere = '';
    if (req.user.role === OPS_AGENT) {
      params.push(req.user.id);
      agentScopeJoin = `
        AND EXISTS (
          SELECT 1 FROM housekeeping_tasks ta
          WHERE ta.unit_id = u.id
            AND ta.assigned_to = $${params.length}
            AND COALESCE(ta.source, 'pre_arrival') = 'pre_arrival'
            AND (ta.status = 'ready' OR ta.ready_at IS NOT NULL OR ta.submitted_at IS NOT NULL)
        )`;
      agentScopeWhere = ` AND t.assigned_to = $${params.length}`;
    }

    const { rows } = await query(
      `SELECT u.id AS unit_id,
              u.unit_number,
              COALESCE(u.unit_number, u.title, 'Unit') AS unit_title,
              COALESCE(u.project, u.compound) AS project,
              u.ops_status,
              COUNT(*) FILTER (
                WHERE t.id IS NOT NULL
                  AND (t.status = 'ready' OR t.ready_at IS NOT NULL OR t.submitted_at IS NOT NULL)
                  ${agentScopeWhere}
              )::int AS times_cleaned,
              MAX(
                CASE
                  WHEN t.id IS NOT NULL
                    AND (t.status = 'ready' OR t.ready_at IS NOT NULL OR t.submitted_at IS NOT NULL)
                    ${agentScopeWhere}
                  THEN COALESCE(t.ready_at, t.submitted_at)
                  ELSE NULL
                END
              ) AS last_cleaned_at,
              (
                SELECT t2.assigned_to
                FROM housekeeping_tasks t2
                WHERE t2.unit_id = u.id
                  AND COALESCE(t2.source, 'pre_arrival') = 'pre_arrival'
                  AND (t2.status = 'ready' OR t2.ready_at IS NOT NULL OR t2.submitted_at IS NOT NULL)
                  ${req.user.role === OPS_AGENT ? `AND t2.assigned_to = $${params.length}` : ''}
                ORDER BY COALESCE(t2.ready_at, t2.submitted_at) DESC NULLS LAST
                LIMIT 1
              ) AS last_assigned_to
       FROM units u
       LEFT JOIN housekeeping_tasks t
         ON t.unit_id = u.id
        AND COALESCE(t.source, 'pre_arrival') = 'pre_arrival'
       WHERE ${filters.join(' AND ')}
         ${agentScopeJoin}
       GROUP BY u.id
       ORDER BY last_cleaned_at DESC NULLS LAST, u.unit_number ASC NULLS LAST
       LIMIT 1000`,
      params
    );

    const assigneeIds = [
      ...new Set(rows.map((r) => r.last_assigned_to).filter((id) => id != null)),
    ];
    let nameById = new Map();
    if (assigneeIds.length) {
      const { rows: agents } = await query(
        `SELECT id, full_name, staff_code FROM staff_users WHERE id = ANY($1::int[])`,
        [assigneeIds]
      );
      nameById = new Map(agents.map((a) => [a.id, a]));
    }

    res.json({
      items: rows.map((r) => {
        const agent = nameById.get(r.last_assigned_to) || null;
        return {
          unit_id: r.unit_id,
          unit_number: r.unit_number,
          unit_title: r.unit_title,
          project: r.project,
          ops_status: r.ops_status || null,
          times_cleaned: Number(r.times_cleaned) || 0,
          last_cleaned_at: r.last_cleaned_at || null,
          last_assigned_to: r.last_assigned_to || null,
          assignee_name: agent?.full_name || null,
          assignee_code: agent?.staff_code || null,
        };
      }),
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
      const staffId = req.body?.staff_id != null && req.body.staff_id !== '' ? Number(req.body.staff_id) : null;
      const { rows: existing } = await query(`SELECT * FROM housekeeping_tasks WHERE id = $1`, [
        taskId,
      ]);
      const task = existing[0];
      if (!task) return res.status(404).json({ error: 'Task not found' });

      if (staffId) {
        const { rows: agents } = await query(
          `SELECT id FROM staff_users WHERE id = $1 AND role = $2 AND is_active = 1`,
          [staffId, OPS_AGENT]
        );
        if (!agents[0]) {
          return res.status(400).json({ error: 'Select an active operations agent' });
        }
      }
      const reason = String(req.body?.reason || '').trim();
      const reasonError = reassignReasonError(task.assigned_to, staffId, reason);
      if (reasonError) return res.status(400).json({ error: reasonError });

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

      await logAssignment({
        reservationId: task.reservation_id || null,
        taskId,
        kind: 'clean',
        fromId: task.assigned_to,
        toId: staffId,
        reason,
        userId: req.user.id,
      });
      await logAudit({
        userId: req.user.id,
        action: 'HK_ASSIGN_TODAY_CLEAN',
        entityType: 'housekeeping_task',
        entityId: taskId,
        details: { staff_id: staffId || null, reservation_id: task.reservation_id, reason: reason || null },
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

/** Housekeeping starts cleaning; a unit can only be marked cleaned after this. */
router.post(
  '/housekeeping/today-cleans/:taskId/start',
  requireRoles(...HK_ROLES),
  async (req, res, next) => {
    try {
      const taskId = Number(req.params.taskId);
      const { rows: existing } = await query(`SELECT * FROM housekeeping_tasks WHERE id = $1`, [taskId]);
      const task = existing[0];
      if (!task) return res.status(404).json({ error: 'Task not found' });
      const denied = assertHkCanAct(req, task);
      if (denied) return res.status(403).json({ error: denied });
      if (isHkCleaned(task.status)) return res.status(409).json({ error: 'Already cleaned' });

      const { rows } = await query(
        `UPDATE housekeeping_tasks SET
           status = 'in_progress',
           assigned_to = COALESCE(assigned_to, $2),
           accepted_at = COALESCE(accepted_at, now()),
           started_at = now(),
           updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [taskId, req.user.id]
      );
      await logAudit({
        userId: req.user.id,
        action: 'HK_START_CLEAN',
        entityType: 'housekeeping_task',
        entityId: taskId,
        details: { reservation_id: task.reservation_id },
      });
      res.json({ ...rows[0], cleaned: false, in_progress: true });
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
      if (String(task.status) !== 'in_progress') {
        return res.status(400).json({ error: 'Mark the clean as In progress first' });
      }

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

function mapCheckout(row) {
  const insurance = Math.round((Number(row.insurance) || 0) * 100) / 100;
  const refundStatus = String(row.insurance_refund_status || '').toLowerCase();
  const refunded = ['refunded', 'partial', 'forfeited'].includes(refundStatus);
  return {
    id: row.id,
    guest_name: row.guest_name,
    guest_phone: row.guest_phone,
    check_in: row.check_in,
    check_out: row.check_out,
    status: row.status,
    unit_id: row.unit_id,
    unit_number: row.unit_number,
    unit_title: row.unit_title,
    project: row.project,
    insurance,
    insurance_refund_status: refunded ? refundStatus : insurance > 0.009 ? 'pending' : 'none',
    insurance_refunded_amount: Number(row.insurance_refunded_amount) || 0,
    insurance_damage_amount: Number(row.insurance_damage_amount) || 0,
    insurance_refunded_at: row.insurance_refunded_at,
    insurance_refund_method: row.insurance_refund_method,
    insurance_refund_notes: row.insurance_refund_notes || null,
    insurance_refunded_by_name: row.insurance_refunded_by_name || null,
    insurance_damage_photo_urls: row.insurance_damage_photo_urls || [],
    insurance_damage_share_status: row.insurance_damage_share_status || null,
    can_refund_insurance: insurance > 0.009 && !refunded,
    ops_assigned_to: row.ops_assigned_to || null,
    ops_assignee_name: row.ops_assignee_name || null,
    ops_checkout_assigned_to: row.ops_checkout_assigned_to || null,
    ops_checkout_assignee_name: row.ops_checkout_assignee_name || null,
    checkout_handler_id: row.ops_checkout_assigned_to || row.ops_assigned_to || null,
    checkout_handler_name: row.ops_checkout_assignee_name || row.ops_assignee_name || null,
    sales_person_name: row.sales_person_name || row.sales_label || null,
    booking_source: row.booking_source || null,
    notes: row.notes || null,
  };
}

const CHECKOUT_SELECT = `
  SELECT r.id,
         r.guest_name,
         r.guest_phone,
         r.check_in,
         r.check_out,
         r.status,
         r.unit_id,
         r.ops_assigned_to,
         r.ops_checkout_assigned_to,
         r.sales_label,
         r.booking_source,
         r.notes,
         COALESCE(r.insurance, 0)::float AS insurance,
         r.insurance_refund_status,
         COALESCE(r.insurance_refunded_amount, 0)::float AS insurance_refunded_amount,
         COALESCE(r.insurance_damage_amount, 0)::float AS insurance_damage_amount,
         r.insurance_refunded_at,
         r.insurance_refund_method,
         r.insurance_refund_notes,
         r.insurance_damage_photo_urls,
         r.insurance_damage_share_status,
         u.unit_number,
         COALESCE(u.unit_number, u.title, 'Unit') AS unit_title,
         COALESCE(u.project, u.compound) AS project,
         refunded_by.full_name AS insurance_refunded_by_name,
         ci_agent.full_name AS ops_assignee_name,
         co_agent.full_name AS ops_checkout_assignee_name,
         sp.full_name AS sales_person_name
  FROM reservations r
  JOIN units u ON u.id = r.unit_id
  LEFT JOIN staff_users refunded_by ON refunded_by.id = r.insurance_refunded_by
  LEFT JOIN staff_users ci_agent ON ci_agent.id = r.ops_assigned_to
  LEFT JOIN staff_users co_agent ON co_agent.id = r.ops_checkout_assigned_to
  LEFT JOIN staff_users sp ON sp.id = r.sales_person_id
`;

async function fetchCheckoutRow(reservationId) {
  const { rows } = await query(`${CHECKOUT_SELECT} WHERE r.id = $1`, [reservationId]);
  return rows[0] || null;
}

/** Checkout actions belong to the checkout handler (falls back to the check-in agent). */
function assertCheckoutCanAct(req, row) {
  if (isOpsSupervisor(req.user)) return null;
  if (req.user.role !== OPS_AGENT) return 'Forbidden';
  const handler = row.ops_checkout_assigned_to || row.ops_assigned_to;
  if (!handler || Number(handler) !== Number(req.user.id)) {
    return 'This checkout is not assigned to you';
  }
  return null;
}

router.get('/ops/checkouts-today', requireRoles(...OPS_ROLES), async (req, res, next) => {
  try {
    const { range, from, to } = parseOpsDateRange(req.query.range || req.query.period);
    const params = [from, to];
    let scope = '';
    if (req.user.role === OPS_AGENT) {
      params.push(req.user.id);
      scope = ` AND COALESCE(r.ops_checkout_assigned_to, r.ops_assigned_to) = $${params.length}`;
    }
    const { rows } = await query(
      `${CHECKOUT_SELECT}
       WHERE r.check_out::date >= $1::date
         AND r.check_out::date <= $2::date
         AND r.status IS DISTINCT FROM 'cancelled'
         ${scope}
       ORDER BY r.check_out ASC, u.unit_number ASC NULLS LAST`,
      params
    );
    res.json({ range, from, to, items: rows.map(mapCheckout) });
  } catch (e) {
    next(e);
  }
});

/** The Operations Manager picks who handles the checkout (can differ from check-in). */
router.post(
  '/ops/checkouts-today/:reservationId/assign',
  requireRoles(...OPS_SUPER_ROLES),
  async (req, res, next) => {
    try {
      const reservationId = Number(req.params.reservationId);
      const row = await fetchCheckoutRow(reservationId);
      if (!row) return res.status(404).json({ error: 'Reservation not found' });
      const staffId = req.body?.staff_id != null && req.body.staff_id !== '' ? Number(req.body.staff_id) : null;
      if (staffId) {
        const { rows: agents } = await query(
          `SELECT id FROM staff_users WHERE id = $1 AND role = $2 AND is_active = 1`,
          [staffId, OPS_AGENT]
        );
        if (!agents[0]) return res.status(400).json({ error: 'Select an active operations agent' });
      }
      const previous = row.ops_checkout_assigned_to || row.ops_assigned_to;
      const reason = String(req.body?.reason || '').trim();
      const reasonError = reassignReasonError(previous, staffId, reason);
      if (reasonError) return res.status(400).json({ error: reasonError });

      await query(
        `UPDATE reservations SET
           ops_checkout_assigned_to = $2::int,
           ops_checkout_assigned_at = CASE WHEN $2::int IS NULL THEN NULL ELSE now() END,
           ops_checkout_assigned_by = CASE WHEN $2::int IS NULL THEN NULL ELSE $3::int END,
           updated_at = now()
         WHERE id = $1`,
        [reservationId, staffId, req.user.id]
      );
      await logAssignment({
        reservationId,
        kind: 'checkout',
        fromId: previous,
        toId: staffId,
        reason,
        userId: req.user.id,
      });
      await logAudit({
        userId: req.user.id,
        action: 'OPS_ASSIGN_CHECKOUT',
        entityType: 'reservation',
        entityId: reservationId,
        details: { staff_id: staffId, reason: reason || null },
      });
      res.json(mapCheckout(await fetchCheckoutRow(reservationId)));
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/ops/checkouts-today/:reservationId/refund-insurance',
  requireRoles(...OPS_ROLES),
  upload.array('damage_photos', 10),
  setCloudinaryFolder(FOLDER_INSPECTIONS),
  attachCloudinaryUrls,
  async (req, res, next) => {
    try {
      const reservationId = Number(req.params.reservationId);
      if (!reservationId) return res.status(400).json({ error: 'Invalid reservation id' });

      const row = await fetchCheckoutRow(reservationId);
      if (!row) return res.status(404).json({ error: 'Reservation not found' });
      if (String(row.status).toLowerCase() === 'cancelled') {
        return res.status(409).json({ error: 'Reservation is cancelled' });
      }
      const denied = assertCheckoutCanAct(req, row);
      if (denied) return res.status(403).json({ error: denied });

      const held = Math.round((Number(row.insurance) || 0) * 100) / 100;
      if (!(held > 0.009)) {
        return res.status(400).json({ error: 'This reservation has no insurance to refund' });
      }

      const existing = String(row.insurance_refund_status || '').toLowerCase();
      if (['refunded', 'partial', 'forfeited'].includes(existing)) {
        return res.json(mapCheckout(row));
      }

      let method = String(req.body?.payment_method || 'cash').toLowerCase();
      if (!REFUND_METHODS.includes(method)) method = 'cash';
      const refundBank = method === 'cash' ? null : normalizeBankAccount(req.body?.bank_account);
      if (method !== 'cash' && !refundBank) {
        return res.status(400).json({ error: 'Choose the ADIB or CIB account the refund is paid from' });
      }

      const refunded =
        req.body?.refunded_amount != null && req.body.refunded_amount !== ''
          ? Math.round((Number(req.body.refunded_amount) || 0) * 100) / 100
          : held;
      if (!(refunded >= 0) || refunded > held + 0.05) {
        return res.status(400).json({ error: `Refund must be between 0 and EGP ${held.toFixed(2)}` });
      }
      const damage = Math.round((held - refunded) * 100) / 100;

      const comment = String(req.body?.notes || req.body?.comment || '').trim();
      const photoUrls = (req.files || []).map(fileUrl).filter(Boolean);
      if (damage > 0.009) {
        if (!comment) {
          return res.status(400).json({ error: 'Explain the deduction in the comment' });
        }
        if (!photoUrls.length) {
          return res.status(400).json({ error: 'Add at least one photo of the damage' });
        }
      }
      const shareWithOwner =
        damage > 0.009 && ['1', 'true', 'yes'].includes(String(req.body?.share_with_owner || '').toLowerCase());

      let status = 'refunded';
      if (damage > 0.009 && refunded > 0.009) status = 'partial';
      else if (damage > 0.009) status = 'forfeited';

      const notes = comment
        ? comment.slice(0, 2000)
        : `[ops checkout] Insurance payout by ${req.user.full_name || req.user.username || req.user.id}`;

      const refundDate = row.check_out
        ? String(row.check_out).slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      const { rows: updated } = await query(
        `UPDATE reservations SET
           insurance_refund_status = $2,
           insurance_refunded_amount = $3,
           insurance_damage_amount = $4,
           insurance_refunded_at = $5::date,
           insurance_refund_method = $6,
           insurance_refund_notes = $7,
           insurance_refunded_by = $8,
           insurance_damage_photo_urls = $9::text[],
           insurance_damage_share_status = $10,
           insurance_refund_bank_account = $11,
           updated_at = now()
         WHERE id = $1
         RETURNING id`,
        [
          reservationId,
          status,
          refunded,
          damage,
          refundDate,
          method,
          notes,
          req.user.id,
          photoUrls,
          shareWithOwner ? (isOpsSupervisor(req.user) ? 'approved' : 'pending') : null,
          refundBank,
        ]
      );
      if (!updated[0]) return res.status(404).json({ error: 'Reservation not found' });

      if (method === 'cash' && refunded > 0.009) {
        await recordOpsPettyCash({
          entryType: 'out',
          amount: refunded,
          description: `Insurance refund — ${row.guest_name || 'Guest'} (${row.unit_number || row.unit_title || 'unit'})`,
          unitId: row.unit_id,
          reservationId,
          userId: req.user.id,
          source: 'insurance_refund',
          sourceRef: reservationId,
          proofUrl: photoUrls[0] || null,
          proofName: photoUrls[0] ? 'damage-photo' : null,
          notes: damage > 0.009 ? `Deducted EGP ${damage.toFixed(2)}: ${comment}` : null,
        });
      }

      await logAudit({
        userId: req.user.id,
        action: 'OPS_REFUND_INSURANCE',
        entityType: 'reservation',
        entityId: reservationId,
        details: {
          amount: refunded,
          damage_amount: damage,
          status,
          payment_method: method,
          photos: photoUrls.length,
          share_with_owner: shareWithOwner,
        },
      });

      res.json(mapCheckout(await fetchCheckoutRow(reservationId)));
    } catch (e) {
      next(e);
    }
  }
);

/** Damage reports: the manager approves sharing with Owner Experience; they see approved ones. */
router.get(
  '/ops/insurance-damages',
  requireRoles('admin', OPS_SUPER, 'owners_relations'),
  async (req, res, next) => {
    try {
      const params = [];
      let where = `COALESCE(r.insurance_damage_amount, 0) > 0`;
      if (req.user.role === 'owners_relations') {
        where += ` AND r.insurance_damage_share_status = 'approved'`;
      } else {
        const status = String(req.query.status || 'all').toLowerCase();
        if (['pending', 'approved', 'rejected'].includes(status)) {
          params.push(status);
          where += ` AND r.insurance_damage_share_status = $${params.length}`;
        }
      }
      const { rows } = await query(
        `${CHECKOUT_SELECT} WHERE ${where} ORDER BY r.insurance_refunded_at DESC NULLS LAST, r.id DESC LIMIT 300`,
        params
      );
      res.json(rows.map(mapCheckout));
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/ops/insurance-damages/:reservationId/share',
  requireRoles(...OPS_SUPER_ROLES),
  async (req, res, next) => {
    try {
      const reservationId = Number(req.params.reservationId);
      const decision = String(req.body?.decision || '').toLowerCase();
      if (!['approved', 'rejected'].includes(decision)) {
        return res.status(400).json({ error: 'decision must be approved or rejected' });
      }
      const { rows } = await query(
        `UPDATE reservations SET
           insurance_damage_share_status = $2,
           insurance_damage_share_reviewed_by = $3,
           insurance_damage_share_reviewed_at = now(),
           updated_at = now()
         WHERE id = $1 AND COALESCE(insurance_damage_amount, 0) > 0
         RETURNING id`,
        [reservationId, decision, req.user.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Damage report not found' });
      await logAudit({
        userId: req.user.id,
        action: 'OPS_DAMAGE_SHARE_REVIEW',
        entityType: 'reservation',
        entityId: reservationId,
        details: { decision },
      });
      res.json(mapCheckout(await fetchCheckoutRow(reservationId)));
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
