const express = require('express');
const { query } = require('../../config/db');
const { TASK_ASSIGNEE_ROLES, isTaskAssigneeRole } = require('../../lib/staffTasks');
const { sendStaffTaskAssignedEmail } = require('../../services/staffTaskEmails');
const { logAudit } = require('../../lib/audit');

const router = express.Router();

const TASK_SELECT = `
  t.id,
  t.assignee_id,
  t.created_by,
  t.title,
  t.description,
  t.deadline::text AS deadline,
  t.created_at,
  a.full_name AS assignee_name,
  a.role AS assignee_role,
  a.email AS assignee_email,
  m.full_name AS created_by_name
`;

function isoDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

router.get('/staff-tasks/assignees', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, full_name, role, email
       FROM staff_users
       WHERE is_active = 1
         AND manager_id = $1
         AND role = ANY($2::text[])
       ORDER BY full_name`,
      [req.user.id, TASK_ASSIGNEE_ROLES]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get('/staff-tasks', async (req, res, next) => {
  try {
    const me = req.user.id;
    const sql = isTaskAssigneeRole(req.user)
      ? `SELECT ${TASK_SELECT}
         FROM staff_tasks t
         JOIN staff_users a ON a.id = t.assignee_id
         JOIN staff_users m ON m.id = t.created_by
         WHERE t.assignee_id = $1
         ORDER BY t.deadline ASC, t.created_at DESC`
      : `SELECT ${TASK_SELECT}
         FROM staff_tasks t
         JOIN staff_users a ON a.id = t.assignee_id
         JOIN staff_users m ON m.id = t.created_by
         WHERE a.manager_id = $1
         ORDER BY t.deadline ASC, t.created_at DESC`;
    const { rows } = await query(sql, [me]);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/staff-tasks', async (req, res, next) => {
  try {
    const b = req.body || {};
    const title = String(b.title || '').trim();
    const description = String(b.description || '').trim();
    const deadline = isoDate(b.deadline);
    const assigneeId = Number(b.assignee_id);
    if (!title) return res.status(400).json({ error: 'Title is required' });
    if (!deadline) return res.status(400).json({ error: 'Deadline is required' });
    if (!Number.isFinite(assigneeId) || assigneeId < 1) {
      return res.status(400).json({ error: 'Choose who this task is for' });
    }

    const { rows: assignees } = await query(
      `SELECT id, full_name, email, role, manager_id, is_active
       FROM staff_users WHERE id = $1`,
      [assigneeId]
    );
    const assignee = assignees[0];
    if (!assignee || !Number(assignee.is_active)) {
      return res.status(404).json({ error: 'Staff member not found' });
    }
    if (!isTaskAssigneeRole(assignee.role)) {
      return res.status(403).json({ error: 'Tasks can only be assigned to Marketing and PR or Web Developer' });
    }
    if (String(assignee.manager_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Only this person\'s direct manager can add a task' });
    }

    const { rows } = await query(
      `INSERT INTO staff_tasks (assignee_id, created_by, title, description, deadline)
       VALUES ($1, $2, $3, $4, $5::date)
       RETURNING id, assignee_id, created_by, title, description, deadline::text AS deadline, created_at`,
      [assigneeId, req.user.id, title, description || null, deadline]
    );

    const task = rows[0];
    await logAudit({
      userId: req.user.id,
      action: 'CREATE_STAFF_TASK',
      entityType: 'staff_task',
      entityId: task.id,
      details: { assignee_id: assigneeId, title, deadline },
    });

    try {
      await sendStaffTaskAssignedEmail({
        to: assignee.email,
        assigneeName: assignee.full_name,
        managerName: req.user.full_name,
        title,
        description,
        deadline,
      });
    } catch (mailErr) {
      console.error('[staff-tasks] email failed', mailErr.message);
    }

    res.status(201).json({
      ...task,
      assignee_name: assignee.full_name,
      assignee_role: assignee.role,
      created_by_name: req.user.full_name,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
