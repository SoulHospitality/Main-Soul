const express = require('express');
const { query, pool } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { refreshDeductionRules, payrollCycleBounds, payrollCycleForDate } = require('../../lib/hrRules');
const {
  TRIGGERS,
  AMOUNT_TYPES,
  LEAVE_TYPES,
  sanitizeRule,
  applyPayrollRules,
  previewPayrollRules,
} = require('../../lib/hrPayrollRules');
const { logAudit } = require('../../lib/audit');

const router = express.Router();
const HR_RULE_ROLES = ['admin', 'hr', 'hr_supervisor'];

const BAND_FIELDS = 'id, rule_key, kind, label, factor, start_minutes, end_minutes, penalty_type, active, sort_order';

function cairoTodayIso() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

/** Pay cycle from ?year&month (or the body), defaulting to the cycle that contains today. */
function cycleFrom(source = {}) {
  const year = Number(source.year);
  const month = Number(source.month);
  if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
    return payrollCycleBounds(year, month);
  }
  return payrollCycleForDate(cairoTodayIso());
}

/** Rules are applied straight away to the open cycle, so payroll always reflects the latest rules. */
async function applyCurrentCycle() {
  const cycle = payrollCycleForDate(cairoTodayIso());
  try {
    return await applyPayrollRules({ pool, query, ...cycle });
  } catch (err) {
    console.error('[hr-rules] apply failed', err.message);
    return null;
  }
}

// ── Attendance basics: lateness bands, no-show and unpaid leave multipliers ──

