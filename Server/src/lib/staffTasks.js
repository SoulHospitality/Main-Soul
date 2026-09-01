const TASK_ASSIGNEE_ROLES = ['marketing_pr', 'web_developer'];

function isTaskAssigneeRole(userOrRole) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return TASK_ASSIGNEE_ROLES.includes(String(role || ''));
}

module.exports = {
  TASK_ASSIGNEE_ROLES,
  isTaskAssigneeRole,
};
