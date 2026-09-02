const express = require('express');
const { query } = require('../../config/db');
const {
  TASK_ASSIGNEE_ROLES,
  isTaskAssigneeRole,
  canManageStaffTasks,
  canAssignTaskTo,
  sqlStaffTaskManagedBy,
} = require('../../lib/staffTasks');
const { sendStaffTaskAssignedEmail, staffEmailFromUser } = require('../../services/staffTaskEmails');
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

function assigneeAuthShape(row) {
  return {
    id: row.id,
    role: row.role,
    manager_id: row.manager_id,
    manager_ids: Array.isArray(row.manager_ids) ? row.manager_ids : [],
  };
}

router.get('/staff-tasks/assignees', async (req, res, next) => {
  try {
    if (!canManageStaffTasks(req.user)) {
      return res.status(403).json({ error: 'You cannot assign tasks' });
    }
    const { rows } = await query(
      `SELECT id, full_name, role, email
       FROM staff_users
       WHERE is_active = 1
         AND ${sqlStaffTaskManagedBy('$1')}
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
         WHERE ${sqlStaffTaskManagedBy('$1', 'a')}
         ORDER BY t.deadline ASC, t.created_at DESC`;
    const { rows } = await query(sql, [me]);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/staff-tasks', async (req, res, next) => {
  try {
    if (!canManageStaffTasks(req.user)) {
      return res.status(403).json({ error: 'You cannot assign tasks' });
    }
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
      `SELECT id, full_name, email, username, role, manager_id, is_active,
              COALESCE(
                (SELECT array_agg(sum.manager_id ORDER BY sum.manager_id)
                 FROM staff_user_managers sum
                 WHERE sum.staff_user_id = staff_users.id),
                ARRAY[]::int[]
              ) AS manager_ids
       FROM staff_users WHERE id = $1`,
      [assigneeId]
    );
    const assignee = assignees[0];
    if (!assignee || !Number(assignee.is_active)) {
      return res.status(404).json({ error: 'Staff member not found' });
    }
    if (!isTaskAssigneeRole(assignee.role)) {
      return res.status(403).json({ error: 'Tasks can only be assigned to Marketing and PR, Web Developer, or HR staff' });
    }
    if (!canAssignTaskTo(req.user, assigneeAuthShape(assignee))) {
      return res.status(403).json({ error: 'You can only assign tasks to staff you manage' });
    }
    const assigneeEmail = staffEmailFromUser(assignee);
    if (!assigneeEmail) {
      return res.status(400).json({
        error: 'This person has no email on Users. Add the email there, then send the task.',
      });
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

    let emailSent = false;
    let emailError = null;
    try {
      await sendStaffTaskAssignedEmail({
        to: assigneeEmail,
        assigneeName: assignee.full_name,
        managerName: req.user.full_name,
        title,
        description,
        deadline,
      });
      emailSent = true;
    } catch (mailErr) {
      emailError = mailErr.message || 'Could not send email';
      console.error('[staff-tasks] email failed', emailError);
    }

    res.status(201).json({
      ...task,
      assignee_name: assignee.full_name,
      assignee_role: assignee.role,
      created_by_name: req.user.full_name,
      email_to: assigneeEmail,
      email_sent: emailSent,
      email_error: emailError,
    });
  } catch (e) {
    next(e);
  }
});

router.delete('/staff-tasks/:id', async (req, res, next) => {
  try {
    if (isTaskAssigneeRole(req.user) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only a manager can delete this task' });
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid task' });
    }

    const { rows } = await query(
      `SELECT t.id, t.title, t.assignee_id, t.created_by, a.role AS assignee_role,
              a.manager_id, a.full_name AS assignee_name,
              COALESCE(
                (SELECT array_agg(sum.manager_id ORDER BY sum.manager_id)
                 FROM staff_user_managers sum
                 WHERE sum.staff_user_id = a.id),
                ARRAY[]::int[]
              ) AS manager_ids
       FROM staff_tasks t
       JOIN staff_users a ON a.id = t.assignee_id
       WHERE t.id = $1`,
      [id]
    );
    const task = rows[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const isAdmin = req.user.role === 'admin';
    const isCreator = String(task.created_by) === String(req.user.id);
    const assignee = assigneeAuthShape({
      id: task.assignee_id,
      role: task.assignee_role,
      manager_id: task.manager_id,
      manager_ids: task.manager_ids,
    });
    if (!isAdmin && !isCreator && !canAssignTaskTo(req.user, assignee)) {
      return res.status(403).json({ error: 'You can only delete tasks for staff you manage' });
    }

    await query(`DELETE FROM staff_tasks WHERE id = $1`, [id]);
    await logAudit({
      userId: req.user.id,
      action: 'DELETE_STAFF_TASK',
      entityType: 'staff_task',
      entityId: task.id,
      details: { assignee_id: task.assignee_id, title: task.title },
    });
    res.json({ ok: true, id: task.id });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
