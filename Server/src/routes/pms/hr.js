const express = require('express');
const XLSX = require('xlsx');
const { query, pool } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { upload } = require('../../config/cloudinary');
const {
  dailyRate,
  computeLatenessDeduction,
  computeAbsenceDeduction,
  computeHalfDayDeduction,
  cairoParts,
  assertCasualTiming,
  assertAnnualNotice,
  assertEarlyLeaveTiming,
  EARLY_LEAVE_MAX_PER_YEAR,
  canRequestHolidays,
  leaveTypeRequiresHolidayAccess,
  monthsBetween,
  HR_TEAM_ROLES,
  assertCanEditStaffCompensation,
  nextPayrollPeriod,
  dateCoveredByRanges,
  parseAttendanceRows,
  parseHtmlExcelTables,
  collapsePunchAttendance,
  fillMissingOfficeAbsences,
  isDoorPunchLog,
  normalizePersonId,
  matchAttendanceStaff,
  roundMoney,
  splitSalaryAdjustments,
  hasOfficeAttendance,
  isFieldOperationsRole,
  canRequestStaffBenefits,
  staffRequestPolicy,
  canViewAllStaffRequests,
  eligibleReviewSlots,
  applyRequestReview,
  describeRequestApproval,
} = require('../../lib/hrRules');

const router = express.Router();

const HR_ROLES = ['admin', ...HR_TEAM_ROLES];

function isHrActor(user) {
  return user && (user.role === 'admin' || HR_TEAM_ROLES.includes(user.role));
}

function assertCanTargetBenefits(staff) {
  if (!canRequestStaffBenefits(staff?.role)) {
    const err = new Error('Admins do not request holidays, loans, or work-from-home days');
    err.status = 403;
    throw err;
  }
}

function requestListScope(actor, { mine, alias = 'r', staffAlias = 'u' } = {}) {
  const params = [];
  const where = [];
  const wantMine = mine === '1' || mine === 1 || mine === true;
  if (wantMine || !canViewAllStaffRequests(actor)) {
    params.push(actor.id);
    const me = `$${params.length}`;
    if (wantMine) {
      where.push(`${alias}.staff_user_id = ${me}`);
    } else {
      const parts = [`${alias}.staff_user_id = ${me}`, `${staffAlias}.manager_id = ${me}`];
      if (actor.role === 'operations_supervisor') parts.push(`${staffAlias}.role = 'operations'`);
      if (actor.role === 'housekeeping_supervisor') parts.push(`${staffAlias}.role = 'housekeeping'`);
      where.push(`(${parts.join(' OR ')})`);
    }
  }
  return { params, where };
}

function presentStaffRequest(row, actor) {
  const staff = { id: row.staff_user_id, role: row.role, manager_id: row.manager_id };
  return {
    ...row,
    can_review_slots: eligibleReviewSlots(actor, row, staff),
    approval_label: describeRequestApproval(row),
  };
}

const REQUEST_LIST_JOINS = `
      JOIN staff_users u ON u.id = r.staff_user_id
      LEFT JOIN staff_users mgr ON mgr.id = u.manager_id
      LEFT JOIN staff_users reviewer ON reviewer.id = r.reviewed_by
      LEFT JOIN staff_users mgr_rev ON mgr_rev.id = r.manager_reviewed_by
      LEFT JOIN staff_users hr_rev ON hr_rev.id = r.hr_reviewed_by
`;

const REQUEST_LIST_SELECT = `
      r.*,
      u.full_name,
      u.role,
      u.staff_code,
      u.manager_id,
      mgr.full_name AS manager_name,
      reviewer.full_name AS reviewed_by_name,
      mgr_rev.full_name AS manager_reviewed_by_name,
      hr_rev.full_name AS hr_reviewed_by_name
`;

async function listStaffRequests(req, table) {
  const status = String(req.query.status || '').toLowerCase();
  const { params, where } = requestListScope(req.user, { mine: req.query.mine });
  if (['pending', 'approved', 'rejected'].includes(status)) {
    params.push(status);
    where.push(`r.status = $${params.length}`);
  }
  const { rows } = await query(
    `SELECT ${REQUEST_LIST_SELECT}
     FROM ${table} r
     ${REQUEST_LIST_JOINS}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
     LIMIT 500`,
    params
  );
  return rows.map((row) => presentStaffRequest(row, req.user));
}

async function reviewStaffRequest({ table, id, actor, body, onApprove }) {
  const status = String(body?.status || '').toLowerCase();
  const note = body?.review_note ? String(body.review_note).slice(0, 500) : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: existingRows } = await client.query(
      `SELECT r.*, u.role, u.manager_id, u.base_salary, u.full_name
       FROM ${table} r
       JOIN staff_users u ON u.id = r.staff_user_id
       WHERE r.id = $1
       FOR UPDATE OF r`,
      [id]
    );
    const row = existingRows[0];
    if (!row || row.status !== 'pending') {
      await client.query('ROLLBACK');
      const err = new Error('Pending request not found');
      err.status = 404;
      throw err;
    }
    const staff = {
      id: row.staff_user_id,
      role: row.role,
      manager_id: row.manager_id,
      base_salary: row.base_salary,
      full_name: row.full_name,
    };
    const next = applyRequestReview(row, actor, status, staff);
    const extra = {};
    if (next.finalized && next.status === 'approved' && onApprove) {
      const fromApprove = await onApprove(client, row, staff);
      if (fromApprove && typeof fromApprove === 'object') {
        Object.assign(extra, fromApprove);
      }
    }
    const managerJustSet = next.manager_reviewed_by && !row.manager_reviewed_by;
    const hrJustSet = next.hr_reviewed_by && !row.hr_reviewed_by;
    const extraCols = Object.keys(extra);
    const extraSql = extraCols.map((col, i) => `${col} = $${8 + i}`).join(', ');
    const { rows } = await client.query(
      `UPDATE ${table} SET
         status = $1,
         reviewed_by = $2,
         reviewed_at = now(),
         review_note = COALESCE($3, review_note),
         manager_reviewed_by = $4,
         manager_reviewed_at = CASE WHEN $5 THEN now() ELSE manager_reviewed_at END,
         hr_reviewed_by = $6,
         hr_reviewed_at = CASE WHEN $7 THEN now() ELSE hr_reviewed_at END
         ${extraSql ? `, ${extraSql}` : ''}
       WHERE id = $${8 + extraCols.length}
       RETURNING *`,
      [
        next.status,
        actor.id,
        note,
        next.manager_reviewed_by,
        managerJustSet,
        next.hr_reviewed_by,
        hrJustSet,
        ...extraCols.map((col) => extra[col]),
        id,
      ]
    );
    await client.query('COMMIT');
    return presentStaffRequest(
      {
        ...rows[0],
        role: staff.role,
        manager_id: staff.manager_id,
        full_name: staff.full_name,
      },
      actor
    );
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