router.get('/hr/deduction-rules', requireRoles(...HR_RULE_ROLES), async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT ${BAND_FIELDS} FROM hr_deduction_rules ORDER BY sort_order, id`);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

function parsePenaltyType(value) {
  return value === 'amount' ? 'amount' : 'days';
}

/** Days of pay: 0–10 days. Fixed amount: 0–100,000 EGP. */
function parseFactor(value, penaltyType = 'days') {
  const factor = Number(value);
  const max = penaltyType === 'amount' ? 100000 : 10;
  if (!Number.isFinite(factor) || factor < 0 || factor > max) {
    throw Object.assign(
      new Error(penaltyType === 'amount' ? 'The penalty must be between 0 and 100,000 EGP' : 'The penalty must be between 0 and 10 days of pay'),
      { status: 400 }
    );
  }
  return factor;
}

/** Start is required for a band; the end can be empty (= until the end of the shift). */
function parseBandWindow(body) {
  const start = parseEndMinutes(body?.start_minutes);
  const end = parseEndMinutes(body?.end_minutes);
  if (start == null) throw Object.assign(new Error('Set when this lateness starts'), { status: 400 });
  if (end != null && end < start) throw Object.assign(new Error('The end must be after the start'), { status: 400 });
  return { start, end };
}

function parseEndMinutes(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value)) {
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 1440) {
    throw Object.assign(new Error('The time must be HH:MM'), { status: 400 });
  }
  return n;
}

router.put('/hr/deduction-rules/:id', requireRoles(...HR_RULE_ROLES), async (req, res, next) => {
  try {
    const label = String(req.body?.label || '').trim().slice(0, 120);
    if (!label) return res.status(400).json({ error: 'Name the rule' });
    const penaltyType = parsePenaltyType(req.body?.penalty_type);
    const factor = parseFactor(req.body?.factor, penaltyType);
    const { rows: before } = await query(`SELECT ${BAND_FIELDS} FROM hr_deduction_rules WHERE id = $1`, [Number(req.params.id)]);
    if (!before[0]) return res.status(404).json({ error: 'Rule not found' });
    const lateness = before[0].kind === 'lateness';
    const window = lateness ? parseBandWindow(req.body) : { start: before[0].start_minutes, end: before[0].end_minutes };
    const { rows } = await query(
      `UPDATE hr_deduction_rules
       SET label = $2, factor = $3, start_minutes = $4, end_minutes = $5, penalty_type = $6, active = COALESCE($7, active),
           sort_order = CASE WHEN kind = 'lateness' THEN $4 ELSE sort_order END
       WHERE id = $1
       RETURNING ${BAND_FIELDS}`,
      [Number(req.params.id), label, factor, window.start, window.end, penaltyType, req.body?.active]
    );
    await refreshDeductionRules();
    await logAudit({
      userId: req.user.id,
      action: 'UPDATE_HR_RULE',
      entityType: 'hr_deduction_rule',
      entityId: req.params.id,
      details: { name: label, before: before[0], after: rows[0] },
    });
    res.json(rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/** Adds a lateness band: arrivals from start to end (or the end of the shift) get this penalty. */
router.post('/hr/deduction-rules', requireRoles(...HR_RULE_ROLES), async (req, res, next) => {
  try {
    const label = String(req.body?.label || '').trim().slice(0, 120);
    if (label.length < 2) return res.status(400).json({ error: 'Name the band' });
    const penaltyType = parsePenaltyType(req.body?.penalty_type);
    const factor = parseFactor(req.body?.factor, penaltyType);
    const window = parseBandWindow(req.body);
    const { rows } = await query(
      `INSERT INTO hr_deduction_rules (rule_key, kind, label, factor, start_minutes, end_minutes, penalty_type, sort_order)
       VALUES ($1, 'lateness', $2, $3, $4, $5, $6, $4)
       RETURNING ${BAND_FIELDS}`,
      [`lateness_${Date.now()}`, label, factor, window.start, window.end, penaltyType]
    );
    await refreshDeductionRules();
    await logAudit({ userId: req.user.id, action: 'CREATE_HR_RULE', entityType: 'hr_deduction_rule', entityId: rows[0].id, details: { name: label, after: rows[0] } });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.delete('/hr/deduction-rules/:id', requireRoles(...HR_RULE_ROLES), async (req, res, next) => {
  try {
    const { rows: before } = await query(`SELECT ${BAND_FIELDS} FROM hr_deduction_rules WHERE id = $1`, [Number(req.params.id)]);
    const band = before[0];
    if (!band) return res.status(404).json({ error: 'Rule not found' });
    if (band.kind !== 'lateness') return res.status(400).json({ error: 'Only lateness bands can be removed' });
    const { rows: count } = await query(`SELECT count(*)::int AS n FROM hr_deduction_rules WHERE kind = 'lateness'`);
    if (count[0].n <= 1) return res.status(400).json({ error: 'Keep at least one lateness band' });
    await query(`DELETE FROM hr_deduction_rules WHERE id = $1`, [band.id]);
    await refreshDeductionRules();
    await logAudit({ userId: req.user.id, action: 'DELETE_HR_RULE', entityType: 'hr_deduction_rule', entityId: band.id, details: { name: band.label, before: band } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Payroll rules (any rule HR builds) ──

const RULE_FIELDS = `id, name, effect, trigger, params, amount_type, amount::float AS amount, roles, staff_ids,
  free_count, cap_amount::float AS cap_amount, effective_from::text AS effective_from,
  effective_to::text AS effective_to, active, notes, sort_order, created_at, updated_at`;

router.get('/hr/payroll-rules', requireRoles(...HR_RULE_ROLES), async (_req, res, next) => {
  try {
    const cycle = payrollCycleForDate(cairoTodayIso());
    const [{ rows: rules }, { rows: staff }, { rows: totals }] = await Promise.all([
      query(`SELECT ${RULE_FIELDS} FROM hr_payroll_rules ORDER BY active DESC, sort_order, id`),
      query(
        `SELECT id, full_name, role FROM staff_users
         WHERE is_active = 1 AND role NOT IN ('owner', 'admin') ORDER BY full_name`
      ),
      query(
        `SELECT rule_id, 'deduction' AS effect, count(*)::int AS people, sum(amount)::float AS total
         FROM staff_salary_deductions WHERE rule_period = $1 AND rule_id IS NOT NULL GROUP BY rule_id
         UNION ALL
         SELECT rule_id, 'bonus', count(*)::int, sum(amount)::float
         FROM staff_salary_bonuses WHERE rule_period = $1 AND rule_id IS NOT NULL GROUP BY rule_id`,
        [`${cycle.year}-${String(cycle.month).padStart(2, '0')}`]
      ),
    ]);
    const byRule = Object.fromEntries(totals.map((t) => [t.rule_id, { people: t.people, total: t.total }]));
    res.json({
      rules: rules.map((r) => ({ ...r, this_cycle: byRule[r.id] || { people: 0, total: 0 } })),
      cycle,
      catalog: {
        triggers: Object.entries(TRIGGERS).map(([key, t]) => ({ key, ...t })),
        amount_types: AMOUNT_TYPES,
        leave_types: LEAVE_TYPES,
      },
      staff,
    });
  } catch (err) {
    next(err);
  }
});

async function saveRule(req, res, next, id = null) {
  try {
    const rule = sanitizeRule(req.body || {});
    let before = null;
    if (id) {
      const { rows } = await query(`SELECT ${RULE_FIELDS} FROM hr_payroll_rules WHERE id = $1`, [id]);
      before = rows[0];
      if (!before) return res.status(404).json({ error: 'Rule not found' });
    }
    const values = [
      rule.name, rule.effect, rule.trigger, JSON.stringify(rule.params), rule.amount_type, rule.amount,
      rule.roles, rule.staff_ids, rule.free_count, rule.cap_amount, rule.effective_from, rule.effective_to,
      rule.active, rule.notes,
    ];
    const { rows } = id
      ? await query(
          `UPDATE hr_payroll_rules SET
             name = $1, effect = $2, trigger = $3, params = $4::jsonb, amount_type = $5, amount = $6,
             roles = $7::text[], staff_ids = $8::int[], free_count = $9, cap_amount = $10,
             effective_from = $11::date, effective_to = $12::date, active = $13, notes = $14, updated_at = now()
           WHERE id = $15 RETURNING ${RULE_FIELDS}`,
          [...values, id]
        )
      : await query(
          `INSERT INTO hr_payroll_rules
             (name, effect, trigger, params, amount_type, amount, roles, staff_ids, free_count, cap_amount,
              effective_from, effective_to, active, notes, created_by)
           VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::text[],$8::int[],$9,$10,$11::date,$12::date,$13,$14,$15)
           RETURNING ${RULE_FIELDS}`,
          [...values, req.user.id]
        );
    const applied = await applyCurrentCycle();
    await logAudit({
      userId: req.user.id,
      action: id ? 'UPDATE_HR_RULE' : 'CREATE_HR_RULE',
      entityType: 'hr_payroll_rule',
      entityId: rows[0].id,
      details: { name: rule.name, before, after: rows[0] },
    });
    res.status(id ? 200 : 201).json({ rule: rows[0], applied: applied ? applied.results.filter((r) => r.rule_id === rows[0].id).length : null });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

router.post('/hr/payroll-rules', requireRoles(...HR_RULE_ROLES), (req, res, next) => saveRule(req, res, next));
router.put('/hr/payroll-rules/:id', requireRoles(...HR_RULE_ROLES), (req, res, next) => saveRule(req, res, next, Number(req.params.id)));

router.delete('/hr/payroll-rules/:id', requireRoles(...HR_RULE_ROLES), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await query(`SELECT ${RULE_FIELDS} FROM hr_payroll_rules WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Rule not found' });
    // Remove what the rule added to unpaid payrolls; paid payslips keep their history.
    const unpaid = `NOT EXISTS (
      SELECT 1 FROM staff_payroll_entries p
      WHERE p.staff_user_id = t.staff_user_id AND p.status = 'paid'
        AND to_char(make_date(p.period_year, p.period_month, 1), 'YYYY-MM') = t.rule_period)`;
    await query(`DELETE FROM staff_salary_deductions t WHERE t.rule_id = $1 AND ${unpaid}`, [id]);
    await query(`DELETE FROM staff_salary_bonuses t WHERE t.rule_id = $1 AND ${unpaid}`, [id]);
    await query(`DELETE FROM hr_payroll_rules WHERE id = $1`, [id]);
    await logAudit({ userId: req.user.id, action: 'DELETE_HR_RULE', entityType: 'hr_payroll_rule', entityId: id, details: { name: rows[0].name, before: rows[0] } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** Dry run: who a rule (saved or still being edited) would affect in a cycle, and by how much. */
router.post('/hr/payroll-rules/preview', requireRoles(...HR_RULE_ROLES), async (req, res, next) => {
  try {
    const cycle = cycleFrom(req.body || {});
    const draft = req.body?.rule ? { ...sanitizeRule(req.body.rule), id: Number(req.body.rule.id) || 0 } : null;
    const results = await previewPayrollRules({ query, from: cycle.from, through: cycle.through, ruleOverride: draft });
    const total = results.reduce((acc, r) => acc + r.amount * (r.effect === 'bonus' ? 1 : -1), 0);
    res.json({ cycle, results, total: Math.round(total * 100) / 100 });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/** Re-applies every active rule to one cycle's unpaid payrolls. */
router.post('/hr/payroll-rules/apply', requireRoles(...HR_RULE_ROLES), async (req, res, next) => {
  try {
    const cycle = cycleFrom(req.body || {});
    const result = await applyPayrollRules({ pool, query, ...cycle });
    await logAudit({
      userId: req.user.id,
      action: 'APPLY_HR_RULES',
      entityType: 'payroll_cycle',
      entityId: result.period,
      details: { entries: result.results.length, skipped_paid: result.skipped_paid },
    });
    res.json({ cycle, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
