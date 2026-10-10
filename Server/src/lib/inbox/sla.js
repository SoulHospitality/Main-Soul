const { q, tx, audit } = require('./db');
const { getSettings, loadSettings } = require('./settings');
const { isBusinessTime, nextBusinessStart } = require('./hours');
const { assign, autoAssign, availableAgents, handleAgentOffline } = require('./assignment');
const { broadcast, notify, usersWithRoles } = require('./realtime');

/** Called inside the ingest transaction when a customer message arrives. */
async function startAwaiting(conv, ts) {
  if (conv.awaiting_since) return;
  const s = getSettings();
  const start = nextBusinessStart(ts);
  await q.run(
    `UPDATE inbox_conversations SET awaiting_since = ?, sla_start_at = ?, sla_due_at = ?,
       sla_warned = 0, sla_breached = 0, escalation_level = 0, reassign_count = 0
     WHERE id = ?`,
    ts, start, start + s.sla_target_min * 60000, conv.id,
  );
}

/** Called when a human reply is delivered. Stops the clock and records the response time. */
async function recordResponse(conversationId, userId, at = Date.now()) {
  const conv = await q.get('SELECT * FROM inbox_conversations WHERE id = ?', conversationId);
  if (!conv?.awaiting_since) return null;
  const s = getSettings();
  const isFirst = !(await q.get('SELECT 1 AS x FROM inbox_responses WHERE conversation_id = ? LIMIT 1', conversationId));
  const secondsRaw = Math.max(0, Math.round((at - conv.awaiting_since) / 1000));
  const secondsSla = Math.max(0, Math.round((at - conv.sla_start_at) / 1000));
  await q.run(
    `INSERT INTO inbox_responses (conversation_id, user_id, assigned_user_id, channel_kind, awaiting_since, sla_start_at,
       responded_at, seconds_raw, seconds_sla, within_sla, is_first) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    conversationId, userId, conv.assigned_user_id, conv.channel_kind, conv.awaiting_since, conv.sla_start_at,
    at, secondsRaw, secondsSla, secondsSla <= s.sla_target_min * 60 ? 1 : 0, isFirst ? 1 : 0,
  );
  await q.run(
    `UPDATE inbox_conversations SET awaiting_since = NULL, sla_start_at = NULL, sla_due_at = NULL, sla_warned = 0,
       sla_breached = 0, escalation_level = 0, reassign_count = 0, unread_count = 0, night_ai_replies = 0,
       status = CASE WHEN status = 'needs_reply' THEN 'waiting_customer' ELSE status END
     WHERE id = ?`,
    conversationId,
  );
  return { secondsRaw, secondsSla };
}

async function customerName(conv) {
  return (await q.get('SELECT name FROM inbox_customers WHERE id = ?', conv.customer_id))?.name || 'Customer';
}

async function slaEvent(conv, kind, now) {
  await q.run('INSERT INTO inbox_sla_events (conversation_id, user_id, kind, at) VALUES (?,?,?,?)', conv.id, conv.assigned_user_id, kind, now);
  await audit({ conversationId: conv.id, type: `sla_${kind}`, data: { assignee: conv.assigned_user_id }, at: now });
}

async function checkPresence(now, s) {
  const cutoff = now - s.presence_timeout_min * 60000;
  const stale = await q.all(
    "SELECT staff_user_id AS id FROM inbox_agents WHERE presence = 'online' AND (last_seen_at IS NULL OR last_seen_at < ?)",
    cutoff,
  );
  for (const u of stale) {
    await q.run("UPDATE inbox_agents SET presence = 'offline' WHERE staff_user_id = ?", u.id);
    await audit({ userId: u.id, type: 'presence', data: { presence: 'offline', reason: 'timeout' }, at: now });
    await handleAgentOffline(u.id);
    broadcast('presence', { user_id: u.id, presence: 'offline' });
  }
}

async function wakeSnoozed(now) {
  const due = await q.all("SELECT id, assigned_user_id FROM inbox_conversations WHERE status = 'snoozed' AND snooze_until <= ?", now);
  for (const c of due) {
    await q.run("UPDATE inbox_conversations SET status = 'needs_reply', snooze_until = NULL WHERE id = ?", c.id);
    await audit({ conversationId: c.id, type: 'snooze_ended', at: now });
    await notify([c.assigned_user_id], { kind: 'snooze', title: 'Snoozed chat is back', conversationId: c.id });
    broadcast('conversation', { id: c.id });
  }
}

async function routeUnassigned() {
  const waiting = await q.all(
    `SELECT c.id FROM inbox_conversations c
     WHERE c.status = 'needs_reply'
       AND (c.assigned_user_id IS NULL
            OR c.assigned_user_id NOT IN (SELECT id FROM inbox_users WHERE active = 1 AND role IS NOT NULL))
     ORDER BY c.awaiting_since NULLS LAST`,
  );
  if (!waiting.length || !(await availableAgents()).length) return;
  for (const c of waiting) await autoAssign(c.id);
}

async function checkTimers(now, s) {
  const warnBeforeMs = (s.sla_target_min - s.sla_warning_min) * 60000;
  const supervisors = () => usersWithRoles(['supervisor', 'manager', 'admin']);
  const managers = () => usersWithRoles(['manager', 'admin']);

  const open = await q.all(
    "SELECT * FROM inbox_conversations WHERE status = 'needs_reply' AND awaiting_since IS NOT NULL AND sla_due_at IS NOT NULL",
  );
  for (const conv of open) {
    if (now < conv.sla_start_at) continue; // still outside business hours
    const name = await customerName(conv);

    if (!conv.sla_warned && now >= conv.sla_due_at - warnBeforeMs && now < conv.sla_due_at) {
      await tx(async () => {
        await q.run('UPDATE inbox_conversations SET sla_warned = 1 WHERE id = ?', conv.id);
        await slaEvent(conv, 'warning', now);
      });
      await notify([conv.assigned_user_id], { kind: 'sla_warning', title: 'Reply needed soon', body: name, conversationId: conv.id });
      broadcast('conversation', { id: conv.id });
    }

    if (!conv.sla_breached && now >= conv.sla_due_at) {
      await tx(async () => {
        await q.run(
          "UPDATE inbox_conversations SET sla_breached = 1, sla_warned = 1, priority = CASE WHEN priority = 'normal' THEN 'high' ELSE priority END WHERE id = ?",
          conv.id,
        );
        await slaEvent(conv, 'breach', now);
      });
      await notify([conv.assigned_user_id], { kind: 'sla_breach', title: 'SLA breached', body: name, conversationId: conv.id });
      let movedTo = null;
      if (s.reassign_on_breach && conv.reassign_count < s.max_auto_reassign) {
        const next = (await availableAgents(conv.assigned_user_id ? [conv.assigned_user_id] : []))[0];
        if (next) {
          await assign(conv.id, next.id, { reason: 'sla_breach' });
          movedTo = next.name;
        }
      }
      await notify(await supervisors(), {
        kind: 'sla_breach',
        title: movedTo ? `SLA breach - moved to ${movedTo}` : 'SLA breach - no agent available to take over',
        body: name,
        conversationId: conv.id,
      });
      broadcast('conversation', { id: conv.id });
    }

    const waitedMin = (now - conv.sla_start_at) / 60000;
    if (conv.escalation_level < 1 && waitedMin >= s.escalate_supervisor_min) {
      await tx(async () => {
        await q.run("UPDATE inbox_conversations SET escalation_level = 1, priority = 'urgent' WHERE id = ?", conv.id);
        await slaEvent(conv, 'escalation_supervisor', now);
      });
      await notify(await supervisors(), { kind: 'escalation', title: `Customer waiting ${s.escalate_supervisor_min}+ min`, body: name, conversationId: conv.id });
      broadcast('conversation', { id: conv.id });
    } else if (conv.escalation_level < 2 && waitedMin >= s.escalate_manager_min) {
      await tx(async () => {
        await q.run("UPDATE inbox_conversations SET escalation_level = 2, priority = 'urgent' WHERE id = ?", conv.id);
        await slaEvent(conv, 'escalation_manager', now);
      });
      await notify(await managers(), { kind: 'escalation', title: `Customer waiting ${s.escalate_manager_min}+ min`, body: name, conversationId: conv.id });
      broadcast('conversation', { id: conv.id });
    }
  }
}

async function checkFollowUps(now, s) {
  const due = await q.all(
    `SELECT f.*, c.name AS customer_name FROM inbox_follow_ups f
     LEFT JOIN inbox_leads l ON l.id = f.lead_id LEFT JOIN inbox_customers c ON c.id = l.customer_id
     WHERE f.status = 'open' AND f.notified = 0 AND f.due_at <= ?`,
    now,
  );
  for (const f of due) {
    await q.run('UPDATE inbox_follow_ups SET notified = 1 WHERE id = ?', f.id);
    await notify([f.assigned_user_id], {
      kind: 'follow_up', title: 'Follow-up due', body: `${f.customer_name || ''} ${f.note || ''}`.trim(), conversationId: f.conversation_id,
    });
  }
  const overdue = await q.all(
    `SELECT f.*, c.name AS customer_name FROM inbox_follow_ups f
     LEFT JOIN inbox_leads l ON l.id = f.lead_id LEFT JOIN inbox_customers c ON c.id = l.customer_id
     WHERE f.status = 'open' AND f.escalated = 0 AND f.due_at <= ?`,
    now - s.follow_up_escalate_min * 60000,
  );
  for (const f of overdue) {
    await q.run('UPDATE inbox_follow_ups SET escalated = 1 WHERE id = ?', f.id);
    await audit({ conversationId: f.conversation_id, leadId: f.lead_id, type: 'follow_up_overdue', data: { follow_up_id: f.id }, at: now });
    await notify(await usersWithRoles(['supervisor', 'manager', 'admin']), {
      kind: 'follow_up_overdue', title: 'Follow-up overdue', body: f.customer_name || '', conversationId: f.conversation_id,
    });
  }
}

async function tick(now = Date.now()) {
  const s = await loadSettings();
  await checkPresence(now, s);
  await wakeSnoozed(now);
  if (isBusinessTime(now)) await routeUnassigned();
  await checkTimers(now, s);
  await checkFollowUps(now, s);
}

let running = false;
let missingSchemaLogged = false;

function startInboxSlaLoop() {
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch (err) {
      if (/relation "inbox_|inbox_users/.test(err.message)) {
        if (!missingSchemaLogged) console.warn('[inbox] tables missing; SLA loop waits for migration 127');
        missingSchemaLogged = true;
      } else {
        console.error('[inbox] SLA tick failed', err);
      }
    } finally {
      running = false;
    }
  };
  setTimeout(run, 5000).unref?.();
  const timer = setInterval(run, 15000);
  timer.unref?.();
  return timer;
}

module.exports = { startAwaiting, recordResponse, tick, startInboxSlaLoop };
