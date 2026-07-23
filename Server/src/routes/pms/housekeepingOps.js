const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { logAudit } = require('../../lib/audit');
const { DEFAULT_CHECKLIST } = require('../../jobs/housekeepingTasks');

const router = express.Router();

router.get('/housekeeping-tasks', async (req, res, next) => {
  try {
    const status = req.query.status;
    const params = [];
    let where = '1=1';
    if (status) {
      params.push(status);
      where += ` AND t.status = $${params.length}`;
    }
    if (req.query.unit_id) {
      params.push(req.query.unit_id);
      where += ` AND t.unit_id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT t.*,
              COALESCE(u.title, u.unit_number, 'Unit') AS unit_name,
              u.unit_number,
              u.id AS unit_uuid,
              COALESCE(u.project, u.compound) AS project,
              u.ops_status,
              r.check_in, r.check_out,
              r.guest_name AS guest_name_internal,
              COALESCE(r.guest_phone, b.guest_phone) AS guest_phone,
              COALESCE(t.source, 'pre_arrival') AS source,
              t.requested_time
       FROM housekeeping_tasks t
       JOIN units u ON u.id = t.unit_id
       LEFT JOIN reservations r ON r.id = t.reservation_id
       LEFT JOIN bookings b ON b.id = t.booking_id
       WHERE ${where}
       ORDER BY COALESCE(t.due_at, t.created_at) ASC
       LIMIT 200`,
      params
    );
    // Staff ops see guest name for check-in context; strip in owner portal elsewhere
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/housekeeping-tasks', requireRoles('admin', 'reservations'), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.unit_id) return res.status(400).json({ error: 'unit_id required' });
    const { rows } = await query(
      `INSERT INTO housekeeping_tasks (
         reservation_id, unit_id, assigned_to, status, checklist, due_at, notes
       ) VALUES ($1,$2,$3,COALESCE($4,'pending'),COALESCE($5::jsonb, $6::jsonb),$7,$8)
       RETURNING *`,
      [
        b.reservation_id || null,
        b.unit_id,
        b.assigned_to || null,
        b.status,
        b.checklist ? JSON.stringify(b.checklist) : null,
        JSON.stringify(DEFAULT_CHECKLIST),
        b.due_at || null,
        b.notes || null,
      ]
    );
    await logAudit({
      userId: req.user.id,
      action: 'CREATE_HOUSEKEEPING_TASK',
      entityType: 'housekeeping_task',
      entityId: rows[0].id,
      details: { unit_id: b.unit_id, reservation_id: b.reservation_id },
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.patch('/housekeeping-tasks/:id', async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await query(
      `UPDATE housekeeping_tasks SET
         status = COALESCE($1, status),
         assigned_to = COALESCE($2, assigned_to),
         checklist = COALESCE($3::jsonb, checklist),
         before_photo_urls = COALESCE($4::text[], before_photo_urls),
         after_photo_urls = COALESCE($5::text[], after_photo_urls),
         notes = COALESCE($6, notes),
         arrive_lat = COALESCE($7, arrive_lat),
         arrive_lng = COALESCE($8, arrive_lng),
         accepted_at = CASE WHEN $1 = 'accepted' THEN COALESCE(accepted_at, now()) ELSE accepted_at END,
         started_at = CASE WHEN $1 = 'in_progress' THEN COALESCE(started_at, now()) ELSE started_at END,
         updated_at = now()
       WHERE id = $9
       RETURNING *`,
      [
        b.status || null,
        b.assigned_to ?? null,
        b.checklist != null ? JSON.stringify(b.checklist) : null,
        Array.isArray(b.before_photo_urls) ? b.before_photo_urls : null,
        Array.isArray(b.after_photo_urls) ? b.after_photo_urls : null,
        b.notes ?? null,
        b.arrive_lat ?? null,
        b.arrive_lng ?? null,
        req.params.id,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post('/housekeeping-tasks/:id/submit', async (req, res, next) => {
  try {
    const b = req.body || {};
    const { rows } = await query(
      `UPDATE housekeeping_tasks SET
         status = 'submitted',
         after_photo_urls = COALESCE($1::text[], after_photo_urls),
         checklist = COALESCE($2::jsonb, checklist),
         submitted_at = now(),
         updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [
        Array.isArray(b.after_photo_urls) ? b.after_photo_urls : null,
        b.checklist != null ? JSON.stringify(b.checklist) : null,
        req.params.id,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    await logAudit({
      userId: req.user.id,
      action: 'SUBMIT_HOUSEKEEPING_TASK',
      entityType: 'housekeeping_task',
      entityId: rows[0].id,
    });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post('/housekeeping-tasks/:id/inspect', requireRoles('admin', 'reservations'), async (req, res, next) => {
  try {
    const result = String(req.body.result || '').toLowerCase();
    if (!['pass', 'fail'].includes(result)) {
      return res.status(400).json({ error: 'result must be pass or fail' });
    }
    const { rows: tasks } = await query(`SELECT * FROM housekeeping_tasks WHERE id = $1`, [
      req.params.id,
    ]);
    if (!tasks[0]) return res.status(404).json({ error: 'Not found' });

    await query(
      `INSERT INTO housekeeping_inspections (task_id, result, notes, inspector_id)
       VALUES ($1, $2, $3, $4)`,
      [req.params.id, result, req.body.notes || null, req.user.id]
    );

    const nextStatus = result === 'pass' ? 'ready' : 'needs_reclean';
    const { rows } = await query(
      `UPDATE housekeeping_tasks SET
         status = $1,
         ready_at = CASE WHEN $1 = 'ready' THEN now() ELSE ready_at END,
         updated_at = now()
       WHERE id = $2
       RETURNING *`,
      [nextStatus, req.params.id]
    );

    if (result === 'pass') {
      await query(
        `UPDATE units SET ops_status = 'available', updated_at = now() WHERE id = $1`,
        [tasks[0].unit_id]
      );
    } else {
      await query(
        `UPDATE units SET ops_status = 'maintenance', updated_at = now() WHERE id = $1`,
        [tasks[0].unit_id]
      );
    }

    await logAudit({
      userId: req.user.id,
      action: 'INSPECT_HOUSEKEEPING_TASK',
      entityType: 'housekeeping_task',
      entityId: rows[0].id,
      details: { result, nextStatus },
    });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
