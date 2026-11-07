const { q, tx } = require('./db');
const { HttpError, badRequest, preview } = require('./http');
const { sendPageMessage, sendWhatsApp } = require('./meta');
const { recordResponse } = require('./sla');
const { broadcast } = require('./realtime');

const DAY = 24 * 3600 * 1000;

/** 24 hours after the customer's last message. Used to attach Meta's human-agent tag; sending is never blocked. */
function messagingWindow(conv, now = Date.now()) {
  if (!conv.last_inbound_at) return { open: false, closesAt: null };
  const closesAt = conv.last_inbound_at + DAY;
  return { open: now < closesAt, closesAt };
}

/** Meta's "outside of allowed window" errors, said in plain words with what to do next. */
function friendlySendError(err, conv, now) {
  const raw = err?.message || 'Send failed';
  const code = err?.meta?.code ?? err?.details?.code;
  const sub = err?.meta?.error_subcode ?? err?.details?.error_subcode;
  const windowError = /outside of allowed window|outside the allowed window|24 hour|re-engagement/i.test(raw) || sub === 2018278 || sub === 2534022 || code === 131047;
  if (!windowError) return raw;
  const hours = conv.last_inbound_at ? Math.floor((now - conv.last_inbound_at) / 3600000) : null;
  const ago = hours == null ? 'a while ago' : hours < 48 ? `${hours} hours ago` : `${Math.floor(hours / 24)} days ago`;
  if (conv.channel_kind === 'whatsapp') {
    return `The guest last wrote ${ago}. After 24 hours WhatsApp only allows an approved template message.`;
  }
  return `The guest last wrote ${ago}. Meta allows replies within 24 hours, or up to 7 days once the app has the Human Agent permission (Meta App Review). Ask the guest to message again, or call them.`;
}

/** Must run inside tx(): the savepoint keeps the transaction usable after a unique violation. */
async function storeExternalId(messageId, externalId, status, error) {
  await q.run('SAVEPOINT store_external_id');
  try {
    await q.run('UPDATE inbox_messages SET external_id = ?, delivery_status = ?, error = ? WHERE id = ?', externalId, status, error, messageId);
    await q.run('RELEASE SAVEPOINT store_external_id');
  } catch (err) {
    // The echo webhook beat us to it and stored the same platform id as an "external" message: keep ours.
    if (err.code !== '23505') throw err;
    await q.run('ROLLBACK TO SAVEPOINT store_external_id');
    const row = await q.get('SELECT channel_kind FROM inbox_messages WHERE id = ?', messageId);
    await q.run('DELETE FROM inbox_messages WHERE channel_kind = ? AND external_id = ? AND id <> ?', row.channel_kind, externalId, messageId);
    await q.run('UPDATE inbox_messages SET external_id = ?, delivery_status = ?, error = ? WHERE id = ?', externalId, status, error, messageId);
  }
}

/**
 * Send a message to the customer of a conversation.
 * senderType: 'agent' (a human - stops the SLA clock), 'ai' / 'auto' (after-hours, does not).
 */
async function sendToCustomer(conversationId, { text, attachment, template, senderType = 'agent', userId = null }) {
  const conv = await q.get('SELECT * FROM inbox_conversations WHERE id = ?', conversationId);
  if (!conv) throw new HttpError(404, 'Conversation not found');
  const channel = await q.get('SELECT * FROM inbox_channels WHERE id = ?', conv.channel_id);
  const identity = await q.get('SELECT * FROM inbox_customer_identities WHERE id = ?', conv.identity_id);
  const customer = await q.get('SELECT * FROM inbox_customers WHERE id = ?', conv.customer_id);
  const now = Date.now();

  if (!text && !attachment && !template) throw badRequest('Message is empty');
  if (text && text.length > 4000) throw badRequest('Message is too long (4000 characters max)');
  if (template && conv.channel_kind !== 'whatsapp') throw badRequest('Templates are only for WhatsApp');

  let tag = null;
  const win = messagingWindow(conv, now);
  const within7Days = conv.last_inbound_at && now - conv.last_inbound_at < 7 * DAY;
  const pageChannel = conv.channel_kind === 'messenger' || conv.channel_kind === 'instagram';
  if (!template && !win.open && !customer.is_simulated && pageChannel && !within7Days) {
    throw badRequest(
      'The guest last wrote more than 7 days ago. Messenger and Instagram don\u2019t allow a reply this late; wait for them to message again, or call them.',
      'window_closed',
    );
  }
  // Between 24 hours and 7 days after the guest's last message, Meta only delivers human replies sent with this tag.
  if (!template && !win.open && !customer.is_simulated && senderType === 'agent' && pageChannel && within7Days) {
    tag = 'HUMAN_AGENT';
  }

  const body = text || (template ? `[Template: ${template.name}]` : attachment?.caption || '');
  const attachments = attachment
    ? [{ type: attachment.mime?.split('/')[0] || 'file', url: attachment.url, mime: attachment.mime, filename: attachment.filename }]
    : null;
  const { id: messageId } = await q.insert(
    `INSERT INTO inbox_messages (conversation_id, direction, sender_type, user_id, channel_kind, body, attachments_json, delivery_status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    conversationId, 'out', senderType, userId, conv.channel_kind, body, attachments ? JSON.stringify(attachments) : null, 'pending', now,
  );
  let externalId = null;
  let error = null;
  try {
    if (customer.is_simulated) {
      externalId = `sim-out-${messageId}`;
    } else if (!channel?.active) {
      throw new Error('This channel is disabled');
    } else if (conv.channel_kind === 'whatsapp') {
      externalId = await sendWhatsApp(channel, identity.external_id, { text, attachment, template });
    } else {
      externalId = await sendPageMessage(channel, { id: identity.external_id }, { text, attachment, tag });
      if (attachment?.caption) {
        await sendPageMessage(channel, { id: identity.external_id }, { text: attachment.caption, tag });
      }
    }
  } catch (err) {
    error = friendlySendError(err, conv, now);
  }

  await tx(async () => {
    await storeExternalId(messageId, externalId, error ? 'failed' : 'sent', error);
    if (!error) {
      await q.run('UPDATE inbox_conversations SET last_message_at = ?, last_message_preview = ? WHERE id = ?', now, preview(body), conversationId);
      if (senderType === 'agent') await recordResponse(conversationId, userId, now);
    }
  });
  broadcast('message', { conversation_id: conversationId });
  broadcast('conversation', { id: conversationId });
  if (error) throw new HttpError(502, `Not delivered: ${error}`, 'send_failed');
  return q.get('SELECT * FROM inbox_messages WHERE id = ?', messageId);
}

module.exports = { messagingWindow, sendToCustomer };
