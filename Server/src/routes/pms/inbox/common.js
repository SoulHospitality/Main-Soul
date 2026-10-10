const { q } = require('../../../lib/inbox/db');
const { forbidden, notFound } = require('../../../lib/inbox/http');
const { can } = require('../../../lib/inbox/permissions');
const { getSettings, loadSettings } = require('../../../lib/inbox/settings');
const { assign } = require('../../../lib/inbox/assignment');

/** Resolves the PMS staff user to an inbox user (role from the PMS role or the Team override). */
async function loadInboxUser(staffId) {
  return q.get(
    'SELECT id, name, role, pms_role, active, in_rotation, max_open, presence FROM inbox_users WHERE id = ? AND active = 1',
    staffId,
  );
}

async function inboxAuth(req, res, next) {
  await loadSettings();
  const u = await loadInboxUser(req.user.id);
  if (!u?.role) throw forbidden('You do not have access to the inbox');
  req.inbox = u;
  next();
}

function requirePerm(permission) {
  return (req, res, next) => {
    if (!can(req.inbox, permission)) return res.status(403).json({ error: 'Not allowed', code: 'forbidden' });
    return next();
  };
}

function visibilitySql(user) {
  if (can(user, 'conv.view_all')) return { sql: '1 = 1', params: [] };
  return getSettings().allow_agent_claim
    ? { sql: '(c.assigned_user_id = ? OR c.assigned_user_id IS NULL)', params: [user.id] }
    : { sql: 'c.assigned_user_id = ?', params: [user.id] };
}

async function loadConversation(id, user) {
  const conv = await q.get('SELECT * FROM inbox_conversations WHERE id = ?', id);
  if (!conv) throw notFound('Conversation not found');
  const visible = can(user, 'conv.view_all') || conv.assigned_user_id === user.id
    || (conv.assigned_user_id === null && getSettings().allow_agent_claim);
  if (!visible) throw forbidden('This chat is assigned to another agent');
  return conv;
}

/** Replying to an unassigned chat claims it (when claiming is allowed). */
async function ensureCanAct(conv, user) {
  if (conv.assigned_user_id === user.id || can(user, 'conv.reply_any')) return;
  if (conv.assigned_user_id === null && getSettings().allow_agent_claim) {
    await assign(conv.id, user.id, { byUserId: user.id, reason: 'claim' });
    return;
  }
  throw forbidden('This chat is assigned to another agent');
}

module.exports = { loadInboxUser, inboxAuth, requirePerm, visibilitySql, loadConversation, ensureCanAct };
