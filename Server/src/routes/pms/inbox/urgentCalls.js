const express = require('express');
const { query } = require('../../../config/db');
const { badRequest, int, notFound, wrap } = require('../../../lib/inbox/http');
const { normalizePhone } = require('../../../lib/inbox/http');
const { broadcast } = require('../../../lib/inbox/realtime');

// Urgent calls: customers waiting for a call back from a manager or the team.
const router = express.Router();

const STATUSES = ['open', 'called', 'done'];

const SELECT = `SELECT c.*, h.full_name AS handled_by_name, m.full_name AS created_by_name
  FROM urgent_calls c
  LEFT JOIN staff_users h ON h.id = c.handled_by
  LEFT JOIN staff_users m ON m.id = c.created_by`;

/** Everything still open or called, plus calls closed in the last 30 days: one request feeds every tab. */
router.get('/urgent-calls', wrap(async (req, res) => {
  const { rows } = await query(
    `${SELECT}
     WHERE c.status <> 'done' OR c.updated_at > now() - interval '30 days'
     ORDER BY c.created_at DESC
     LIMIT 500`
  );
  res.json({ items: rows });
}));

router.post('/urgent-calls', wrap(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 120);
  const phone = normalizePhone(b.phone);
  if (!name) throw badRequest('Enter the name');
  if (!phone) throw badRequest('Enter a valid phone number');
  const { rows } = await query(
    `INSERT INTO urgent_calls (name, phone, notes, source, created_by) VALUES ($1, $2, $3, 'staff', $4) RETURNING id`,
    [name, `+${phone}`, String(b.notes || '').trim().slice(0, 4000) || null, req.inbox.id]
  );
  const { rows: full } = await query(`${SELECT} WHERE c.id = $1`, [rows[0].id]);
  broadcast('urgent_call', { id: rows[0].id, by: req.inbox.id });
  res.status(201).json(full[0]);
}));

router.patch('/urgent-calls/:id', wrap(async (req, res) => {
  const id = int(req.params.id);
  const b = req.body || {};
  const { rows: found } = await query(`SELECT * FROM urgent_calls WHERE id = $1`, [id]);
  if (!found[0]) throw notFound('Call not found');
  const status = b.status !== undefined ? (STATUSES.includes(b.status) ? b.status : null) : found[0].status;
  if (!status) throw badRequest('Invalid status');
  const notes = b.notes !== undefined ? String(b.notes || '').trim().slice(0, 4000) || null : found[0].notes;
  const outcome = b.outcome !== undefined ? String(b.outcome || '').trim().slice(0, 2000) || null : found[0].outcome;
  const handled = status !== 'open' && found[0].status === 'open';
  const { rows } = await query(
    `UPDATE urgent_calls SET status = $2, notes = $3, outcome = $4,
       handled_by = CASE WHEN $5::boolean THEN $6 ELSE handled_by END,
       handled_at = CASE WHEN $5::boolean THEN now() ELSE handled_at END,
       updated_at = now()
     WHERE id = $1 RETURNING id`,
    [id, status, notes, outcome, handled, req.inbox.id]
  );
  const { rows: full } = await query(`${SELECT} WHERE c.id = $1`, [rows[0].id]);
  broadcast('urgent_call', { id, by: req.inbox.id });
  res.json(full[0]);
}));

module.exports = router;
