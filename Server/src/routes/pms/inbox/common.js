const { q } = require('../../../lib/inbox/db');
const { forbidden, notFound } = require('../../../lib/inbox/http');
const { can } = require('../../../lib/inbox/permissions');
const { getSettings, loadSettings } = require('../../../lib/inbox/settings');

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

function onChatSql(userIdParam = '?') {
  return `(c.assigned_user_id = ${userIdParam} OR EXISTS (
    SELECT 1 FROM inbox_conversation_assignees a WHERE a.conversation_id = c.id AND a.user_id = ${userIdParam}
  ))`;
}

function visibilitySql(user) {
  if (can(user, 'conv.view_all')) return { sql: '1 = 1', params: [] };
  const mine = onChatSql();
  if (!getSettings().allow_agent_claim) return { sql: mine, params: [user.id, user.id] };
  return {
    sql: `(${mine} OR (c.assigned_user_id IS NULL AND NOT EXISTS (
      SELECT 1 FROM inbox_conversation_assignees a WHERE a.conversation_id = c.id
    )))`,
    params: [user.id, user.id],
  };
}

async function loadConversation(id, user) {
  const conv = await q.get('SELECT * FROM inbox_conversations WHERE id = ?', id);
  if (!conv) throw notFound('Conversation not found');
  if (can(user, 'conv.view_all')) return conv;
  const member = conv.assigned_user_id === user.id || await q.get(
    'SELECT 1 AS x FROM inbox_conversation_assignees WHERE conversation_id = ? AND user_id = ?',
    conv.id, user.id,
  );
  if (member) return conv;
  const open = getSettings().allow_agent_claim && !conv.assigned_user_id && !(await q.get(
    'SELECT 1 AS x FROM inbox_conversation_assignees WHERE conversation_id = ?',
    conv.id,
  ));
  if (!open) throw forbidden('This chat is assigned to other staff');
  return conv;
}

/** Opening the chat is enough. Sending a reply adds the sender to its assignees. */
async function ensureCanAct() {}

module.exports = { loadInboxUser, inboxAuth, requirePerm, visibilitySql, loadConversation, ensureCanAct, onChatSql };
