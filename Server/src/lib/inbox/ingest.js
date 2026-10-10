const { config } = require('./config');
const { q, tx, audit, lockKey } = require('./db');
const { normalizePhone, preview } = require('./http');
const { getSettings, loadSettings } = require('./settings');
const { isBusinessTime } = require('./hours');
const { autoAssign } = require('./assignment');
const { startAwaiting, recordResponse } = require('./sla');
const { broadcast } = require('./realtime');
const { fetchProfile } = require('./meta');
const { aiAvailable, classify, nightReply } = require('./ai');
const { sendToCustomer } = require('./outbound');
const { hasActiveStay } = require('./pmsLink');

// Every channel is converted to this normalised shape before it touches the database:
//   channel        row from `inbox_channels`
//   externalUserId PSID / IGSID / WhatsApp number
//   profile        { name, username, avatar }
//   message        { externalId, text, attachments: [{type,url?,mediaId?,mime?,filename?}], timestamp, referral }

function defaultSource(channel, referral) {
  if (referral) {
    const url = String(referral.source_url || '');
    if (channel.kind === 'instagram' || /instagram/i.test(url)) return 'instagram_ad';
    return 'facebook_ad';
  }
  return { messenger: 'messenger', instagram: 'instagram_dm', whatsapp: 'whatsapp' }[channel.kind];
}

