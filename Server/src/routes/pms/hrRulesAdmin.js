const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { refreshDeductionRules } = require('../../lib/hrRules');

const router = express.Router();

router.get('/hr/deduction-rules', requireRoles('admin', 'hr', 'hr_supervisor'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, rule_key, kind, label, factor, end_minutes, active, sort_order
       FROM hr_deduction_rules
       ORDER BY sort_order, id`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.put('/hr/deduction-rules/:id', requireRoles('admin', 'hr', 'hr_supervisor'), async (req, res, next) => {
  try {
    const factor = Number(req.body?.factor);
    const label = String(req.body?.label || '').trim().slice(0, 120);
    if (!label) return res.status(400).json({ error: 'Name the rule' });
    if (!Number.isFinite(factor) || factor < 0 || factor > 10) {
      return res.status(400).json({ error: 'The multiplier must be between 0 and 10' });
    }
    const endMinutes = req.body?.end_minutes == null || req.body.end_minutes === ''
      ? null
      : Number(req.body.end_minutes);
    const { rows } = await query(
      `UPDATE hr_deduction_rules
       SET label = $2, factor = $3, end_minutes = $4, active = COALESCE($5, active)
       WHERE id = $1
       RETURNING id, rule_key, kind, label, factor, end_minutes, active, sort_order`,
      [Number(req.params.id), label, factor, Number.isFinite(endMinutes) ? endMinutes : null, req.body?.active]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Rule not found' });
    await refreshDeductionRules();
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post('/hr/deduction-rules', requireRoles('admin', 'hr', 'hr_supervisor'), async (req, res, next) => {
  try {
    const label = String(req.body?.label || '').trim().slice(0, 120);
    const factor = Number(req.body?.factor);
    if (label.length < 2) return res.status(400).json({ error: 'Name the rule' });
    if (!Number.isFinite(factor) || factor < 0 || factor > 10) {
      return res.status(400).json({ error: 'The multiplier must be between 0 and 10' });
    }
    const key = `custom_${Date.now()}`;
    const { rows } = await query(
      `INSERT INTO hr_deduction_rules (rule_key, kind, label, factor, sort_order)
       VALUES ($1, 'custom', $2, $3, 100)
       RETURNING id, rule_key, kind, label, factor, end_minutes, active, sort_order`,
      [key, label, factor]
    );
    await refreshDeductionRules();
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
