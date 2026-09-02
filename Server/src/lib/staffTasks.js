const { departmentManagerRole } = require('./hrRules');
const { sqlStaffManagedBy, isDirectStaffManager, LINE_MANAGER_ROLES } = require('./staffManagers');

const TASK_RECIPIENT_EXCLUDED_ROLES = new Set(['owner', 'admin']);

function canReceiveStaffTasks(role) {
  return !TASK_RECIPIENT_EXCLUDED_ROLES.has(String(role || ''));
}

/** @deprecated use canReceiveStaffTasks / canManageStaffTasks for task views */
function isTaskAssigneeRole(userOrRole) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  if (!role) return false;
  if (canManageStaffTasks(typeof userOrRole === 'string' ? { role } : userOrRole)) return false;
  return canReceiveStaffTasks(role);
}

function canManageStaffTasks(actor) {
  if (!actor) return false;
  if (actor.role === 'admin') return true;
  return LINE_MANAGER_ROLES.includes(String(actor.role || ''));
}

function canAssignTaskTo(actor, assignee) {
  if (!actor || !assignee) return false;
  if (String(actor.id) === String(assignee.id)) return false;
  if (!canReceiveStaffTasks(assignee.role)) return false;
  if (isDirectStaffManager(actor.id, assignee)) return true;
  if (actor.role === 'admin') {
    const dept = departmentManagerRole(assignee.role);
    return Boolean(dept) && actor.role === dept;
  }
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

function sqlLineManagerTaskScope(managerParam, staffAlias = 'u') {
  return `(
    ${sqlStaffManagedBy(managerParam, staffAlias)}
    OR EXISTS (
      SELECT 1 FROM staff_users mgr
      WHERE mgr.id = ${managerParam}
        AND mgr.is_active = 1
        AND (
          (${staffAlias}.role = 'operations' AND mgr.role = 'operations_supervisor')
          OR (${staffAlias}.role = 'housekeeping' AND mgr.role = 'housekeeping_supervisor')
          OR (${staffAlias}.role = 'hr' AND mgr.role = 'hr_supervisor')
          OR (${staffAlias}.role IN ('reservations', 'reservations_web', 'reservations_manual') AND mgr.role = 'reservations_manager')
          OR (${staffAlias}.role = 'unit_acquisition_agent' AND mgr.role = 'unit_acquisition_manager')
          OR (${staffAlias}.role = 'resale' AND mgr.role = 'resale_manager')
          OR (${staffAlias}.role = 'finance' AND mgr.role = 'finance_manager')
        )
    )
  )`;
}

function staffTaskScopeSql(managerParam, staffAlias, actorRole) {
  if (actorRole === 'admin') {
    return sqlStaffTaskManagedBy(managerParam, staffAlias);
  }
  return sqlLineManagerTaskScope(managerParam, staffAlias);
}

module.exports = {
  TASK_RECIPIENT_EXCLUDED_ROLES,
  canReceiveStaffTasks,
  isTaskAssigneeRole,
  canManageStaffTasks,
  canAssignTaskTo,
  sqlStaffTaskManagedBy,
  sqlLineManagerTaskScope,
  staffTaskScopeSql,
};
