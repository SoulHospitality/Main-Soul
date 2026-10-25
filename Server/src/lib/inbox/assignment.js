const { q, tx, audit } = require('./db');
const { getSettings } = require('./settings');
const { isBusinessTime } = require('./hours');
const { broadcast, notify } = require('./realtime');

// Reasons that hand the waiting customer to a new agent mid-cycle: the new agent gets
// a fresh (shorter) window instead of inheriting an already-breached deadline.
const FRESH_WINDOW_REASONS = new Set(['sla_breach', 'agent_offline', 'manual', 'takeover', 'claim']);

/** Agents who can take a chat right now, best candidate first. */
async function availableAgents(excludeIds = []) {
  const s = getSettings();
  const cutoff = Date.now() - s.presence_timeout_min * 60000;
  const rows = await q.all(
    `SELECT u.id, u.name, u.max_open, u.last_assigned_at,
       (SELECT COUNT(*) FROM inbox_conversations c
          WHERE c.status = 'needs_reply' AND (
            c.assigned_user_id = u.id
            OR EXISTS (SELECT 1 FROM inbox_conversation_assignees a WHERE a.conversation_id = c.id AND a.user_id = u.id)
          )) AS waiting
     FROM inbox_users u
     WHERE u.role IS NOT NULL AND u.active = 1 AND u.in_rotation = 1 AND u.presence = 'online' AND u.last_seen_at >= ?`,
    cutoff,
  );
  return rows
    .filter((u) => !excludeIds.includes(u.id) && u.waiting < u.max_open)
    // least loaded first, then whoever has waited longest for a new chat (round robin)
    .sort((a, b) => a.waiting - b.waiting || (a.last_assigned_at || 0) - (b.last_assigned_at || 0));
}

async function assigneeIds(conversationId, fallbackId = null) {
  const rows = await q.all(
    'SELECT user_id FROM inbox_conversation_assignees WHERE conversation_id = ? ORDER BY assigned_at',
    conversationId,
  );
  const ids = rows.map((r) => r.user_id);
  if (!ids.length && fallbackId) ids.push(fallbackId);
  return ids;
}

async function listAssignees(conversationId) {
  return q.all(
    `SELECT a.user_id AS id, u.name, a.assigned_at
     FROM inbox_conversation_assignees a
     JOIN inbox_users u ON u.id = a.user_id
     WHERE a.conversation_id = ?
     ORDER BY a.assigned_at`,
    conversationId,
  );
}

/** Add a staff member. Existing assignees stay on the chat. */
async function addAssignee(conversationId, userId, { byUserId = null, reason = 'reply' } = {}) {
  return assign(conversationId, userId, { byUserId, reason });
}

async function removeAssignee(conversationId, userId, { byUserId = null } = {}) {
  const conv = await q.get('SELECT * FROM inbox_conversations WHERE id = ?', conversationId);
  if (!conv || !userId) return conv;
  const now = Date.now();
  await tx(async () => {
    await q.run(
      'DELETE FROM inbox_conversation_assignees WHERE conversation_id = ? AND user_id = ?',
      conversationId, userId,
    );
    if (conv.assigned_user_id === userId) {
      const next = await q.get(
        'SELECT user_id FROM inbox_conversation_assignees WHERE conversation_id = ? ORDER BY assigned_at LIMIT 1',
        conversationId,
      );
      await q.run(
        'UPDATE inbox_conversations SET assigned_user_id = ?, assigned_at = ? WHERE id = ?',
        next?.user_id || null, next ? now : null, conversationId,
      );
    }
    await audit({
      conversationId, userId: byUserId, type: 'unassigned',
      data: { user_id: userId }, at: now,
    });
  });
  broadcast('conversation', { id: conversationId });
  return q.get('SELECT * FROM inbox_conversations WHERE id = ?', conversationId);
}