function inclusiveDays(start, end) {
  const a = new Date(`${start}T00:00:00`);
  const b = new Date(`${end}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return NaN;
  return Math.round((b - a) / 86400000) + 1;
}

function periodBounds(year, month) {
  const y = Number(year);
  const m = Number(month);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { from, to: next };
}

function parsePeriod(req) {
  const now = new Date();
  const year = Number(req.query.year || req.body?.year) || now.getFullYear();
  const month = Number(req.query.month || req.body?.month) || now.getMonth() + 1;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    const err = new Error('Invalid year');
    err.status = 400;
    throw err;
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    const err = new Error('Invalid month');
    err.status = 400;
    throw err;
  }
  return { year, month, ...periodBounds(year, month) };
}

async function loadStaffForHr(staffUserId) {
  const { rows } = await query(
    `SELECT id, role, full_name, staff_code, base_salary, created_at, manager_id,
            COALESCE(leave_casual_days, 0)::int AS leave_casual_days,
            COALESCE(leave_annual_days, 0)::int AS leave_annual_days,
            COALESCE(leave_unpaid_days, 0)::int AS leave_unpaid_days,
            COALESCE(holiday_access, 'auto') AS holiday_access
     FROM staff_users WHERE id = $1`,
    [staffUserId]
  );
  if (!rows[0] || rows[0].role === 'owner') {
    const err = new Error('Staff member not found');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

async function pendingLeaveDays(staffUserId, leaveType, exceptId = null) {
  const params = [staffUserId, leaveType];
  let sql = `SELECT COALESCE(SUM(days), 0)::int AS days
             FROM staff_leave_requests
             WHERE staff_user_id = $1 AND leave_type = $2 AND status = 'pending'`;
  if (exceptId) {
    params.push(exceptId);
    sql += ` AND id <> $3`;
  }
  const { rows } = await query(sql, params);
  return Number(rows[0]?.days) || 0;
}

async function earlyLeaveUsed(staffUserId, year) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(days), 0)::int AS days
     FROM staff_leave_requests
     WHERE staff_user_id = $1
       AND leave_type = 'early_leave'
       AND status IN ('pending', 'approved')
       AND EXTRACT(YEAR FROM start_date) = $2`,
    [staffUserId, year]
  );
  return Number(rows[0]?.days) || 0;
}

async function leaveSnapshot(staffUserId) {
  const staff = await loadStaffForHr(staffUserId);
  const year = Number(cairoParts().date.slice(0, 4));
  const pendingCasual = await pendingLeaveDays(staffUserId, 'casual');
  const pendingAnnual = await pendingLeaveDays(staffUserId, 'annual');
  const pendingUnpaid = await pendingLeaveDays(staffUserId, 'unpaid');
  const earlyUsed = await earlyLeaveUsed(staffUserId, year);
  return {
    staff_user_id: staff.id,
    full_name: staff.full_name,
    base_salary: Number(staff.base_salary) || 0,
    daily_rate: dailyRate(staff.base_salary),
    casual_balance: Number(staff.leave_casual_days) || 0,
    annual_balance: Number(staff.leave_annual_days) || 0,
    unpaid_balance: Number(staff.leave_unpaid_days) || 0,
    casual_available: Math.max(0, (Number(staff.leave_casual_days) || 0) - pendingCasual),
    annual_available: Math.max(0, (Number(staff.leave_annual_days) || 0) - pendingAnnual),
    unpaid_available: Math.max(0, (Number(staff.leave_unpaid_days) || 0) - pendingUnpaid),
    early_leave_used: earlyUsed,
    early_leave_remaining: Math.max(0, EARLY_LEAVE_MAX_PER_YEAR - earlyUsed),
    early_leave_max: EARLY_LEAVE_MAX_PER_YEAR,
    year,
    holiday_access: staff.holiday_access || 'auto',
    can_request_holidays: canRequestHolidays(staff),
    tenure_months: monthsBetween(staff.created_at, new Date()),
  };
}

