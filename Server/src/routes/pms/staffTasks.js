const express = require('express');
const { query } = require('../../config/db');
const {
  canReceiveStaffTasks,
  canManageStaffTasks,
  canAssignTaskTo,
  staffTaskScopeSql,
  staffTaskScopeParams,
} = require('../../lib/staffTasks');
const { sendStaffTaskAssignedEmail, staffEmailFromUser } = require('../../services/staffTaskEmails');
const { logAudit } = require('../../lib/audit');
const { staffTaskTablesReady } = require('../../lib/staffTaskSchema');

const router = express.Router();

const TASK_SELECT = `
  t.id,
  t.assignee_id,
  t.created_by,
  t.title,
  t.description,
  t.deadline::text AS deadline,
  t.created_at,
  t.completed_at,
  t.completed_by,
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
  const managerIds = Array.isArray(row.manager_ids)
    ? row.manager_ids.map(Number).filter((id) => Number.isFinite(id))
    : [];
  const merged = [
    ...new Set([...managerIds, ...(row.manager_id != null ? [Number(row.manager_id)] : [])]),
  ];
  return {
    id: row.id,
    role: row.role,
    manager_id: row.manager_id,
    manager_ids: merged,
  };
}

function taskDbError(res, next, err) {
  if (err?.code === '42P01') {
    return res.status(503).json({ error: 'Tasks are not set up yet. Restart the API server and try again.' });
  }
  console.error('[staff-tasks]', err?.message || err);
  return next(err);
}

router.get('/staff-tasks/assignees', async (req, res, next) => {
  try {
    if (!canManageStaffTasks(req.user)) {
      return res.status(403).json({ error: 'You cannot assign tasks' });
    }
    const ready = await staffTaskTablesReady();
    if (!ready.ready) {
      return res.status(503).json({ error: 'Tasks are not set up yet. Restart the API server and try again.' });
    }
    const { rows } = await query(
      `SELECT u.id, u.full_name, u.role, u.email
       FROM staff_users u
       WHERE u.is_active = 1
         AND ${staffTaskScopeSql('$1', 'u', req.user.role)}
       ORDER BY u.full_name`,
      staffTaskScopeParams(req.user.role, req.user.id)
    );
    res.json(rows);
  } catch (e) {
    return taskDbError(res, next, e);
  }
});

router.get('/staff-tasks', async (req, res, next) => {
  try {
    const ready = await staffTaskTablesReady();
    if (!ready.staff_tasks) {
      return res.status(503).json({ error: 'Tasks are not set up yet. Restart the API server and try again.' });
    }
    const me = req.user.id;
    if (req.user.role === 'admin') {
      const { rows } = await query(
        `SELECT ${TASK_SELECT}
         FROM staff_tasks t
         JOIN staff_users a ON a.id = t.assignee_id
         JOIN staff_users m ON m.id = t.created_by
         WHERE ${staffTaskScopeSql('$1', 'a', req.user.role)}
         ORDER BY (t.completed_at IS NULL) DESC, t.deadline ASC, t.created_at DESC`,
        []
      );
      return res.json(rows);
    }

    const sql = canManageStaffTasks(req.user)
      ? `SELECT ${TASK_SELECT}
         FROM staff_tasks t
         JOIN staff_users a ON a.id = t.assignee_id
         JOIN staff_users m ON m.id = t.created_by
         WHERE t.assignee_id = $1
            OR ${staffTaskScopeSql('$1', 'a', req.user.role)}
         ORDER BY (t.completed_at IS NULL) DESC, t.deadline ASC, t.created_at DESC`
      : `SELECT ${TASK_SELECT}
         FROM staff_tasks t
         JOIN staff_users a ON a.id = t.assignee_id
         JOIN staff_users m ON m.id = t.created_by
         WHERE t.assignee_id = $1
         ORDER BY (t.completed_at IS NULL) DESC, t.deadline ASC, t.created_at DESC`;
    const { rows } = await query(sql, [me]);
    res.json(rows);
  } catch (e) {
    return taskDbError(res, next, e);
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
                (SELECT array_agg(sm.manager_id ORDER BY sm.manager_id)
                 FROM staff_user_managers sm
                 WHERE sm.staff_user_id = staff_users.id),
                ARRAY[]::int[]
              ) AS manager_ids
       FROM staff_users WHERE id = $1`,
      [assigneeId]
    );
    const assignee = assignees[0];
    if (!assignee || !Number(assignee.is_active)) {
      return res.status(404).json({ error: 'Staff member not found' });
    }
    if (!canReceiveStaffTasks(assignee.role)) {
      return res.status(403).json({ error: 'Tasks cannot be assigned to this role' });
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
    return taskDbError(res, next, e);
  }
});

router.post('/staff-tasks/:id/complete', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid task' });
    }

    const { rows } = await query(
      `SELECT id, title, assignee_id, completed_at
       FROM staff_tasks
       WHERE id = $1`,
      [id]
    );
    const task = rows[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (String(task.assignee_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Only the person assigned this task can mark it done' });
    }
    if (task.completed_at) {
      return res.json({ ok: true, id: task.id, already_done: true });
    }

    const { rows: updated } = await query(
      `UPDATE staff_tasks
       SET completed_at = now(), completed_by = $2
       WHERE id = $1 AND assignee_id = $2 AND completed_at IS NULL
       RETURNING id, assignee_id, completed_at, completed_by`,
      [id, req.user.id]
    );
    await logAudit({
      userId: req.user.id,
      action: 'COMPLETE_STAFF_TASK',
      entityType: 'staff_task',
      entityId: task.id,
      details: { title: task.title },
    });
    res.json({ ok: true, ...updated[0] });
  } catch (e) {
    return taskDbError(res, next, e);
  }
});

router.delete('/staff-tasks/:id', async (req, res, next) => {
  try {
    if (!canManageStaffTasks(req.user)) {
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
                (SELECT array_agg(sm.manager_id ORDER BY sm.manager_id)
                 FROM staff_user_managers sm
                 WHERE sm.staff_user_id = a.id),
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
    return taskDbError(res, next, e);
  }
});

module.exports = router;
