const {
  sqlStaffManagedBy,
  isDirectStaffManager,
  isStaffTaskManagerRole,
} = require('./staffManagers');

const STAFF_TASK_RECIPIENT_ROLES = [
  'reservations',
  'reservations_web',
  'reservations_manual',
  'unit_acquisition_agent',
  'operations',
  'housekeeping',
  'resale',
  'finance',
  'hr',
  'owners_relations',
  'marketing_pr',
  'web_developer',
];

function sqlTaskRecipientRoles(staffAlias = 'u') {
  const list = STAFF_TASK_RECIPIENT_ROLES.map((role) => `'${role}'`).join(', ');
  return `${staffAlias}.role IN (${list})`;
}

function canReceiveStaffTasks(role) {
  const r = String(role || '');
  if (r === 'owner' || r === 'admin') return false;
  return STAFF_TASK_RECIPIENT_ROLES.includes(r);
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
  // Managers may only assign to staff linked to them (manager_id / staff_user_managers).
  return isDirectStaffManager(actor.id, assignee);
}

/** Managers see assignees they manage; CEO sees all recipient roles. */
function sqlLineManagerTaskScope(managerParam, staffAlias = 'u') {
  return sqlStaffManagedBy(managerParam, staffAlias);
}

function staffTaskScopeSql(managerParam, staffAlias, actorRole) {
  if (actorRole === 'admin') {
    return sqlTaskRecipientRoles(staffAlias);
  }
  return `(
    ${sqlLineManagerTaskScope(managerParam, staffAlias)}
    AND ${sqlTaskRecipientRoles(staffAlias)}
  )`;
}

function staffTaskScopeParams(actorRole, managerId) {
  return actorRole === 'admin' ? [] : [managerId];
}

module.exports = {
  STAFF_TASK_RECIPIENT_ROLES,
  canReceiveStaffTasks,
  isTaskAssigneeRole,
  canManageStaffTasks,
  canAssignTaskTo,
  sqlTaskRecipientRoles,
  sqlStaffManagedBy,
  sqlLineManagerTaskScope,
  staffTaskScopeSql,
  staffTaskScopeParams,
  isStaffTaskManagerRole,
};
