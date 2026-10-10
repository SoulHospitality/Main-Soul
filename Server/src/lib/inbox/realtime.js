const { getIo } = require('../../config/socket');
const { q } = require('./db');

const ROOM = 'inbox';
const userRoom = (id) => `inbox-user:${id}`;

// "Who is looking at this chat" - shown in the UI so two agents don't answer the same customer.
const viewing = new Map(); // userId -> { conversationId, at }

/** Send to every inbox user, or only to the ids in `userIds`. */
function broadcast(type, data, userIds = null) {
  const io = getIo();
  if (!io) return;
  const payload = { type, data };
  if (userIds) {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return;
    let target = io.to(userRoom(ids[0]));
    for (const id of ids.slice(1)) target = target.to(userRoom(id));
    target.emit('inbox:event', payload);
    return;
  }
  io.to(ROOM).emit('inbox:event', payload);
}

function viewersSnapshot() {
  const out = {};
  const cutoff = Date.now() - 90000;
  for (const [uid, v] of viewing) {
    if (v.at < cutoff) continue;
    (out[v.conversationId] ||= []).push(uid);
  }
  return out;
}

function setViewing(userId, conversationId) {
  const prev = viewing.get(userId)?.conversationId || null;
  const next = conversationId ? Number(conversationId) : null;
  if (next) viewing.set(userId, { conversationId: next, at: Date.now() });
  else viewing.delete(userId);
  if (prev !== next) broadcast('viewers', viewersSnapshot());
}

async function inboxUser(userId) {
  return q.get('SELECT id, name, role, pms_role, active FROM inbox_users WHERE id = ? AND role IS NOT NULL AND active = 1', userId);
}

async function touchPresence(userId, now = Date.now()) {
  await q.run(
    `INSERT INTO inbox_agents (staff_user_id, last_seen_at) VALUES (?, ?)
     ON CONFLICT (staff_user_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
    userId, now,
  );
}

/** Called for every authenticated PMS socket; inbox pages opt in with `inbox:join`. */
function attachSocket(socket) {
  const staffId = socket.staff?.id;
  if (!staffId) return;
  let joined = false;

  socket.on('inbox:join', async (ack) => {
    try {
      const u = await inboxUser(staffId);
      if (!u) {
        if (typeof ack === 'function') ack({ ok: false });
        return;
      }
      joined = true;
      socket.join(ROOM);
      socket.join(userRoom(staffId));
      await touchPresence(staffId);
      if (typeof ack === 'function') ack({ ok: true, viewers: viewersSnapshot() });
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on('inbox:heartbeat', async (payload) => {
    if (!joined) return;
    try {
      await touchPresence(staffId);
      setViewing(staffId, payload?.viewing || null);
    } catch (err) {
      console.warn('[inbox] heartbeat failed:', err.message);
    }
  });

  socket.on('inbox:leave', () => {
    joined = false;
    socket.leave(ROOM);
    socket.leave(userRoom(staffId));
    setViewing(staffId, null);
  });

  socket.on('disconnect', () => {
    if (!joined) return;
    const io = getIo();
    const stillThere = io?.sockets?.adapter?.rooms?.get(userRoom(staffId))?.size;
    if (!stillThere) setViewing(staffId, null);
  });
}

async function usersWithRoles(roles) {
  const rows = await q.all('SELECT id FROM inbox_users WHERE active = 1 AND role = ANY(?::text[])', roles);
  return rows.map((u) => u.id);
}

/** PMS bell notification + live toast inside the inbox. */
async function notify(userIds, { kind, title, body = null, conversationId = null }) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(Number))];
  if (!ids.length) return;
  try {
    const { notifyStaff } = require('../../services/pmsNotifications');
    await notifyStaff({
      userIds: ids,
      type: `inbox_${kind}`,
      title: String(title).slice(0, 250),
      message: String(body || title).slice(0, 1000),
      entity_type: conversationId ? 'inbox_conversation' : 'inbox',
      entity_id: conversationId || null,
    });
  } catch (err) {
    console.warn('[inbox] notification failed:', err.message);
  }
  broadcast('notification', { kind, title, body, conversation_id: conversationId, created_at: Date.now() }, ids);
}

module.exports = { broadcast, viewersSnapshot, setViewing, attachSocket, usersWithRoles, notify, inboxUser, touchPresence };
