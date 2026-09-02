const { departmentManagerRole } = require('./hrRules');
const { sqlStaffManagedBy, isDirectStaffManager, LINE_MANAGER_ROLES } = require('./staffManagers');

const TASK_ASSIGNEE_ROLES = ['marketing_pr', 'web_developer', 'hr'];

function isTaskAssigneeRole(userOrRole) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return TASK_ASSIGNEE_ROLES.includes(String(role || ''));
}

function canManageStaffTasks(actor) {
  if (!actor) return false;
  if (actor.role === 'admin') return true;
  return LINE_MANAGER_ROLES.includes(String(actor.role || ''));
}

function canAssignTaskTo(actor, assignee) {
  if (!actor || !assignee) return false;
  if (String(actor.id) === String(assignee.id)) return false;
  if (isDirectStaffManager(actor.id, assignee)) return true;
  if (actor.role !== 'admin') return false;
  const dept = departmentManagerRole(assignee.role);
  return Boolean(dept) && actor.role === dept;
}

function sqlStaffTaskManagedBy(managerParam, staffAlias = 'u') {
  return `(
    ${sqlStaffManagedBy(managerParam, staffAlias)}
    OR EXISTS (
      SELECT 1 FROM staff_users mgr
      WHERE mgr.id = ${managerParam}
        AND mgr.is_active = 1
        AND mgr.role = 'admin'
        AND ${staffAlias}.role IN ('marketing_pr', 'web_developer')
    )
  )`;
}

function staffTaskScopeSql(managerParam, staffAlias, actorRole) {
  if (actorRole === 'admin') {
    return sqlStaffTaskManagedBy(managerParam, staffAlias);
  }
  return sqlStaffManagedBy(managerParam, staffAlias);
}

module.exports = {
  TASK_ASSIGNEE_ROLES,
  isTaskAssigneeRole,
  canManageStaffTasks,
  canAssignTaskTo,
  sqlStaffTaskManagedBy,
  staffTaskScopeSql,
};
