const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { logAudit } = require('../../lib/audit');
const {
  upload,
  attachCloudinaryUrls,
  setCloudinaryFolder,
  FOLDER_INSPECTIONS,
} = require('../../config/cloudinary');

const router = express.Router();

const OPS_AGENT = 'operations';
const OPS_SUPER = 'operations_supervisor';
const OPS_ROLES = ['admin', OPS_AGENT, OPS_SUPER];

function isSupervisor(user) {
  return user?.role === 'admin' || user?.role === OPS_SUPER;
}

function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function dateRange(q) {
  const today = cairoToday();
  const monthStart = `${today.slice(0, 8)}01`;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(q.from || '')) ? q.from : monthStart;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(q.to || '')) ? q.to : today;
  return { from, to };
}

/** Clock in / out with a camera photo (mandatory). */
router.post(
  '/ops/attendance',
  requireRoles(OPS_AGENT, OPS_SUPER),
  upload.single('photo'),
  setCloudinaryFolder(FOLDER_INSPECTIONS),
  attachCloudinaryUrls,
  async (req, res, next) => {
    try {
      const photoUrl = req.file ? req.file.secure_url || req.file.path || null : null;
      if (!photoUrl) return res.status(400).json({ error: 'Take a photo to record attendance' });
      const kind = String(req.body?.kind || 'in').toLowerCase() === 'out' ? 'out' : 'in';
      const lat = Number(req.body?.lat);
      const lng = Number(req.body?.lng);
      const { rows } = await query(
        `INSERT INTO ops_attendance (staff_id, kind, photo_url, lat, lng)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.user.id, kind, photoUrl, Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null]
      );
      await logAudit({
        userId: req.user.id,
        action: kind === 'in' ? 'OPS_CLOCK_IN' : 'OPS_CLOCK_OUT',
        entityType: 'ops_attendance',
        entityId: rows[0].id,
      });
      res.status(201).json(rows[0]);
    } catch (e) {
      next(e);
    }
  }
);

router.get('/ops/attendance', requireRoles(...OPS_ROLES), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req.query);
    const params = [from, to];
    let scope = '';
    if (!isSupervisor(req.user)) {
      params.push(req.user.id);
      scope = ` AND a.staff_id = $${params.length}`;
    } else if (req.query.staff_id) {
      params.push(Number(req.query.staff_id));
      scope = ` AND a.staff_id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT a.*, s.full_name AS staff_name, s.staff_code
       FROM ops_attendance a
       JOIN staff_users s ON s.id = a.staff_id
       WHERE (a.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1::date AND $2::date
         ${scope}
       ORDER BY a.created_at DESC
       LIMIT 1000`,
      params
    );
    res.json({ from, to, items: rows });
  } catch (e) {
    next(e);
  }
});

/** Agent performance: check-ins, checkouts, cleans, tasks and attendance in a date range. */
router.get('/ops/performance', requireRoles(...OPS_ROLES), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req.query);
    const params = [from, to];
    let agentFilter = '';
    if (!isSupervisor(req.user)) {
      params.push(req.user.id);
      agentFilter = ` AND s.id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT s.id, s.full_name, s.staff_code,
         (SELECT COUNT(*)::int FROM reservations r
           WHERE r.ops_assigned_to = s.id AND r.check_in::date BETWEEN $1::date AND $2::date
             AND r.status IS DISTINCT FROM 'cancelled') AS checkins_assigned,
         (SELECT COUNT(*)::int FROM reservations r
           WHERE r.ops_handed_over_by = s.id
             AND (r.ops_handed_over_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1::date AND $2::date) AS checkins_done,
         (SELECT COALESCE(SUM(p.amount), 0)::float FROM payments p
           WHERE p.created_by = s.id AND p.notes LIKE '[ops check-in]%'
             AND (p.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1::date AND $2::date) AS collected,
         (SELECT COUNT(*)::int FROM reservations r
           WHERE COALESCE(r.ops_checkout_assigned_to, r.ops_assigned_to) = s.id
             AND r.check_out::date BETWEEN $1::date AND $2::date
             AND r.status IS DISTINCT FROM 'cancelled') AS checkouts_assigned,
         (SELECT COUNT(*)::int FROM reservations r
           WHERE r.insurance_refunded_by = s.id
             AND (r.insurance_refunded_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1::date AND $2::date) AS checkouts_done,
         (SELECT COUNT(*)::int FROM housekeeping_tasks t
           WHERE t.assigned_to = s.id AND t.status = 'ready'
             AND (t.ready_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1::date AND $2::date) AS cleans_done,
         (SELECT COUNT(*)::int FROM staff_tasks k
           WHERE k.assignee_id = s.id AND k.deadline BETWEEN $1::date AND $2::date) AS tasks_due,
         (SELECT COUNT(*)::int FROM staff_tasks k
           WHERE k.assignee_id = s.id AND k.completed_at IS NOT NULL
             AND (k.completed_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1::date AND $2::date) AS tasks_done,
         (SELECT COUNT(*)::int FROM staff_tasks k
           WHERE k.assignee_id = s.id AND k.completed_at IS NOT NULL
             AND (k.completed_at AT TIME ZONE 'Africa/Cairo')::date > k.deadline
             AND (k.completed_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1::date AND $2::date) AS tasks_late,
         (SELECT COUNT(*)::int FROM staff_tasks k
           WHERE k.assignee_id = s.id AND k.completed_at IS NULL
             AND k.deadline < (timezone('Africa/Cairo', now()))::date) AS tasks_overdue,
         (SELECT COUNT(DISTINCT (a.created_at AT TIME ZONE 'Africa/Cairo')::date)::int FROM ops_attendance a
           WHERE a.staff_id = s.id AND a.kind = 'in'
             AND (a.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1::date AND $2::date) AS attendance_days,
         (SELECT COUNT(*)::int FROM ops_assignment_log l
           WHERE l.from_staff_id = s.id AND l.to_staff_id IS DISTINCT FROM s.id
             AND (l.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1::date AND $2::date) AS reassigned_away
       FROM staff_users s
       WHERE s.role = '${OPS_AGENT}' AND s.is_active = 1 ${agentFilter}
       ORDER BY s.full_name ASC NULLS LAST`,
      params
    );
    res.json({ from, to, items: rows });
  } catch (e) {
    next(e);
  }
});

/** One agent's activity log (check-ins, checkouts, cleans, tasks, attendance). */
router.get('/ops/performance/:staffId/history', requireRoles(...OPS_ROLES), async (req, res, next) => {
  try {
    const staffId = Number(req.params.staffId);
    if (!isSupervisor(req.user) && staffId !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { from, to } = dateRange(req.query);
    const { rows } = await query(
      `SELECT * FROM (
         SELECT 'checkin' AS kind, r.ops_handed_over_at AS at, r.id AS ref_id,
                concat_ws(' · ', COALESCE(u.unit_number, u.title), r.guest_name) AS label, NULL::text AS photo_url
         FROM reservations r JOIN units u ON u.id = r.unit_id
         WHERE r.ops_handed_over_by = $1
           AND (r.ops_handed_over_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $2::date AND $3::date
         UNION ALL
         SELECT 'checkout', r.insurance_refunded_at::timestamptz, r.id,
                concat_ws(' · ', COALESCE(u.unit_number, u.title), r.guest_name, 'insurance ' || r.insurance_refund_status), NULL
         FROM reservations r JOIN units u ON u.id = r.unit_id
         WHERE r.insurance_refunded_by = $1
           AND (r.insurance_refunded_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $2::date AND $3::date
         UNION ALL
         SELECT 'clean', t.ready_at, t.id, COALESCE(u.unit_number, u.title), NULL
         FROM housekeeping_tasks t JOIN units u ON u.id = t.unit_id
         WHERE t.assigned_to = $1 AND t.status = 'ready'
           AND (t.ready_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $2::date AND $3::date
         UNION ALL
         SELECT 'task', k.completed_at, k.id, k.title, k.completion_photo_url
         FROM staff_tasks k
         WHERE k.assignee_id = $1 AND k.completed_at IS NOT NULL
           AND (k.completed_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $2::date AND $3::date
         UNION ALL
         SELECT 'attendance_' || a.kind, a.created_at, a.id, NULL, a.photo_url
         FROM ops_attendance a
         WHERE a.staff_id = $1
           AND (a.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $2::date AND $3::date
       ) x
       ORDER BY at DESC NULLS LAST
       LIMIT 500`,
      [staffId, from, to]
    );
    res.json({ from, to, items: rows });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