async function findOrCreateIdentity({ channel, externalUserId, profile, phone, simulated, now }) {
  const existing = await q.get('SELECT * FROM inbox_customer_identities WHERE channel_id = ? AND external_id = ?', channel.id, externalUserId);
  if (existing) return { identity: existing, created: false };

  let customer = null;
  const normalized = normalizePhone(phone);
  if (normalized) {
    // Exact phone match only - anything fuzzier is left to a human merge.
    customer = await q.get('SELECT * FROM inbox_customers WHERE phone = ? ORDER BY id LIMIT 1', normalized);
  }
  if (!customer) {
    const { id } = await q.insert(
      'INSERT INTO inbox_customers (name, phone, avatar_url, is_simulated, created_at, updated_at) VALUES (?,?,?,?,?,?)',
      profile.name || (normalized ? `+${normalized}` : null), normalized, profile.avatar || null, simulated ? 1 : 0, now, now,
    );
    customer = { id };
  } else {
    await audit({ type: 'customer_matched_by_phone', data: { customer_id: customer.id, channel: channel.kind }, at: now });
  }
  const { id } = await q.insert(
    `INSERT INTO inbox_customer_identities (customer_id, channel_id, channel_kind, external_id, display_name, username, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    customer.id, channel.id, channel.kind, externalUserId, profile.name || null, profile.username || null, now,
  );
  return { identity: await q.get('SELECT * FROM inbox_customer_identities WHERE id = ?', id), created: true };
}

async function ingestInbound({ channel, externalUserId, profile = {}, message, phone = null, simulated = false }) {
  await loadSettings();
  const now = Date.now();
  const ts = Math.min(message.timestamp || now, now);

  const result = await tx(async () => {
    await lockKey(`${channel.id}:${externalUserId}`);
    if (message.externalId && await q.get('SELECT 1 AS x FROM inbox_messages WHERE channel_kind = ? AND external_id = ?', channel.kind, message.externalId)) {
      return null; // duplicate webhook delivery
    }
    const { identity, created: newIdentity } = await findOrCreateIdentity({ channel, externalUserId, profile, phone, simulated, now });

    let conv = await q.get('SELECT * FROM inbox_conversations WHERE identity_id = ? ORDER BY id DESC LIMIT 1', identity.id);
    let isNew = false;
    if (!conv) {
      const { id } = await q.insert(
        `INSERT INTO inbox_conversations (customer_id, identity_id, channel_id, channel_kind, status, source, ad_id, ad_ref_json, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        identity.customer_id, identity.id, channel.id, channel.kind, 'needs_reply', defaultSource(channel, message.referral),
        message.referral?.ad_id || message.referral?.source_id || null,
        message.referral ? JSON.stringify(message.referral) : null, ts,
      );
      conv = await q.get('SELECT * FROM inbox_conversations WHERE id = ?', id);
      isNew = true;
      await audit({ conversationId: id, type: 'conversation_created', data: { channel: channel.kind, source: conv.source }, at: ts });
    } else if (conv.status === 'closed') {
      await audit({ conversationId: conv.id, type: 'reopened', data: { by: 'customer_message' }, at: ts });
    }

    if (message.referral && !conv.ad_id) {
      await q.run(
        'UPDATE inbox_conversations SET source = ?, ad_id = ?, ad_ref_json = ? WHERE id = ?',
        defaultSource(channel, message.referral), message.referral.ad_id || message.referral.source_id || null,
        JSON.stringify(message.referral), conv.id,
      );
      await audit({ conversationId: conv.id, type: 'ad_referral', data: message.referral, at: ts });
    }

    const attachments = message.attachments?.length ? message.attachments : null;
    const body = message.text || '';
    await q.run(
      `INSERT INTO inbox_messages (conversation_id, direction, sender_type, channel_kind, external_id, body, attachments_json, delivery_status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      conv.id, 'in', 'customer', channel.kind, message.externalId || null, body,
      attachments ? JSON.stringify(attachments) : null, 'received', ts,
    );
    const shown = body || (attachments ? `[${attachments.map((a) => a.type).join(', ')}]` : '');
    await q.run(
      `UPDATE inbox_conversations SET last_message_at = ?, last_inbound_at = ?, last_message_preview = ?,
         unread_count = unread_count + 1, status = 'needs_reply', snooze_until = NULL, closed_at = NULL
       WHERE id = ?`,
      ts, ts, preview(shown), conv.id,
    );
    await startAwaiting(conv, ts);
    return { conversationId: conv.id, isNew, newIdentity, identityId: identity.id, customerId: identity.customer_id };
  });

  if (!result) return null;
  afterInbound(result, { channel, externalUserId, profile, simulated }).catch((err) => console.warn('[inbox] after-inbound failed:', err.message));
  return result;
}

async function afterInbound({ conversationId, isNew, newIdentity, identityId, customerId }, { channel, externalUserId, profile, simulated }) {
  broadcast('message', { conversation_id: conversationId });
  broadcast('conversation', { id: conversationId, new: isNew });

  if (isBusinessTime()) {
    await autoAssign(conversationId);
  } else {
    scheduleNightReply(conversationId);
  }

  if (isNew) await markExistingGuest(conversationId, customerId);

  if (newIdentity && !simulated && !profile.name && channel.kind !== 'whatsapp') {
    fetchProfile(channel, externalUserId)
      .then(async (p) => {
        await q.run('UPDATE inbox_customer_identities SET display_name = ?, username = ? WHERE id = ?', p.name, p.username, identityId);
        await q.run(
          `UPDATE inbox_customers SET name = COALESCE(name, ?), avatar_url = COALESCE(avatar_url, ?), updated_at = ?
           WHERE id = (SELECT customer_id FROM inbox_customer_identities WHERE id = ?)`,
          p.name, p.avatar, Date.now(), identityId,
        );
        broadcast('conversation', { id: conversationId });
      })
      .catch((err) => console.warn('[inbox] profile lookup failed:', err.message));
  }

  if (isNew && aiAvailable() && getSettings().ai_auto_classify) {
    // Give the customer a moment to finish their first burst of messages.
    const t = setTimeout(() => {
      classify(conversationId)
        .then((r) => applyClassification(conversationId, r))
        .catch((err) => console.warn('[inbox] AI classify failed:', err.message));
    }, 30000);
    t.unref?.();
  }
}

/** A customer with an upcoming or in-house PMS stay is an existing guest, not a new lead. */
async function markExistingGuest(conversationId, customerId) {
  const customer = await q.get('SELECT phone FROM inbox_customers WHERE id = ?', customerId);
  if (!customer?.phone || !(await hasActiveStay(customer.phone))) return;
  const r = await q.run("UPDATE inbox_conversations SET type = 'existing_guest' WHERE id = ? AND type = 'unknown'", conversationId);
  if (r.changes) {
    await audit({ conversationId, type: 'matched_pms_guest', data: { phone: customer.phone } });
    broadcast('conversation', { id: conversationId });
  }
}

/** Use the AI classification to fill blanks only - it never overwrites what a human set. */
async function applyClassification(conversationId, r) {
  const conv = await q.get('SELECT * FROM inbox_conversations WHERE id = ?', conversationId);
  if (!conv) return;
  if (conv.type === 'unknown' && r.conversation_type) {
    await q.run("UPDATE inbox_conversations SET type = ? WHERE id = ? AND type = 'unknown'", r.conversation_type, conversationId);
  }
  if (r.urgency === 'high' || r.sentiment === 'angry') {
    await q.run("UPDATE inbox_conversations SET priority = CASE WHEN priority = 'normal' THEN 'high' ELSE priority END WHERE id = ?", conversationId);
  }
  const phone = normalizePhone(r.phone);
  if (phone) {
    await q.run('UPDATE inbox_customers SET phone = COALESCE(phone, ?), updated_at = ? WHERE id = ?', phone, Date.now(), conv.customer_id);
    await markExistingGuest(conversationId, conv.customer_id);
  }
  broadcast('conversation', { id: conversationId });
}

const nightTimers = new Map();

function scheduleNightReply(conversationId) {
  const s = getSettings();
  if (s.night_mode === 'off') return;
  clearTimeout(nightTimers.get(conversationId));
  // Debounce: customers often send several messages in a row.
  const t = setTimeout(() => {
    nightTimers.delete(conversationId);
    sendNightReply(conversationId).catch((err) => console.warn('[inbox] night reply failed:', err.message));
  }, config.isProduction ? 20000 : 3000);
  t.unref?.();
  nightTimers.set(conversationId, t);
}

async function sendNightReply(conversationId) {
  const s = await loadSettings();
  const conv = await q.get('SELECT * FROM inbox_conversations WHERE id = ?', conversationId);
  if (!conv || isBusinessTime() || !conv.awaiting_since) return;
  if (conv.night_ai_replies >= s.night_ai_max_replies) return;

  let text = null;
  let senderType = 'auto';
  if (s.night_mode === 'ai' && aiAvailable()) {
    text = await nightReply(conversationId).catch((err) => {
      console.warn('[inbox] night AI failed, using fixed message:', err.message);
      return null;
    });
    if (text) senderType = 'ai';
  }
  if (!text) {
    if (conv.night_ai_replies > 0) return; // the fixed message is sent once per night
    text = s.night_message;
  }
  await q.run('UPDATE inbox_conversations SET night_ai_replies = night_ai_replies + 1 WHERE id = ?', conversationId);
  await sendToCustomer(conversationId, { text, senderType });
}

/** A reply made directly in Meta Business Suite / the WhatsApp app: logged, and counts as a response. */
async function ingestEcho({ channel, recipientId, message }) {
  if (message.appId && config.meta.appId && String(message.appId) === String(config.meta.appId)) return; // sent by us
  if (message.externalId && await q.get('SELECT 1 AS x FROM inbox_messages WHERE channel_kind = ? AND external_id = ?', channel.kind, message.externalId)) return;
  const identity = await q.get('SELECT * FROM inbox_customer_identities WHERE channel_id = ? AND external_id = ?', channel.id, recipientId);
  if (!identity) return;
  const conv = await q.get('SELECT * FROM inbox_conversations WHERE identity_id = ? ORDER BY id DESC LIMIT 1', identity.id);
  if (!conv) return;
  // Our own send may still be waiting for its id; skip an echo that matches a pending message.
  const pending = await q.get(
    "SELECT 1 AS x FROM inbox_messages WHERE conversation_id = ? AND direction = 'out' AND delivery_status = 'pending' AND body = ? AND created_at > ?",
    conv.id, message.text || '', Date.now() - 60000,
  );
  if (pending) return;
  const ts = Math.min(message.timestamp || Date.now(), Date.now());
  await tx(async () => {
    await lockKey(`${channel.id}:${recipientId}`);
    await q.run(
      `INSERT INTO inbox_messages (conversation_id, direction, sender_type, channel_kind, external_id, body, attachments_json, delivery_status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
      conv.id, 'out', 'external', channel.kind, message.externalId, message.text || '',
      message.attachments?.length ? JSON.stringify(message.attachments) : null, 'sent', ts,
    );
    await q.run('UPDATE inbox_conversations SET last_message_at = ?, last_message_preview = ? WHERE id = ?', ts, preview(message.text || '[attachment]'), conv.id);
    await recordResponse(conv.id, null, ts);
    await audit({ conversationId: conv.id, type: 'replied_outside_system', at: ts });
  });
  broadcast('message', { conversation_id: conv.id });
  broadcast('conversation', { id: conv.id });
}

