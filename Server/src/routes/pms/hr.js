const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');

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
         p.id AS payroll_id,
         p.base_salary::float AS paid_base_salary,
         p.deductions::float AS paid_deductions,
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
      const net = paid ? Number(r.paid_net_pay) : Math.max(0, base - deductions);
      return {
        staff_user_id: r.staff_user_id,
        full_name: r.full_name,
        role: r.role,
        staff_code: r.staff_code,
        is_active: r.is_active,
        base_salary: base,
        deductions,
        net_pay: net,
        live_deductions: Number(r.live_deductions) || 0,
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
        acc.deductions += s.deductions;
        acc.net += s.net_pay;
        if (s.status === 'paid') acc.paid += s.net_pay;
        else acc.unpaid += s.net_pay;
        return acc;
      },
      { base: 0, deductions: 0, net: 0, paid: 0, unpaid: 0 }
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
         COALESCE(d.deductions, 0)::float AS deductions
       FROM staff_users u
       LEFT JOIN (
         SELECT staff_user_id, SUM(amount)::float AS deductions
         FROM staff_salary_deductions
         WHERE deduction_date >= $1::date AND deduction_date < $2::date
         GROUP BY staff_user_id
       ) d ON d.staff_user_id = u.id
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
      const net = Math.max(0, base - deductions);
      const { rows } = await query(
        `INSERT INTO staff_payroll_entries (
           staff_user_id, period_year, period_month, base_salary, deductions, net_pay,
           status, paid_at, paid_by, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,'paid', now(), $7, $8)
         ON CONFLICT (staff_user_id, period_year, period_month)
         DO UPDATE SET
           base_salary = EXCLUDED.base_salary,
           deductions = EXCLUDED.deductions,
           net_pay = EXCLUDED.net_pay,
           status = 'paid',
           paid_at = now(),
           paid_by = EXCLUDED.paid_by,
           notes = COALESCE(EXCLUDED.notes, staff_payroll_entries.notes)
         RETURNING *`,
        [row.id, year, month, base, deductions, net, req.user.id, notes]
      );
      paid.push(rows[0]);
    }

    res.json({ ok: true, year, month, count: paid.length, entries: paid });
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
    const amount = parseFloat(b.amount);
    const reason = String(b.reason || '').trim();
    const deductionDate = String(b.deduction_date || '').slice(0, 10);
    const category = String(b.category || 'other').trim() || 'other';
    const allowed = new Set(['delay', 'performance', 'advance', 'absence', 'other']);
    if (!staffUserId || Number.isNaN(amount) || amount <= 0 || !reason || !deductionDate) {
      return res.status(400).json({ error: 'Staff, amount, reason, and date are required' });
    }
    if (!allowed.has(category)) {
      return res.status(400).json({ error: 'Invalid deduction category' });
    }
    const { rows: staff } = await query(
      `SELECT id, role FROM staff_users WHERE id = $1`,
      [staffUserId]
    );
    if (!staff[0] || staff[0].role === 'owner') {
      return res.status(404).json({ error: 'Staff member not found' });
    }
    const { rows } = await query(
      `INSERT INTO staff_salary_deductions
         (staff_user_id, amount, reason, deduction_date, category, created_by)
       VALUES ($1,$2,$3,$4::date,$5,$6)
       RETURNING *`,
      [staffUserId, amount, reason, deductionDate, category, req.user.id]
    );
    res.status(201).json(rows[0]);
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
    const leaveType = String(b.leave_type || 'holiday').trim() || 'holiday';
    const start = String(b.start_date || '').slice(0, 10);
    const end = String(b.end_date || '').slice(0, 10);
    const reason = String(b.reason || '').trim();
    const allowed = new Set(['holiday', 'day_off', 'sick']);
    if (!allowed.has(leaveType)) {
      return res.status(400).json({ error: 'Invalid leave type' });
    }
    const days = inclusiveDays(start, end);
    if (!start || !end || !Number.isFinite(days) || days < 1) {
      return res.status(400).json({ error: 'Valid start and end dates are required' });
    }
    let staffUserId = req.user.id;
    if (isHrActor(req.user) && b.staff_user_id) {
      staffUserId = Number(b.staff_user_id);
    }
    if (req.user.role === 'owner') {
      return res.status(403).json({ error: 'Owner accounts cannot request staff holidays' });
    }
    const { rows } = await query(
      `INSERT INTO staff_leave_requests
         (staff_user_id, leave_type, start_date, end_date, days, reason, status)
       VALUES ($1,$2,$3::date,$4::date,$5,$6,'pending')
       RETURNING *`,
      [staffUserId, leaveType, start, end, days, reason || null]
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
    const { rows } = await query(
      `UPDATE staff_leave_requests SET
         status = $1,
         reviewed_by = $2,
         reviewed_at = now(),
         review_note = $3
       WHERE id = $4 AND status = 'pending'
       RETURNING *`,
      [status, req.user.id, note, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Pending request not found' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
