const { departmentManagerRole } = require('./hrRules');
const {
  sqlStaffManagedBy,
  isDirectStaffManager,
  isStaffTaskManagerRole,
} = require('./staffManagers');

function canReceiveStaffTasks(role) {
  const r = String(role || '');
  if (r === 'owner' || r === 'admin') return false;
  return !isStaffTaskManagerRole(r);
}

function isTaskAssigneeRole(userOrRole) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return canReceiveStaffTasks(role);
}

function canManageStaffTasks(actor) {
  return !!actor && isStaffTaskManagerRole(actor.role);
}

function canAssignTaskTo(actor, assignee) {
  if (!actor || !assignee) return false;
  if (String(actor.id) === String(assignee.id)) return false;
  if (!canReceiveStaffTasks(assignee.role)) return false;
  if (actor.role === 'admin') return true;
  if (isDirectStaffManager(actor.id, assignee)) return true;
  const dept = departmentManagerRole(assignee.role);
  return Boolean(dept) && actor.role === dept;
}

function sqlTaskRecipientRoles(staffAlias = 'u') {
  return `(
    ${staffAlias}.role NOT IN ('owner', 'admin')
    AND right(${staffAlias}.role, 8) <> '_manager'
    AND right(${staffAlias}.role, 11) <> '_supervisor'
  )`;
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
    return sqlTaskRecipientRoles(staffAlias);
  }
  return sqlLineManagerTaskScope(managerParam, staffAlias);
}

module.exports = {
  canReceiveStaffTasks,
  isTaskAssigneeRole,
  canManageStaffTasks,
  canAssignTaskTo,
  sqlTaskRecipientRoles,
  sqlStaffTaskManagedBy,
  sqlLineManagerTaskScope,
  staffTaskScopeSql,
  isStaffTaskManagerRole,
};