async function ingestDeliveryStatus({ channelKind, externalId, status, error }) {
  const order = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
  const row = await q.get('SELECT id, conversation_id, delivery_status FROM inbox_messages WHERE channel_kind = ? AND external_id = ?', channelKind, externalId);
  if (!row || !(status in order)) return;
  if (status !== 'failed' && order[status] <= (order[row.delivery_status] ?? -1)) return;
  await q.run('UPDATE inbox_messages SET delivery_status = ?, error = ? WHERE id = ?', status, error || null, row.id);
  broadcast('message', { conversation_id: row.conversation_id });
}

async function ingestComment({ channel, platform, comment }) {
  const r = await q.insert(
    `INSERT INTO inbox_comments (channel_id, platform, external_id, post_id, post_link, parent_external_id,
       author_external_id, author_name, body, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (platform, external_id) DO NOTHING RETURNING id`,
    channel.id, platform, comment.externalId, comment.postId || null, comment.postLink || null, comment.parentId || null,
    comment.authorId || null, comment.authorName || null, comment.text || '', Math.min(comment.createdAt || Date.now(), Date.now()),
  );
  if (r.id) broadcast('comment', { id: r.id });
  return r.id || null;
}

module.exports = { ingestInbound, ingestEcho, ingestDeliveryStatus, ingestComment, applyClassification, markExistingGuest };
