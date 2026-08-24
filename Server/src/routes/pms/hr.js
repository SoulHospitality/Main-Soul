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
  monthsBetween,
  assertHrNotEditingOwnCompensation,
  isHrActingOnSelf,
  nextPayrollPeriod,
  dateCoveredByRanges,
  parseAttendanceRows,
  parseHtmlExcelTables,
  collapsePunchAttendance,
  isDoorPunchLog,
  normalizePersonId,
  roundMoney,
  splitSalaryAdjustments,
  hasOfficeAttendance,
} = require('../../lib/hrRules');

const router = express.Router();

const HR_ROLES = ['admin', 'hr'];

function isHrActor(user) {
  return user && (user.role === 'admin' || user.role === 'hr');
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
    `SELECT id, role, full_name, staff_code, base_salary, created_at,
            COALESCE(leave_casual_days, 0)::int AS leave_casual_days,
            COALESCE(leave_annual_days, 0)::int AS leave_annual_days,
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
  const earlyUsed = await earlyLeaveUsed(staffUserId, year);
  return {
    staff_user_id: staff.id,
    full_name: staff.full_name,
    base_salary: Number(staff.base_salary) || 0,
    daily_rate: dailyRate(staff.base_salary),
    casual_balance: Number(staff.leave_casual_days) || 0,
    annual_balance: Number(staff.leave_annual_days) || 0,
    casual_available: Math.max(0, (Number(staff.leave_casual_days) || 0) - pendingCasual),
    annual_available: Math.max(0, (Number(staff.leave_annual_days) || 0) - pendingAnnual),
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
    const status = String(req.query.status || '').toLowerCase();
    const params = [];
    const where = [];
    if (req.query.mine === '1' || !isHrActor(req.user)) {
      params.push(req.user.id);
      where.push(`lr.staff_user_id = $${params.length}`);
    }
    if (['pending', 'approved', 'rejected'].includes(status)) {
      params.push(status);
      where.push(`lr.status = $${params.length}`);
    }
    const sql = `
      SELECT lr.*,
             u.full_name,
             u.role,
             u.staff_code,
             reviewer.full_name AS reviewed_by_name
      FROM staff_leave_requests lr
      JOIN staff_users u ON u.id = lr.staff_user_id
      LEFT JOIN staff_users reviewer ON reviewer.id = lr.reviewed_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY
        CASE lr.status WHEN 'pending' THEN 0 ELSE 1 END,
        lr.created_at DESC
      LIMIT 500
    `;
    const { rows } = await query(sql, params);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/hr/leave-requests', async (req, res, next) => {
  try {
    const b = req.body || {};
    let leaveType = String(b.leave_type || 'casual').trim() || 'casual';
    if (leaveType === 'holiday') leaveType = 'annual';
    if (leaveType === 'day_off') leaveType = 'casual';
    const start = String(b.start_date || '').slice(0, 10);
    const end = String(b.end_date || start).slice(0, 10);
    const reason = String(b.reason || '').trim();
    const allowed = new Set(['casual', 'annual', 'early_leave', 'sick']);
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
    if (!canRequestHolidays(targetStaff)) {
      return res.status(403).json({
        error:
          'Holiday requests are not enabled for this account yet. Access opens automatically after 6 months, or HR can grant it earlier.',
      });
    }

    const now = new Date();
    if (leaveType === 'casual') assertCasualTiming(start, now);
    if (leaveType === 'annual') assertAnnualNotice(start, now);
    if (leaveType === 'early_leave') assertEarlyLeaveTiming(start, now);

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
    if (leaveType === 'early_leave' && days > snap.early_leave_remaining) {
      return res.status(400).json({
        error: `Early leave limit reached (maximum ${EARLY_LEAVE_MAX_PER_YEAR} per year)`,
      });
    }

    const { rows } = await query(
      `INSERT INTO staff_leave_requests
         (staff_user_id, leave_type, start_date, end_date, days, reason, status)
       VALUES ($1,$2,$3::date,$4::date,$5,$6,'pending')
       RETURNING *`,
      [staffUserId, leaveType, start, leaveType === 'early_leave' ? start : end, days, reason || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post('/hr/leave-requests/:id/review', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const status = String(req.body?.status || '').toLowerCase();
    if (status !== 'approved' && status !== 'rejected') {
      return res.status(400).json({ error: 'Status must be approved or rejected' });
    }
    const note = req.body?.review_note ? String(req.body.review_note).slice(0, 500) : null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: existingRows } = await client.query(
        `SELECT * FROM staff_leave_requests WHERE id = $1 AND status = 'pending' FOR UPDATE`,
        [req.params.id]
      );
      const row = existingRows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Pending request not found' });
      }
      if (isHrActingOnSelf(req.user, row.staff_user_id)) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: 'Only an admin can approve or reject your own holiday requests',
        });
      }

      if (status === 'approved' && (row.leave_type === 'casual' || row.leave_type === 'annual')) {
        const col = row.leave_type === 'casual' ? 'leave_casual_days' : 'leave_annual_days';
        const { rows: staffRows } = await client.query(
          `SELECT ${col} AS balance FROM staff_users WHERE id = $1 FOR UPDATE`,
          [row.staff_user_id]
        );
        const balance = Number(staffRows[0]?.balance) || 0;
        if (balance < Number(row.days)) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: `Not enough ${row.leave_type} balance to approve (${balance} left, ${row.days} needed)`,
          });
        }
        await client.query(
          `UPDATE staff_users SET ${col} = ${col} - $1, updated_at = now() WHERE id = $2`,
          [row.days, row.staff_user_id]
        );
      }

      if (status === 'approved' && row.leave_type === 'early_leave') {
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
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: `Early leave limit reached (maximum ${EARLY_LEAVE_MAX_PER_YEAR} per year)`,
          });
        }
      }

      const { rows } = await client.query(
        `UPDATE staff_leave_requests SET
           status = $1,
           reviewed_by = $2,
           reviewed_at = now(),
           review_note = $3
         WHERE id = $4
         RETURNING *`,
        [status, req.user.id, note, req.params.id]
      );
      await client.query('COMMIT');
      res.json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    next(e);
  }
});

async function listHrRequests(req, table) {
  const status = String(req.query.status || '').toLowerCase();
  const params = [];
  const where = [];
  if (req.query.mine === '1' || !isHrActor(req.user)) {
    params.push(req.user.id);
    where.push(`r.staff_user_id = $${params.length}`);
  }
  if (['pending', 'approved', 'rejected'].includes(status)) {
    params.push(status);
    where.push(`r.status = $${params.length}`);
  }
  const { rows } = await query(
    `SELECT r.*,
            u.full_name,
            u.role,
            u.staff_code,
            reviewer.full_name AS reviewed_by_name
     FROM ${table} r
     JOIN staff_users u ON u.id = r.staff_user_id
     LEFT JOIN staff_users reviewer ON reviewer.id = r.reviewed_by
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
     LIMIT 500`,
    params
  );
  return rows;
}

router.get('/hr/loans', async (req, res, next) => {
  try {
    if (req.user.role === 'owner') return res.status(403).json({ error: 'Forbidden' });
    res.json(await listHrRequests(req, 'staff_loan_requests'));
  } catch (e) {
    next(e);
  }
});

router.post('/hr/loans', async (req, res, next) => {
  try {
    if (req.user.role === 'owner') return res.status(403).json({ error: 'Forbidden' });
    const amount = parseFloat(req.body?.amount);
    const reason = String(req.body?.reason || '').trim();
    if (!(amount > 0) || !reason) {
      return res.status(400).json({ error: 'Amount and reason are required' });
    }
    let staffUserId = req.user.id;
    if (isHrActor(req.user) && req.body?.staff_user_id) {
      staffUserId = Number(req.body.staff_user_id);
      await loadStaffForHr(staffUserId);
    }
    const { rows } = await query(
      `INSERT INTO staff_loan_requests (staff_user_id, amount, reason, status)
       VALUES ($1,$2,$3,'pending')
       RETURNING *`,
      [staffUserId, amount, reason]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post('/hr/loans/:id/review', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const status = String(req.body?.status || '').toLowerCase();
    if (status !== 'approved' && status !== 'rejected') {
      return res.status(400).json({ error: 'Status must be approved or rejected' });
    }
    const note = req.body?.review_note ? String(req.body.review_note).slice(0, 500) : null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: existingRows } = await client.query(
        `SELECT * FROM staff_loan_requests WHERE id = $1 AND status = 'pending' FOR UPDATE`,
        [req.params.id]
      );
      const row = existingRows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Pending loan not found' });
      }

      let deductYear = null;
      let deductMonth = null;
      let deductionId = null;
      if (status === 'approved') {
        const staff = await loadStaffForHr(row.staff_user_id);
        const next = nextPayrollPeriod(cairoParts().date);
        deductYear = next.year;
        deductMonth = next.month;
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
        deductionId = inserted.id;
      }

      const { rows } = await client.query(
        `UPDATE staff_loan_requests SET
           status = $1,
           reviewed_by = $2,
           reviewed_at = now(),
           review_note = $3,
           deduct_year = $4,
           deduct_month = $5,
           deduction_id = $6
         WHERE id = $7
         RETURNING *`,
        [status, req.user.id, note, deductYear, deductMonth, deductionId, req.params.id]
      );
      await client.query('COMMIT');
      res.json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (e) {
    next(e);
  }
});

router.get('/hr/wfh', async (req, res, next) => {
  try {
    if (req.user.role === 'owner') return res.status(403).json({ error: 'Forbidden' });
    res.json(await listHrRequests(req, 'staff_wfh_requests'));
  } catch (e) {
    next(e);
  }
});

router.post('/hr/wfh', async (req, res, next) => {
  try {
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
    if (!hasOfficeAttendance(target.role)) {
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
    const { rows } = await query(
      `INSERT INTO staff_wfh_requests (staff_user_id, work_date, reason, status)
       VALUES ($1,$2::date,$3,'pending')
       RETURNING *`,
      [staffUserId, workDate, reason || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post('/hr/wfh/:id/review', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const status = String(req.body?.status || '').toLowerCase();
    if (status !== 'approved' && status !== 'rejected') {
      return res.status(400).json({ error: 'Status must be approved or rejected' });
    }
    const note = req.body?.review_note ? String(req.body.review_note).slice(0, 500) : null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: existingRows } = await client.query(
        `SELECT * FROM staff_wfh_requests WHERE id = $1 AND status = 'pending' FOR UPDATE`,
        [req.params.id]
      );
      const row = existingRows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Pending request not found' });
      }

      let deductionId = null;
      if (status === 'approved') {
        const staff = await loadStaffForHr(row.staff_user_id);
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
        deductionId = inserted.id;
      }

      const { rows } = await client.query(
        `UPDATE staff_wfh_requests SET
           status = $1,
           reviewed_by = $2,
           reviewed_at = now(),
           review_note = $3,
           deduction_id = $4
         WHERE id = $5
         RETURNING *`,
        [status, req.user.id, note, deductionId, req.params.id]
      );
      await client.query('COMMIT');
      res.json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
       WHERE role <> 'owner'
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

router.patch('/hr/holiday-access/:id', requireRoles(...HR_ROLES), async (req, res, next) => {
  try {
    const access = String(req.body?.holiday_access || '').toLowerCase();
    if (!['auto', 'granted', 'denied'].includes(access)) {
      return res.status(400).json({ error: 'holiday_access must be auto, granted, or denied' });
    }
    const staff = await loadStaffForHr(Number(req.params.id));
    assertHrNotEditingOwnCompensation(req.user, staff.id, 'holiday access');
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
      const byCode = new Map();
      const byName = new Map();
      for (const s of staffRows) {
        if (s.staff_code) byCode.set(normalizePersonId(s.staff_code).toLowerCase(), s);
        byName.set(String(s.full_name || '').trim().toLowerCase(), s);
      }

      if (isDoorPunchLog(punches)) {
        const workDates = [...new Set(parsed.map((p) => p.date).filter(Boolean))];
        const present = new Set(
          parsed.map((p) => `${normalizePersonId(p.staff_code).toLowerCase()}|${p.date}`)
        );
        for (const staff of staffRows) {
          if (!hasOfficeAttendance(staff.role) || !staff.staff_code) continue;
          const code = normalizePersonId(staff.staff_code).toLowerCase();
          for (const date of workDates) {
            if (!present.has(`${code}|${date}`)) {
              parsed.push({
                staff_code: staff.staff_code,
                name: staff.full_name,
                date,
                arrival_time: null,
                notified: false,
                absent: true,
              });
              present.add(`${code}|${date}`);
            }
          }
        }
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

      const { rows: existingRows } = await query(
        `SELECT staff_user_id, deduction_date::text AS deduction_date, category
         FROM staff_salary_deductions
         WHERE category IN ('lateness','absence')
           AND deduction_date >= $1::date AND deduction_date <= $2::date`,
        [minDate, maxDate]
      );
      const existing = new Set(
        existingRows.map((d) => `${d.staff_user_id}|${d.deduction_date}|${d.category}`)
      );

      const created = [];
      const skipped = [];
      const errors = [];

      for (const row of parsed) {
        if (!row.date) {
          errors.push({ row: row.row, error: 'Missing date' });
          continue;
        }
        const staff =
          (row.staff_code && byCode.get(normalizePersonId(row.staff_code).toLowerCase())) ||
          (row.name && byName.get(row.name.toLowerCase()));
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
          if (row.absent) {
            const key = `${staff.id}|${row.date}|absence`;
            if (existing.has(key)) {
              skipped.push({ row: row.row, staff_user_id: staff.id, reason: 'duplicate' });
              continue;
            }
            const computed = computeAbsenceDeduction(staff.base_salary, row.notified);
            const inserted = await insertDeduction(null, [
              staff.id,
              computed.amount,
              computed.label,
              row.date,
              'absence',
              req.user.id,
              null,
              computed.notified,
              computed.daily_rate,
              computed.factor,
            ]);
            existing.add(key);
            created.push(inserted);
          } else {
            const computed = computeLatenessDeduction(staff.base_salary, row.arrival_time);
            if (computed.factor <= 0) {
              skipped.push({ row: row.row, staff_user_id: staff.id, reason: 'on_time' });
              continue;
            }
            const key = `${staff.id}|${row.date}|lateness`;
            if (existing.has(key)) {
              skipped.push({ row: row.row, staff_user_id: staff.id, reason: 'duplicate' });
              continue;
            }
            const inserted = await insertDeduction(null, [
              staff.id,
              computed.amount,
              `Lateness at ${row.arrival_time} (${computed.label})`,
              row.date,
              'lateness',
              req.user.id,
              row.arrival_time,
              null,
              computed.daily_rate,
              computed.factor,
            ]);
            existing.add(key);
            created.push(inserted);
          }
        } catch (err) {
          errors.push({ row: row.row, error: err.message || 'Could not import row' });
        }
      }

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