async function insertDeduction(db, values) {
  const q = db ? (sql, params) => db.query(sql, params) : query;
  const { rows } = await q(
    `INSERT INTO staff_salary_deductions
       (staff_user_id, amount, reason, deduction_date, category, created_by,
        arrival_time, notified, daily_rate, days_factor)
     VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    values
  );
  return rows[0];
}

function cellKey(staffId, date) {
  return `${staffId}|${String(date).slice(0, 10)}`;
}

function hhMmOrNull(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const m = text.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${String(m[1]).padStart(2, '0')}:${m[2]}`;
}

function buildAttendanceWrite({ staff, date, status, checkIn, checkOut, amount, notified, actorId }) {
  const st = String(status || '').trim();
  if (!['on_time', 'late', 'no_show'].includes(st)) {
    const err = new Error('Status must be on time, late, or no show');
    err.status = 400;
    throw err;
  }
  const inTime = hhMmOrNull(checkIn);
  const outTime = hhMmOrNull(checkOut);
  if (st === 'late' && !inTime) {
    const err = new Error('Check-in time is required for a late day');
    err.status = 400;
    throw err;
  }

  let lateComputed = null;
  let absenceComputed = null;
  let deductionAmount = amount;
  if (deductionAmount == null || Number.isNaN(Number(deductionAmount))) {
    if (st === 'on_time') deductionAmount = 0;
    else if (st === 'late') {
      lateComputed = computeLatenessDeduction(staff.base_salary, inTime);
      deductionAmount = lateComputed.amount;
    } else {
      absenceComputed = computeAbsenceDeduction(staff.base_salary, !!notified);
      deductionAmount = absenceComputed.amount;
    }
  }
  deductionAmount = roundMoney(Number(deductionAmount) || 0);
  if (deductionAmount < 0) deductionAmount = 0;

  if (st === 'late' && !lateComputed && inTime) {
    lateComputed = computeLatenessDeduction(staff.base_salary, inTime);
  }
  if (st === 'no_show' && !absenceComputed) {
    absenceComputed = computeAbsenceDeduction(staff.base_salary, !!notified);
  }

  const notifiedFlag = st === 'no_show' ? !!notified : null;
  const cell = mapAttendanceRow({
    staff_user_id: staff.id,
    work_date: date,
    status: st,
    check_in: inTime,
    check_out: outTime,
    deduction_amount: deductionAmount,
    notified: st === 'no_show' ? !!notified : false,
  });

  let deduction = null;
  if (deductionAmount > 0 && st !== 'on_time') {
    if (st === 'late' && lateComputed) {
      deduction = {
        staff_user_id: staff.id,
        amount: deductionAmount,
        reason: `Lateness at ${inTime} (${lateComputed.label})`,
        deduction_date: date,
        category: 'lateness',
        created_by: actorId || null,
        arrival_time: inTime,
        notified: null,
        daily_rate: lateComputed.daily_rate,
        days_factor: lateComputed.factor,
      };
    } else if (absenceComputed) {
      deduction = {
        staff_user_id: staff.id,
        amount: deductionAmount,
        reason: absenceComputed.label,
        deduction_date: date,
        category: 'absence',
        created_by: actorId || null,
        arrival_time: null,
        notified: !!notified,
        daily_rate: absenceComputed.daily_rate,
        days_factor: absenceComputed.factor,
      };
    }
  }

  return {
    cell,
    attendance: {
      staff_user_id: staff.id,
      work_date: date,
      status: st,
      check_in: inTime,
      check_out: outTime,
      deduction_amount: deductionAmount,
      notified: notifiedFlag,
      created_by: actorId || null,
    },
    deduction,
  };
}

async function bulkWriteAttendance(writes) {
  if (!writes.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const staffIds = writes.map((w) => w.attendance.staff_user_id);
    const dates = writes.map((w) => w.attendance.work_date);
    await client.query(
      `DELETE FROM staff_salary_deductions d
       USING unnest($1::int[], $2::date[]) AS x(staff_user_id, deduction_date)
       WHERE d.staff_user_id = x.staff_user_id
         AND d.deduction_date = x.deduction_date
         AND d.category IN ('lateness', 'absence')`,
      [staffIds, dates]
    );
    await client.query(
      `INSERT INTO staff_attendance
         (staff_user_id, work_date, status, check_in, check_out, deduction_amount, notified, created_by, updated_at)
       SELECT t.staff_user_id, t.work_date::date, t.status, t.check_in, t.check_out,
              t.deduction_amount, t.notified, t.created_by, now()
       FROM unnest(
         $1::int[], $2::date[], $3::text[], $4::text[], $5::text[], $6::float8[], $7::boolean[], $8::int[]
       ) AS t(staff_user_id, work_date, status, check_in, check_out, deduction_amount, notified, created_by)
       ON CONFLICT (staff_user_id, work_date) DO UPDATE SET
         status = EXCLUDED.status,
         check_in = EXCLUDED.check_in,
         check_out = EXCLUDED.check_out,
         deduction_amount = EXCLUDED.deduction_amount,
         notified = EXCLUDED.notified,
         created_by = EXCLUDED.created_by,
         updated_at = now()`,
      [
        writes.map((w) => w.attendance.staff_user_id),
        writes.map((w) => w.attendance.work_date),
        writes.map((w) => w.attendance.status),
        writes.map((w) => w.attendance.check_in),
        writes.map((w) => w.attendance.check_out),
        writes.map((w) => w.attendance.deduction_amount),
        writes.map((w) => w.attendance.notified),
        writes.map((w) => w.attendance.created_by),
      ]
    );
    const deductions = writes.map((w) => w.deduction).filter(Boolean);
    if (deductions.length) {
      await client.query(
        `INSERT INTO staff_salary_deductions
           (staff_user_id, amount, reason, deduction_date, category, created_by,
            arrival_time, notified, daily_rate, days_factor)
         SELECT t.staff_user_id, t.amount, t.reason, t.deduction_date::date, t.category, t.created_by,
                t.arrival_time, t.notified, t.daily_rate, t.days_factor
         FROM unnest(
           $1::int[], $2::float8[], $3::text[], $4::date[], $5::text[], $6::int[],
           $7::text[], $8::boolean[], $9::float8[], $10::float8[]
         ) AS t(staff_user_id, amount, reason, deduction_date, category, created_by,
                arrival_time, notified, daily_rate, days_factor)`,
        [
          deductions.map((d) => d.staff_user_id),
          deductions.map((d) => d.amount),
          deductions.map((d) => d.reason),
          deductions.map((d) => d.deduction_date),
          deductions.map((d) => d.category),
          deductions.map((d) => d.created_by),
          deductions.map((d) => d.arrival_time),
          deductions.map((d) => d.notified),
          deductions.map((d) => d.daily_rate),
          deductions.map((d) => d.days_factor),
        ]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

function mapAttendanceRow(row) {
  if (!row) return null;
  return {
    staff_user_id: row.staff_user_id,
    work_date: String(row.work_date || '').slice(0, 10),
    status: row.status,
    check_in: row.check_in || null,
    check_out: row.check_out || null,
    deduction_amount: Number(row.deduction_amount) || 0,
    notified: !!row.notified,
    notes: row.notes || '',
  };
}

function cellFromDeduction(row) {
  const category = String(row.category || '').toLowerCase();
  const status = category === 'absence' ? 'no_show' : 'late';
  return {
    staff_user_id: row.staff_user_id,
    work_date: String(row.deduction_date || '').slice(0, 10),
    status,
    check_in: row.arrival_time || null,
    check_out: null,
    deduction_amount: Number(row.amount) || 0,
    notified: !!row.notified,
    notes: row.reason || '',
    from_deduction: true,
  };
}

async function clearDayPenalties(staffId, date) {
  await query(
    `DELETE FROM staff_salary_deductions
     WHERE staff_user_id = $1
       AND deduction_date = $2::date
       AND category IN ('lateness', 'absence')`,
    [staffId, date]
  );
}

async function upsertAttendanceRecord({
  staff,
  date,
  status,
  checkIn,
  checkOut,
  amount,
  notified,
  actorId,
}) {
  const st = String(status || '').trim();
  if (!['on_time', 'late', 'no_show'].includes(st)) {
    const err = new Error('Status must be on time, late, or no show');
    err.status = 400;
    throw err;
  }
  const inTime = hhMmOrNull(checkIn);
  const outTime = hhMmOrNull(checkOut);
  if (st === 'late' && !inTime) {
    const err = new Error('Check-in time is required for a late day');
    err.status = 400;
    throw err;
  }

  let deductionAmount = amount;
  if (deductionAmount == null || Number.isNaN(Number(deductionAmount))) {
    if (st === 'on_time') deductionAmount = 0;
    else if (st === 'late') {
      deductionAmount = computeLatenessDeduction(staff.base_salary, inTime).amount;
    } else {
      deductionAmount = computeAbsenceDeduction(staff.base_salary, !!notified).amount;
    }
  }
  deductionAmount = roundMoney(Number(deductionAmount) || 0);
  if (deductionAmount < 0) deductionAmount = 0;

  await query(
    `INSERT INTO staff_attendance
       (staff_user_id, work_date, status, check_in, check_out, deduction_amount, notified, created_by, updated_at)
     VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,now())
     ON CONFLICT (staff_user_id, work_date) DO UPDATE SET
       status = EXCLUDED.status,
       check_in = EXCLUDED.check_in,
       check_out = EXCLUDED.check_out,
       deduction_amount = EXCLUDED.deduction_amount,
       notified = EXCLUDED.notified,
       created_by = EXCLUDED.created_by,
       updated_at = now()`,
    [staff.id, date, st, inTime, outTime, deductionAmount, st === 'no_show' ? !!notified : null, actorId || null]
  );

  await clearDayPenalties(staff.id, date);
  if (deductionAmount > 0 && st !== 'on_time') {
    if (st === 'late') {
      const computed = computeLatenessDeduction(staff.base_salary, inTime);
      await insertDeduction(null, [
        staff.id,
        deductionAmount,
        `Lateness at ${inTime} (${computed.label})`,
        date,
        'lateness',
        actorId || null,
        inTime,
        null,
        computed.daily_rate,
        computed.factor,
      ]);
    } else {
      const computed = computeAbsenceDeduction(staff.base_salary, !!notified);
      await insertDeduction(null, [
        staff.id,
        deductionAmount,
        computed.label,
        date,
        'absence',
        actorId || null,
        null,
        !!notified,
        computed.daily_rate,
        computed.factor,
      ]);
    }
  }

  return mapAttendanceRow({
    staff_user_id: staff.id,
    work_date: date,
    status: st,
    check_in: inTime,
    check_out: outTime,
    deduction_amount: deductionAmount,
    notified: st === 'no_show' ? !!notified : false,
  });
}

async function deleteAttendanceRecord(staffId, date) {
  await clearDayPenalties(staffId, date);
  await query(
    `DELETE FROM staff_attendance WHERE staff_user_id = $1 AND work_date = $2::date`,
    [staffId, date]
  );
}

router.get('/hr/payroll', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const { year, month, from, to } = parsePeriod(req);
    const { rows } = await query(
      `SELECT
         u.id AS staff_user_id,
         u.full_name,
         u.role,
         u.staff_code,
         u.is_active,
         COALESCE(u.base_salary, 0)::float AS live_base_salary,
         COALESCE(d.deductions, 0)::float AS live_deductions,
         COALESCE(b.bonuses, 0)::float AS live_bonuses,
         p.id AS payroll_id,
         p.base_salary::float AS paid_base_salary,
         p.deductions::float AS paid_deductions,
         COALESCE(p.bonuses, 0)::float AS paid_bonuses,
         p.net_pay::float AS paid_net_pay,
         p.status AS payroll_status,
         p.paid_at,
         p.notes,
         payer.full_name AS paid_by_name
       FROM staff_users u
       LEFT JOIN (
         SELECT staff_user_id, SUM(amount)::float AS deductions
         FROM staff_salary_deductions
         WHERE deduction_date >= $1::date AND deduction_date < $2::date
         GROUP BY staff_user_id
       ) d ON d.staff_user_id = u.id
       LEFT JOIN (
         SELECT staff_user_id, SUM(amount)::float AS bonuses
         FROM staff_salary_bonuses
         WHERE bonus_date >= $1::date AND bonus_date < $2::date
         GROUP BY staff_user_id
       ) b ON b.staff_user_id = u.id
       LEFT JOIN staff_payroll_entries p
         ON p.staff_user_id = u.id AND p.period_year = $3 AND p.period_month = $4
       LEFT JOIN staff_users payer ON payer.id = p.paid_by
       WHERE u.role <> 'owner'
       ORDER BY u.full_name`,
      [from, to, year, month]
    );

    const staff = rows.map((r) => {
      const paid = r.payroll_status === 'paid';
      const base = paid ? Number(r.paid_base_salary) : Number(r.live_base_salary) || 0;
      const deductions = paid ? Number(r.paid_deductions) : Number(r.live_deductions) || 0;
      const bonuses = paid ? Number(r.paid_bonuses) : Number(r.live_bonuses) || 0;
      const net = paid ? Number(r.paid_net_pay) : Math.max(0, roundMoney(base + bonuses - deductions));
      return {
        staff_user_id: r.staff_user_id,
        full_name: r.full_name,
        role: r.role,
        staff_code: r.staff_code,
        is_active: r.is_active,
        base_salary: base,
        bonuses,
        deductions,
        net_pay: net,
        live_deductions: Number(r.live_deductions) || 0,
        live_bonuses: Number(r.live_bonuses) || 0,
        status: paid ? 'paid' : 'unpaid',
        paid_at: r.paid_at,
        paid_by_name: r.paid_by_name,
        notes: r.notes,
        payroll_id: r.payroll_id,
      };
    });

    const active = staff.filter((s) => Number(s.is_active) === 1);
    const visible = req.query.include_inactive === '1' ? staff : active;
    const totals = visible.reduce(
      (acc, s) => {
        acc.base += s.base_salary;
        acc.bonuses += s.bonuses;
        acc.deductions += s.deductions;
        acc.net += s.net_pay;
        if (s.status === 'paid') acc.paid += s.net_pay;
        else acc.unpaid += s.net_pay;
        return acc;
      },
      { base: 0, bonuses: 0, deductions: 0, net: 0, paid: 0, unpaid: 0 }
    );

    res.json({ year, month, from, to, totals, staff: visible });
  } catch (e) {
    next(e);
  }
});

router.post('/hr/payroll/mark-paid', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const { year, month, from, to } = parsePeriod(req);
    const ids = Array.isArray(req.body?.staff_user_ids)
      ? req.body.staff_user_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [];
    const notes = req.body?.notes ? String(req.body.notes).slice(0, 500) : null;

    const { rows: staffRows } = await query(
      `SELECT
         u.id,
         COALESCE(u.base_salary, 0)::float AS base_salary,
         COALESCE(d.deductions, 0)::float AS deductions,
         COALESCE(b.bonuses, 0)::float AS bonuses
       FROM staff_users u
       LEFT JOIN (
         SELECT staff_user_id, SUM(amount)::float AS deductions
         FROM staff_salary_deductions
         WHERE deduction_date >= $1::date AND deduction_date < $2::date
         GROUP BY staff_user_id
       ) d ON d.staff_user_id = u.id
       LEFT JOIN (
         SELECT staff_user_id, SUM(amount)::float AS bonuses
         FROM staff_salary_bonuses
         WHERE bonus_date >= $1::date AND bonus_date < $2::date
         GROUP BY staff_user_id
       ) b ON b.staff_user_id = u.id
       WHERE u.role <> 'owner'
         AND u.is_active = 1
         ${ids.length ? `AND u.id = ANY($3::int[])` : ''}`,
      ids.length ? [from, to, ids] : [from, to]
    );

    if (!staffRows.length) {
      return res.status(400).json({ error: 'No matching staff to pay for this period' });
    }

    const paid = [];
    for (const row of staffRows) {
      const base = Number(row.base_salary) || 0;
      const deductions = Number(row.deductions) || 0;
      const bonuses = Number(row.bonuses) || 0;
      const net = Math.max(0, roundMoney(base + bonuses - deductions));
      const { rows } = await query(
        `INSERT INTO staff_payroll_entries (
           staff_user_id, period_year, period_month, base_salary, deductions, bonuses, net_pay,
           status, paid_at, paid_by, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'paid', now(), $8, $9)
         ON CONFLICT (staff_user_id, period_year, period_month)
         DO UPDATE SET
           base_salary = EXCLUDED.base_salary,
           deductions = EXCLUDED.deductions,
           bonuses = EXCLUDED.bonuses,
           net_pay = EXCLUDED.net_pay,
           status = 'paid',
           paid_at = now(),
           paid_by = EXCLUDED.paid_by,
           notes = COALESCE(EXCLUDED.notes, staff_payroll_entries.notes)
         RETURNING *`,
        [row.id, year, month, base, deductions, bonuses, net, req.user.id, notes]
      );
      paid.push(rows[0]);
    }

    res.json({ ok: true, year, month, count: paid.length, entries: paid });
  } catch (e) {
    next(e);
  }
});

router.get('/hr/my-leave', async (req, res, next) => {
  try {
    if (req.user.role === 'owner') {
      return res.status(403).json({ error: 'Owner accounts do not have staff leave' });
    }
    res.json(await leaveSnapshot(req.user.id));
  } catch (e) {
    next(e);
  }
});

router.get('/hr/payslip', async (req, res, next) => {
  try {
    if (req.user.role === 'owner') {
      return res.status(403).json({ error: 'Owner accounts do not have a staff payslip' });
    }
    const { year, month, from, to } = parsePeriod(req);
    let staffUserId = req.user.id;
    if (isHrActor(req.user) && req.query.staff_user_id) {
      staffUserId = Number(req.query.staff_user_id);
    }
    const staff = await loadStaffForHr(staffUserId);
    if (!isHrActor(req.user) && staffUserId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { rows: deductionRows } = await query(
      `SELECT id, amount, reason, deduction_date, category, arrival_time, notified, daily_rate, days_factor
       FROM staff_salary_deductions
       WHERE staff_user_id = $1 AND deduction_date >= $2::date AND deduction_date < $3::date
       ORDER BY deduction_date, id`,
      [staffUserId, from, to]
    );
    const { rows: bonusRows } = await query(
      `SELECT id, amount, reason, bonus_date
       FROM staff_salary_bonuses
       WHERE staff_user_id = $1 AND bonus_date >= $2::date AND bonus_date < $3::date
       ORDER BY bonus_date, id`,
      [staffUserId, from, to]
    );
    const { rows: payrollRows } = await query(
      `SELECT * FROM staff_payroll_entries
       WHERE staff_user_id = $1 AND period_year = $2 AND period_month = $3`,
      [staffUserId, year, month]
    );
    const payroll = payrollRows[0] || null;
    const paid = payroll?.status === 'paid';
    const split = splitSalaryAdjustments(deductionRows);
    const liveBonuses = roundMoney(bonusRows.reduce((acc, r) => acc + (Number(r.amount) || 0), 0));
    const liveDebits = roundMoney(split.penalties_total + split.deductions_total);
    const base = paid ? Number(payroll.base_salary) || 0 : Number(staff.base_salary) || 0;
    const bonuses = paid ? Number(payroll.bonuses) || liveBonuses : liveBonuses;
    const debits = paid ? Number(payroll.deductions) || liveDebits : liveDebits;
    const net = paid
      ? Number(payroll.net_pay) || 0
      : Math.max(0, roundMoney(base + bonuses - liveDebits));

    res.json({
      year,
      month,
      from,
      to,
      staff_user_id: staff.id,
      full_name: staff.full_name,
      staff_code: staff.staff_code || null,
      role: staff.role,
      daily_rate: dailyRate(staff.base_salary),
      status: paid ? 'paid' : 'unpaid',
      paid_at: payroll?.paid_at || null,
      notes: payroll?.notes || null,
      base_salary: base,
      bonuses,
      penalties: split.penalties_total,
      deductions: split.deductions_total,
      debits,
      net_pay: net,
      bonus_items: bonusRows,
      penalty_items: split.penalties,
      deduction_items: split.deductions,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/hr/salary-bonuses', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const staffId = req.query.staff_user_id ? Number(req.query.staff_user_id) : null;
    const params = [];
    let filter = '';
    if (staffId) {
      params.push(staffId);
      filter = `WHERE b.staff_user_id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT b.*,
              u.full_name,
              u.role,
              u.staff_code,
              creator.full_name AS created_by_name
       FROM staff_salary_bonuses b
       JOIN staff_users u ON u.id = b.staff_user_id
       LEFT JOIN staff_users creator ON creator.id = b.created_by
       ${filter}
       ORDER BY b.bonus_date DESC, b.id DESC
       LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/hr/salary-bonuses', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const b = req.body || {};
    const staffUserId = Number(b.staff_user_id);
    const bonusDate = String(b.bonus_date || b.deduction_date || '').slice(0, 10);
    const amount = parseFloat(b.amount);
    const reason = String(b.reason || '').trim();
    if (!staffUserId || !bonusDate) {
      return res.status(400).json({ error: 'Staff and date are required' });
    }
    if (Number.isNaN(amount) || amount <= 0 || !reason) {
      return res.status(400).json({ error: 'Amount and reason are required' });
    }
    await loadStaffForHr(staffUserId);
    const { rows } = await query(
      `INSERT INTO staff_salary_bonuses (staff_user_id, amount, reason, bonus_date, created_by)
       VALUES ($1,$2,$3,$4::date,$5)
       RETURNING *`,
      [staffUserId, amount, reason.slice(0, 255), bonusDate, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.delete('/hr/salary-bonuses/:id', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const { rowCount } = await query(`DELETE FROM staff_salary_bonuses WHERE id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Bonus not found' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/hr/salary-deductions', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const staffId = req.query.staff_user_id ? Number(req.query.staff_user_id) : null;
    const params = [];
    let filter = '';
    if (staffId) {
      params.push(staffId);
      filter = `WHERE d.staff_user_id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT d.*,
              u.full_name,
              u.role,
              u.staff_code,
              creator.full_name AS created_by_name
       FROM staff_salary_deductions d
       JOIN staff_users u ON u.id = d.staff_user_id
       LEFT JOIN staff_users creator ON creator.id = d.created_by
       ${filter}
       ORDER BY d.deduction_date DESC, d.id DESC
       LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/hr/salary-deductions', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const b = req.body || {};
    const staffUserId = Number(b.staff_user_id);
    const deductionDate = String(b.deduction_date || '').slice(0, 10);
    let category = String(b.category || b.kind || 'other').trim() || 'other';
    if (category === 'delay') category = 'other';
    const allowed = new Set(['performance', 'advance', 'other', 'penalty']);
    if (!staffUserId || !deductionDate) {
      return res.status(400).json({ error: 'Staff and date are required' });
    }
    if (!allowed.has(category)) {
      return res.status(400).json({ error: 'Invalid deduction category' });
    }

    const staff = await loadStaffForHr(staffUserId);
    if (staff.role === 'admin') {
      return res.status(403).json({ error: 'Admins do not have salary deductions' });
    }
    let amount;
    let reason = String(b.reason || '').trim();
    let arrivalTime = null;
    let notified = null;
    let rate = dailyRate(staff.base_salary);
    let factor = null;

    amount = parseFloat(b.amount);
    if (Number.isNaN(amount) || amount <= 0 || !reason) {
      return res.status(400).json({ error: 'Amount and reason are required' });
    }

    const { rows } = await query(
      `INSERT INTO staff_salary_deductions
         (staff_user_id, amount, reason, deduction_date, category, created_by,
          arrival_time, notified, daily_rate, days_factor)
       VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        staffUserId,
        amount,
        reason,
        deductionDate,
        category,
        req.user.id,
        arrivalTime,
        notified,
        rate,
        factor,
      ]
    );
    res.status(201).json({ ...rows[0], daily_rate: rate, days_factor: factor });
  } catch (e) {
    next(e);
  }
});

router.delete('/hr/salary-deductions/:id', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const { rowCount } = await query(`DELETE FROM staff_salary_deductions WHERE id = $1`, [
      req.params.id,
    ]);
    if (!rowCount) return res.status(404).json({ error: 'Deduction not found' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/hr/leave-requests', async (req, res, next) => {
  try {
    res.json(await listStaffRequests(req, 'staff_leave_requests'));
  } catch (e) {
    next(e);
  }
});

router.post('/hr/leave-requests', async (req, res, next) => {
  try {
    if (req.user.role === 'admin') {
      return res.status(403).json({ error: 'Admins do not request holidays' });
    }
    const b = req.body || {};
    let leaveType = String(b.leave_type || 'casual').trim() || 'casual';
    if (leaveType === 'holiday') leaveType = 'annual';
    if (leaveType === 'day_off') leaveType = 'casual';
    const start = String(b.start_date || '').slice(0, 10);
    const end = String(b.end_date || start).slice(0, 10);
    const reason = String(b.reason || '').trim();
    const allowed = new Set(['casual', 'annual', 'early_leave', 'sick', 'unpaid']);
    if (!allowed.has(leaveType)) {
      return res.status(400).json({ error: 'Invalid leave type' });
    }
    const days = leaveType === 'early_leave' ? 1 : inclusiveDays(start, end);
    if (!start || !end || !Number.isFinite(days) || days < 1) {
      return res.status(400).json({ error: 'Valid start and end dates are required' });
    }
    if (leaveType === 'early_leave' && start !== end) {
      return res.status(400).json({ error: 'Early leave is a single day' });
    }
    let staffUserId = req.user.id;
    if (isHrActor(req.user) && b.staff_user_id) {
      staffUserId = Number(b.staff_user_id);
    }
    if (req.user.role === 'owner') {
      return res.status(403).json({ error: 'Owner accounts cannot request staff holidays' });
    }

    const targetStaff = await loadStaffForHr(staffUserId);
    assertCanTargetBenefits(targetStaff);
    if (leaveTypeRequiresHolidayAccess(leaveType) && !canRequestHolidays(targetStaff)) {
      return res.status(403).json({
        error:
          'Paid holiday requests are not enabled for this account yet. Access opens automatically after 6 months, or HR can grant it earlier. Unpaid leave can be requested now.',
      });
    }

    const now = new Date();
    if (leaveType === 'casual') assertCasualTiming(start, now);
    if (leaveType === 'annual') assertAnnualNotice(start, now);
    if (leaveType === 'early_leave') assertEarlyLeaveTiming(start, now);
    if (leaveType === 'unpaid' && start < cairoParts(now).date) {
      return res.status(400).json({ error: 'Unpaid leave cannot be requested for a past date' });
    }

    const snap = await leaveSnapshot(staffUserId);
    if (leaveType === 'casual' && days > snap.casual_available) {
      return res.status(400).json({
        error: `Not enough casual leave (${snap.casual_available} day${snap.casual_available === 1 ? '' : 's'} left)`,
      });
    }
    if (leaveType === 'annual' && days > snap.annual_available) {
      return res.status(400).json({
        error: `Not enough annual leave (${snap.annual_available} day${snap.annual_available === 1 ? '' : 's'} left)`,
      });
    }
    if (leaveType === 'unpaid' && days > snap.unpaid_available) {
      return res.status(400).json({
        error: `Not enough unpaid leave (${snap.unpaid_available} day${snap.unpaid_available === 1 ? '' : 's'} left)`,
      });
    }
    if (leaveType === 'early_leave' && days > snap.early_leave_remaining) {
      return res.status(400).json({
        error: `Early leave limit reached (maximum ${EARLY_LEAVE_MAX_PER_YEAR} per year)`,
      });
    }

    const policy = staffRequestPolicy(targetStaff.role);
    const { rows } = await query(
      `INSERT INTO staff_leave_requests
         (staff_user_id, leave_type, start_date, end_date, days, reason, status,
          needs_manager_approval, needs_hr_approval)
       VALUES ($1,$2,$3::date,$4::date,$5,$6,'pending',$7,$8)
       RETURNING *`,
      [
        staffUserId,
        leaveType,
        start,
        leaveType === 'early_leave' ? start : end,
        days,
        reason || null,
        policy.needsManager,
        policy.needsHr,
      ]
    );
    res.status(201).json(
      presentStaffRequest(
        {
          ...rows[0],
          full_name: targetStaff.full_name,
          role: targetStaff.role,
          staff_code: targetStaff.staff_code,
          manager_id: targetStaff.manager_id,
        },
        req.user
      )
    );
  } catch (e) {
    next(e);
  }
});

router.post('/hr/leave-requests/:id/review', async (req, res, next) => {
  try {
    const updated = await reviewStaffRequest({
      table: 'staff_leave_requests',
      id: req.params.id,
      actor: req.user,
      body: req.body,
      onApprove: async (client, row) => {
        if (row.leave_type === 'casual' || row.leave_type === 'annual' || row.leave_type === 'unpaid') {
          const col =
            row.leave_type === 'casual'
              ? 'leave_casual_days'
              : row.leave_type === 'annual'
                ? 'leave_annual_days'
                : 'leave_unpaid_days';
          const { rows: staffRows } = await client.query(
            `SELECT ${col} AS balance FROM staff_users WHERE id = $1 FOR UPDATE`,
            [row.staff_user_id]
          );
          const balance = Number(staffRows[0]?.balance) || 0;
          if (balance < Number(row.days)) {
            const err = new Error(
              `Not enough ${row.leave_type} balance to approve (${balance} left, ${row.days} needed)`
            );
            err.status = 400;
            throw err;
          }
          await client.query(
            `UPDATE staff_users SET ${col} = ${col} - $1, updated_at = now() WHERE id = $2`,
            [row.days, row.staff_user_id]
          );
        }
        if (row.leave_type === 'early_leave') {
          const year = String(row.start_date).slice(0, 4);
          const { rows: usedRows } = await client.query(
            `SELECT COALESCE(SUM(days), 0)::int AS days
             FROM staff_leave_requests
             WHERE staff_user_id = $1 AND leave_type = 'early_leave'
               AND status = 'approved' AND EXTRACT(YEAR FROM start_date) = $2`,
            [row.staff_user_id, Number(year)]
          );
          const used = Number(usedRows[0]?.days) || 0;
          if (used + Number(row.days) > EARLY_LEAVE_MAX_PER_YEAR) {
            const err = new Error(
              `Early leave limit reached (maximum ${EARLY_LEAVE_MAX_PER_YEAR} per year)`
            );
            err.status = 400;
            throw err;
          }
        }
      },
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.get('/hr/loans', async (req, res, next) => {
  try {
    if (req.user.role === 'owner') return res.status(403).json({ error: 'Forbidden' });
    res.json(await listStaffRequests(req, 'staff_loan_requests'));
  } catch (e) {
    next(e);
  }
});

router.post('/hr/loans', async (req, res, next) => {
  try {
    if (req.user.role === 'admin') {
      return res.status(403).json({ error: 'Admins do not request loans' });
    }
    if (req.user.role === 'owner') return res.status(403).json({ error: 'Forbidden' });
    const amount = parseFloat(req.body?.amount);
    const reason = String(req.body?.reason || '').trim();
    if (!(amount > 0) || !reason) {
      return res.status(400).json({ error: 'Amount and reason are required' });
    }
    let staffUserId = req.user.id;
    if (isHrActor(req.user) && req.body?.staff_user_id) {
      staffUserId = Number(req.body.staff_user_id);
    }
    const target = await loadStaffForHr(staffUserId);
    assertCanTargetBenefits(target);
    const policy = staffRequestPolicy(target.role);
    const { rows } = await query(
      `INSERT INTO staff_loan_requests
         (staff_user_id, amount, reason, status, needs_manager_approval, needs_hr_approval)
       VALUES ($1,$2,$3,'pending',$4,$5)
       RETURNING *`,
      [staffUserId, amount, reason, policy.needsManager, policy.needsHr]
    );
    res.status(201).json(
      presentStaffRequest(
        {
          ...rows[0],
          full_name: target.full_name,
          role: target.role,
          staff_code: target.staff_code,
          manager_id: target.manager_id,
        },
        req.user
      )
    );
  } catch (e) {
    next(e);
  }
});

router.post('/hr/loans/:id/review', async (req, res, next) => {
  try {
    const updated = await reviewStaffRequest({
      table: 'staff_loan_requests',
      id: req.params.id,
      actor: req.user,
      body: req.body,
      onApprove: async (client, row, staff) => {
        const next = nextPayrollPeriod(cairoParts().date);
        const inserted = await insertDeduction(client, [
          row.staff_user_id,
          row.amount,
          String(row.reason || 'Salary loan').slice(0, 255),
          next.deductionDate,
          'loan',
          req.user.id,
          null,
          null,
          dailyRate(staff.base_salary),
          null,
        ]);
        return {
          deduct_year: next.year,
          deduct_month: next.month,
          deduction_id: inserted.id,
        };
      },
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.get('/hr/wfh', async (req, res, next) => {
  try {
    if (req.user.role === 'owner') return res.status(403).json({ error: 'Forbidden' });
    res.json(await listStaffRequests(req, 'staff_wfh_requests'));
  } catch (e) {
    next(e);
  }
});

router.post('/hr/wfh', async (req, res, next) => {
  try {
    if (req.user.role === 'admin') {
      return res.status(403).json({ error: 'Admins do not request work-from-home days' });
    }
    if (req.user.role === 'owner') return res.status(403).json({ error: 'Forbidden' });
    const workDate = String(req.body?.work_date || '').slice(0, 10);
    const reason = String(req.body?.reason || '').trim();
    if (!workDate) return res.status(400).json({ error: 'Work date is required' });
    const cairo = cairoParts();
    if (workDate < cairo.date) {
      return res.status(400).json({ error: 'Work from home cannot be requested for a past date' });
    }
    let staffUserId = req.user.id;
    if (isHrActor(req.user) && req.body?.staff_user_id) {
      staffUserId = Number(req.body.staff_user_id);
    }
    const target = await loadStaffForHr(staffUserId);
    assertCanTargetBenefits(target);
    if (isFieldOperationsRole(target.role)) {
      return res.status(400).json({
        error: 'Operations staff work in the field and do not use office attendance or work-from-home days',
      });
    }
    const { rows: existing } = await query(
      `SELECT id FROM staff_wfh_requests
       WHERE staff_user_id = $1 AND work_date = $2::date AND status IN ('pending','approved')
       LIMIT 1`,
      [staffUserId, workDate]
    );
    if (existing[0]) {
      return res.status(400).json({ error: 'A work-from-home request already exists for that day' });
    }
    const policy = staffRequestPolicy(target.role);
    const { rows } = await query(
      `INSERT INTO staff_wfh_requests
         (staff_user_id, work_date, reason, status, needs_manager_approval, needs_hr_approval)
       VALUES ($1,$2::date,$3,'pending',$4,$5)
       RETURNING *`,
      [staffUserId, workDate, reason || null, policy.needsManager, policy.needsHr]
    );
    res.status(201).json(
      presentStaffRequest(
        {
          ...rows[0],
          full_name: target.full_name,
          role: target.role,
          staff_code: target.staff_code,
          manager_id: target.manager_id,
        },
        req.user
      )
    );
  } catch (e) {
    next(e);
  }
});

router.post('/hr/wfh/:id/review', async (req, res, next) => {
  try {
    const updated = await reviewStaffRequest({
      table: 'staff_wfh_requests',
      id: req.params.id,
      actor: req.user,
      body: req.body,
      onApprove: async (client, row, staff) => {
        const computed = computeHalfDayDeduction(staff.base_salary);
        const inserted = await insertDeduction(client, [
          row.staff_user_id,
          computed.amount,
          computed.label,
          row.work_date,
          'wfh',
          req.user.id,
          null,
          null,
          computed.daily_rate,
          computed.days_factor,
        ]);
        return { deduction_id: inserted.id };
      },
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.get('/hr/holiday-access', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, full_name, role, staff_code, is_active, created_at,
              COALESCE(holiday_access, 'auto') AS holiday_access
       FROM staff_users
       WHERE role NOT IN ('owner', 'admin')
       ORDER BY full_name`
    );
    const now = new Date();
    res.json(
      rows.map((r) => ({
        ...r,
        can_request_holidays: canRequestHolidays(r, now),
        tenure_months: monthsBetween(r.created_at, now),
      }))
    );
  } catch (e) {
    next(e);
  }
});

router.patch('/hr/holiday-access/:id', requireRoles('admin', 'hr_supervisor'), async (req, res, next) => {
  try {
    const access = String(req.body?.holiday_access || '').toLowerCase();
    if (!['auto', 'granted', 'denied'].includes(access)) {
      return res.status(400).json({ error: 'holiday_access must be auto, granted, or denied' });
    }
    const staff = await loadStaffForHr(Number(req.params.id));
    assertCanEditStaffCompensation(req.user, staff.id, 'holiday access');
    const { rows } = await query(
      `UPDATE staff_users SET holiday_access = $1, updated_at = now() WHERE id = $2
       RETURNING id, full_name, role, staff_code, created_at,
                 COALESCE(holiday_access, 'auto') AS holiday_access`,
      [access, staff.id]
    );
    const row = rows[0];
    res.json({
      ...row,
      can_request_holidays: canRequestHolidays(row),
      tenure_months: monthsBetween(row.created_at, new Date()),
    });
  } catch (e) {
    next(e);
  }
});

function loadAttendanceJson(file) {
  const buf = file.buffer;
  const head = buf.slice(0, 800).toString('utf8');
  if (/<html/i.test(head) || /<table/i.test(head)) {
    return parseHtmlExcelTables(buf.toString('utf8'));
  }
  try {
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  } catch (err) {
    const asText = buf.toString('utf8');
    if (/<td/i.test(asText)) return parseHtmlExcelTables(asText);
    throw err;
  }
}

router.get('/hr/attendance', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const { year, month, from, to } = parsePeriod(req);
    const days = [];
    const cursor = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    while (cursor < end) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      const d = String(cursor.getDate()).padStart(2, '0');
      days.push(`${y}-${m}-${d}`);
      cursor.setDate(cursor.getDate() + 1);
    }

    const { rows: staffRows } = await query(
      `SELECT id, full_name, role, staff_code, is_active,
              COALESCE(base_salary, 0)::float AS base_salary
       FROM staff_users
       WHERE COALESCE(is_active, 1)::int = 1
       ORDER BY full_name ASC, id ASC`
    );
    const staff = staffRows.filter((s) => hasOfficeAttendance(s.role));

    const { rows: attendanceRows } = await query(
      `SELECT staff_user_id, work_date::text AS work_date, status, check_in, check_out,
              deduction_amount, notified, notes
       FROM staff_attendance
       WHERE work_date >= $1::date AND work_date < $2::date`,
      [from, to]
    );
    const { rows: deductionRows } = await query(
      `SELECT staff_user_id, deduction_date::text AS deduction_date, category, amount,
              arrival_time, notified, reason
       FROM staff_salary_deductions
       WHERE category IN ('lateness', 'absence')
         AND deduction_date >= $1::date AND deduction_date < $2::date
       ORDER BY id`,
      [from, to]
    );
    const { rows: leaveRows } = await query(
      `SELECT staff_user_id, leave_type,
              start_date::text AS start_date, end_date::text AS end_date
       FROM staff_leave_requests
       WHERE status = 'approved'
         AND start_date < $2::date
         AND end_date >= $1::date`,
      [from, to]
    );

    const cells = {};
    for (const row of deductionRows) {
      cells[cellKey(row.staff_user_id, row.deduction_date)] = cellFromDeduction(row);
    }
    for (const row of attendanceRows) {
      cells[cellKey(row.staff_user_id, row.work_date)] = mapAttendanceRow(row);
    }
    for (const leave of leaveRows) {
      for (const date of days) {
        if (!dateCoveredByRanges(date, [leave])) continue;
        cells[cellKey(leave.staff_user_id, date)] = {
          staff_user_id: leave.staff_user_id,
          work_date: date,
          status: 'holiday',
          leave_type: leave.leave_type,
          start_date: leave.start_date,
          end_date: leave.end_date,
          check_in: null,
          check_out: null,
          deduction_amount: 0,
          notified: false,
          notes: '',
        };
      }
    }

    res.json({
      year,
      month,
      from_date: from,
      to_date: to,
      days,
      staff: staff.map((s) => ({
        ...s,
        daily_rate: dailyRate(s.base_salary),
      })),
      cells,
    });
  } catch (e) {
    next(e);
  }
});

router.put('/hr/attendance', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const b = req.body || {};
    const staffUserId = Number(b.staff_user_id);
    const date = String(b.work_date || b.date || '').slice(0, 10);
    if (!staffUserId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Staff and date are required' });
    }
    const staff = await loadStaffForHr(staffUserId);
    if (!hasOfficeAttendance(staff.role)) {
      return res.status(400).json({ error: 'This role does not use office attendance' });
    }
    const { rows: holidayRows } = await query(
      `SELECT id FROM staff_leave_requests
       WHERE staff_user_id = $1 AND status = 'approved'
         AND start_date <= $2::date AND end_date >= $2::date
       LIMIT 1`,
      [staff.id, date]
    );
    if (holidayRows[0]) {
      return res.status(400).json({ error: 'This day is an approved holiday' });
    }
    if (b.clear === true || b.status === '' || b.status === 'clear') {
      await deleteAttendanceRecord(staff.id, date);
      return res.json({ ok: true, cleared: true, staff_user_id: staff.id, work_date: date });
    }
    const amountRaw = b.deduction_amount;
    const amount =
      amountRaw === '' || amountRaw == null || amountRaw === undefined
        ? null
        : Number(amountRaw);
    const cell = await upsertAttendanceRecord({
      staff,
      date,
      status: b.status,
      checkIn: b.check_in,
      checkOut: b.check_out,
      amount,
      notified: b.notified,
      actorId: req.user.id,
    });
    res.json({ ok: true, cell });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/hr/attendance/import',
  requireRoles(...HR_ROLES),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ error: 'Upload an Excel attendance file (.xls or .xlsx)' });
      }
      const json = loadAttendanceJson(req.file);
      const punches = parseAttendanceRows(json).filter((r) => r.staff_code || r.name || r.date);
      if (!punches.length) {
        return res.status(400).json({ error: 'The sheet has no attendance rows' });
      }
      let parsed = isDoorPunchLog(punches) ? collapsePunchAttendance(punches) : punches;
      if (!parsed.length) {
        return res.status(400).json({ error: 'The sheet has no attendance rows' });
      }

      const { rows: staffRows } = await query(
        `SELECT id, staff_code, full_name, base_salary, role FROM staff_users WHERE role <> 'owner'`
      );

      if (isDoorPunchLog(punches)) {
        parsed = parsed.concat(fillMissingOfficeAbsences(parsed, staffRows));
      }

      const dates = parsed.map((p) => p.date).filter(Boolean).sort();
      const minDate = dates[0] || cairoParts().date;
      const maxDate = dates[dates.length - 1] || minDate;

      const { rows: leaveRows } = await query(
        `SELECT staff_user_id, start_date::text AS start_date, end_date::text AS end_date
         FROM staff_leave_requests
         WHERE status = 'approved' AND start_date <= $2::date AND end_date >= $1::date`,
        [minDate, maxDate]
      );
      const leavesByStaff = new Map();
      for (const l of leaveRows) {
        const list = leavesByStaff.get(l.staff_user_id) || [];
        list.push(l);
        leavesByStaff.set(l.staff_user_id, list);
      }

      const { rows: wfhRows } = await query(
        `SELECT staff_user_id, work_date::text AS work_date
         FROM staff_wfh_requests
         WHERE status = 'approved' AND work_date >= $1::date AND work_date <= $2::date`,
        [minDate, maxDate]
      );
      const wfhByStaff = new Map();
      for (const w of wfhRows) {
        const set = wfhByStaff.get(w.staff_user_id) || new Set();
        set.add(w.work_date);
        wfhByStaff.set(w.staff_user_id, set);
      }

      const staffById = new Map(staffRows.map((s) => [String(s.id), s]));
      const staffByCode = new Map();
      for (const s of staffRows) {
        const code = normalizePersonId(s.staff_code).toLowerCase();
        if (code && !staffByCode.has(code)) staffByCode.set(code, s);
      }
      const findStaff = (row) => {
        const code = normalizePersonId(row.staff_code);
        if (code && /^\d+$/.test(code) && staffById.has(code)) return staffById.get(code);
        if (code && staffByCode.has(code.toLowerCase())) return staffByCode.get(code.toLowerCase());
        return matchAttendanceStaff(row, staffRows);
      };

      const created = [];
      const skipped = [];
      const errors = [];
      const writesByKey = new Map();

      for (const row of parsed) {
        if (!row.date) {
          errors.push({ row: row.row, error: 'Missing date' });
          continue;
        }
        const staff = findStaff(row);
        if (!staff) {
          errors.push({
            row: row.row,
            error: `Unknown staff (${row.staff_code || row.name || 'blank'})`,
          });
          continue;
        }
        if (!hasOfficeAttendance(staff.role)) {
          skipped.push({ row: row.row, staff_user_id: staff.id, reason: 'no_office_attendance' });
          continue;
        }
        if (dateCoveredByRanges(row.date, leavesByStaff.get(staff.id) || [])) {
          skipped.push({ row: row.row, staff_user_id: staff.id, reason: 'approved_holiday' });
          continue;
        }
        if ((wfhByStaff.get(staff.id) || new Set()).has(row.date)) {
          skipped.push({ row: row.row, staff_user_id: staff.id, reason: 'approved_wfh' });
          continue;
        }

        try {
          const absent = row.absent || !row.arrival_time;
          const computed = absent
            ? null
            : computeLatenessDeduction(staff.base_salary, row.arrival_time);
          const write = buildAttendanceWrite({
            staff,
            date: row.date,
            status: absent ? 'no_show' : computed.factor <= 0 ? 'on_time' : 'late',
            checkIn: absent ? null : row.arrival_time,
            checkOut: absent ? null : row.check_out,
            amount: absent ? null : computed.amount,
            notified: row.notified,
            actorId: req.user.id,
          });
          writesByKey.set(`${staff.id}|${row.date}`, write);
          if (!absent && computed.factor <= 0) {
            skipped.push({ row: row.row, staff_user_id: staff.id, reason: 'on_time' });
          }
        } catch (err) {
          errors.push({ row: row.row, error: err.message || 'Could not import row' });
        }
      }

      const writes = [...writesByKey.values()];
      if (writes.length) await bulkWriteAttendance(writes);
      created.push(...writes.map((w) => w.cell));

      res.json({
        ok: true,
        created: created.length,
        skipped: skipped.length,
        errors,
        skipped_details: skipped,
        deductions: created,
      });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
