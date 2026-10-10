const { q, tx } = require('./db');
const { HttpError, badRequest, preview } = require('./http');
const { getSettings } = require('./settings');
const { sendPageMessage, sendWhatsApp } = require('./meta');
const { recordResponse } = require('./sla');
const { broadcast } = require('./realtime');

const DAY = 24 * 3600 * 1000;

/** Meta only allows free-form replies within 24h of the customer's last message. */
function messagingWindow(conv, now = Date.now()) {
  if (!conv.last_inbound_at) return { open: false, closesAt: null };
  const closesAt = conv.last_inbound_at + DAY;
  return { open: now < closesAt, closesAt };
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
  if (!template && !win.open && !customer.is_simulated) {
    if (conv.channel_kind === 'whatsapp') {
      throw new HttpError(409, 'The 24-hour window is closed. WhatsApp only allows an approved template now.', 'window_closed');
    }
    const within7Days = conv.last_inbound_at && now - conv.last_inbound_at < 7 * DAY;
    if (getSettings().messenger_human_agent_tag && within7Days && senderType === 'agent') {
      tag = 'HUMAN_AGENT';
    } else {
      throw new HttpError(409, 'The 24-hour window is closed. Meta does not allow messaging this customer until they write again.', 'window_closed');
    }
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
  broadcast('message', { conversation_id: conversationId });

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
    error = err.message || 'Send failed';
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