async function assign(conversationId, toUserId, { byUserId = null, reason }) {
  const now = Date.now();
  const s = getSettings();
  const conv = await q.get('SELECT * FROM inbox_conversations WHERE id = ?', conversationId);
  if (!conv || !toUserId) return conv;
  const already = await q.get(
    'SELECT 1 AS x FROM inbox_conversation_assignees WHERE conversation_id = ? AND user_id = ?',
    conversationId, toUserId,
  );
  if (already) return conv;

  await tx(async () => {
    await q.run(
      `INSERT INTO inbox_conversation_assignees (conversation_id, user_id, assigned_at)
       VALUES (?,?,?) ON CONFLICT DO NOTHING`,
      conversationId, toUserId, now,
    );
    const freshWindow = Boolean(
      !conv.assigned_user_id && conv.awaiting_since && FRESH_WINDOW_REASONS.has(reason) && isBusinessTime(now),
    );
    await q.run(
      `UPDATE inbox_conversations SET
         assigned_user_id = COALESCE(assigned_user_id, ?),
         assigned_at = COALESCE(assigned_at, ?),
         sla_due_at = CASE WHEN ?::int = 1 THEN ?::bigint ELSE sla_due_at END,
         sla_warned = CASE WHEN ?::int = 1 THEN 0 ELSE sla_warned END,
         sla_breached = CASE WHEN ?::int = 1 THEN 0 ELSE sla_breached END,
         reassign_count = reassign_count + ?::int
       WHERE id = ?`,
      toUserId, now,
      freshWindow, Math.max(conv.sla_due_at || 0, now + s.reassign_window_min * 60000),
      freshWindow, freshWindow,
      reason === 'sla_breach' || reason === 'agent_offline' ? 1 : 0,
      conversationId,
    );
    await q.run(
      'INSERT INTO inbox_assignments (conversation_id, from_user_id, to_user_id, by_user_id, reason, at) VALUES (?,?,?,?,?,?)',
      conversationId, conv.assigned_user_id, toUserId, byUserId, reason, now,
    );
    await q.run(
      `INSERT INTO inbox_agents (staff_user_id, last_assigned_at) VALUES (?, ?)
       ON CONFLICT (staff_user_id) DO UPDATE SET last_assigned_at = EXCLUDED.last_assigned_at`,
      toUserId, now,
    );
    await audit({
      conversationId, userId: byUserId, type: 'assigned',
      data: { from: conv.assigned_user_id, to: toUserId, reason, added: true }, at: now,
    });
  });

  if (toUserId !== byUserId) {
    const customer = await q.get('SELECT name FROM inbox_customers WHERE id = ?', conv.customer_id);
    await notify([toUserId], {
      kind: 'assigned',
      title: reason === 'sla_breach' ? 'You were added to a chat (SLA breach)' : 'You were added to a chat',
      body: customer?.name || 'Customer',
      conversationId,
    });
  }
  broadcast('conversation', { id: conversationId });
  return q.get('SELECT * FROM inbox_conversations WHERE id = ?', conversationId);
}

async function previousOwner(customerId) {
  const row = await q.get(
    `SELECT assigned_user_id AS id FROM inbox_conversations
     WHERE customer_id = ? AND assigned_user_id IS NOT NULL ORDER BY last_message_at DESC NULLS LAST LIMIT 1`,
    customerId,
  );
  return row?.id || null;
}

/**
 * Route a chat that needs an owner. Keeps the current owner when available, otherwise
 * prefers the customer's previous agent (sticky), otherwise the best available agent.
 */
async function autoAssign(conversationId, { exclude = [], reason = 'auto' } = {}) {
  if (!isBusinessTime()) return null;
  const conv = await q.get('SELECT * FROM inbox_conversations WHERE id = ?', conversationId);
  if (!conv || conv.status === 'closed') return null;

  const candidates = await availableAgents(exclude);
  const members = await assigneeIds(conversationId, conv.assigned_user_id);
  const stillHere = members.find((id) => !exclude.includes(id) && candidates.some((c) => c.id === id));
  if (stillHere) return stillHere;
  const sticky = await previousOwner(conv.customer_id);
  if (sticky && sticky !== conv.assigned_user_id && candidates.some((c) => c.id === sticky)) {
    await assign(conversationId, sticky, { reason: reason === 'auto' ? 'sticky' : reason });
    return sticky;
  }
  const pick = candidates[0];
  if (!pick) return null;
  await assign(conversationId, pick.id, { reason });
  return pick.id;
}

/** When an agent goes offline, chats where a customer is waiting move to someone online. */
async function handleAgentOffline(userId) {
  const waiting = await q.all(
    `SELECT DISTINCT c.id FROM inbox_conversations c
     LEFT JOIN inbox_conversation_assignees a ON a.conversation_id = c.id
     WHERE c.status = 'needs_reply' AND (c.assigned_user_id = ? OR a.user_id = ?)`,
    userId, userId,
  );
  for (const c of waiting) await autoAssign(c.id, { exclude: [userId], reason: 'agent_offline' });
}

module.exports = { availableAgents, assign, addAssignee, removeAssignee, assigneeIds, listAssignees, autoAssign, handleAgentOffline };
