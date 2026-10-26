// Inbox role -> permissions. Admin (CEO) implicitly has everything.
const ROLE_PERMISSIONS = {
  admin: ['*'],
  manager: [
    'conv.view_all', 'conv.reply_any', 'conv.assign', 'analytics.team', 'users.manage', 'settings.manage',
    'templates.manage', 'comments.manage', 'leads.reopen', 'audit.view',
  ],
  supervisor: ['conv.view_all', 'conv.reply_any', 'conv.assign', 'analytics.team', 'templates.manage', 'comments.manage', 'audit.view'],
  agent: [],
};

/** Only the CEO: channel credentials and the simulator. */
const ADMIN_ONLY = ['channels.manage', 'simulator'];

const ROLES = Object.keys(ROLE_PERMISSIONS);
const OVERRIDE_ROLES = ['none', 'agent', 'supervisor', 'manager'];

/** Website, manual, and general reservation agents work the live inbox only. */
const RESERVATION_AGENT_PMS_ROLES = ['reservations', 'reservations_web', 'reservations_manual'];

function can(user, permission) {
  if (!user) return false;
  const perms = ROLE_PERMISSIONS[user.role] || [];
  return perms.includes('*') || perms.includes(permission);
}

function seesEveryChat(user) {
  if (!user) return false;
  return can(user, 'conv.view_all') || RESERVATION_AGENT_PMS_ROLES.includes(user.pms_role);
}

function permissionsFor(user) {
  const perms = ROLE_PERMISSIONS[user.role] || [];
  if (perms.includes('*')) {
    return [...new Set(Object.values(ROLE_PERMISSIONS).flat().filter((p) => p !== '*').concat(ADMIN_ONLY))];
  }
  return perms;
}

module.exports = { ROLE_PERMISSIONS, ADMIN_ONLY, ROLES, OVERRIDE_ROLES, RESERVATION_AGENT_PMS_ROLES, can, seesEveryChat, permissionsFor };
