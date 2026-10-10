const { q } = require('./db');
const { ingestInbound, ingestEcho, ingestComment, ingestDeliveryStatus } = require('./ingest');

async function log(payload, error = null) {
  await q.run(
    'INSERT INTO inbox_webhook_log (object, received_at, payload, error) VALUES (?,?,?,?)',
    payload?.object || null, Date.now(), JSON.stringify(payload).slice(0, 20000), error,
  ).catch(() => {});
}

const channelBy = (kind, externalId) =>
  q.get('SELECT * FROM inbox_channels WHERE kind = ? AND external_id = ? AND active = 1', kind, String(externalId));

function pageAttachments(list = []) {
  return list
    .filter((a) => a.payload?.url)
    .map((a) => ({ type: a.type === 'file' ? 'file' : a.type, url: a.payload.url }));
}

// An ad click can arrive as its own event just before the customer's first message.
// Keep it briefly and attach it to that message so the chat is attributed to the ad.
const pendingReferrals = new Map(); // `${channelId}:${senderId}` -> { referral, at }

function takeReferral(channel, senderId) {
  const key = `${channel.id}:${senderId}`;
  const hit = pendingReferrals.get(key);
  pendingReferrals.delete(key);
  return hit && Date.now() - hit.at < 30 * 60000 ? hit.referral : null;
}

function pruneReferrals() {
  const cutoff = Date.now() - 30 * 60000;
  for (const [k, v] of pendingReferrals) if (v.at < cutoff) pendingReferrals.delete(k);
}

async function handleMessaging(channel, events) {
  for (const ev of events || []) {
    const msg = ev.message;
    if (!msg) {
      if (ev.referral && ev.sender?.id) {
        pruneReferrals();
        pendingReferrals.set(`${channel.id}:${ev.sender.id}`, { referral: ev.referral, at: Date.now() });
      }
      continue;
    }
    if (msg.is_deleted) continue;
    const message = {
      externalId: msg.mid,
      text: msg.text || (msg.quick_reply?.payload ?? ''),
      attachments: pageAttachments(msg.attachments),
      timestamp: ev.timestamp,
      referral: msg.referral || ev.referral || (msg.is_echo ? null : takeReferral(channel, ev.sender.id)),
      appId: msg.app_id,
    };
    if (msg.is_echo) await ingestEcho({ channel, recipientId: ev.recipient.id, message });
    else await ingestInbound({ channel, externalUserId: ev.sender.id, message });
  }
}

async function handlePage(payload) {
  for (const entry of payload.entry || []) {
    const channel = await channelBy('messenger', entry.id);
    if (!channel) continue;
    await handleMessaging(channel, entry.messaging);
    for (const change of entry.changes || []) {
      const v = change.value || {};
      if (change.field !== 'feed' || v.item !== 'comment' || v.verb !== 'add') continue;
      if (v.from?.id === entry.id) continue; // our own page replying
      await ingestComment({
        channel,
        platform: 'facebook',
        comment: {
          externalId: v.comment_id, postId: v.post_id, postLink: v.post?.permalink_url || null,
          parentId: v.parent_id !== v.post_id ? v.parent_id : null,
          authorId: v.from?.id, authorName: v.from?.name, text: v.message,
          createdAt: v.created_time ? v.created_time * 1000 : Date.now(),
        },
      });
    }
  }
}

async function handleInstagram(payload) {
  for (const entry of payload.entry || []) {
    const channel = await channelBy('instagram', entry.id);
    if (!channel) continue;
    await handleMessaging(channel, entry.messaging);
    for (const change of entry.changes || []) {
      const v = change.value || {};
      if (change.field !== 'comments') continue;
      if (v.from?.id === entry.id) continue;
      await ingestComment({
        channel,
        platform: 'instagram',
        comment: {
          externalId: v.id, postId: v.media?.id, parentId: v.parent_id || null,
          authorId: v.from?.id, authorName: v.from?.username, text: v.text, createdAt: Date.now(),
        },
      });
    }
  }
}

function waAttachments(m) {
  const media = m[m.type];
  if (!media?.id) return [];
  const type = m.type === 'document' ? 'file' : m.type === 'sticker' ? 'image' : m.type;
  return [{ type, mediaId: media.id, mime: media.mime_type, filename: media.filename }];
}

function waText(m) {
  switch (m.type) {
    case 'text': return m.text?.body || '';
    case 'image': case 'video': case 'document': return m[m.type]?.caption || '';
    case 'button': return m.button?.text || '';
    case 'interactive': return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || '';
    case 'location': return `📍 ${m.location?.name || ''} https://maps.google.com/?q=${m.location?.latitude},${m.location?.longitude}`;
    case 'contacts': return `👤 ${(m.contacts || []).map((c) => `${c.name?.formatted_name} ${c.phones?.[0]?.phone || ''}`).join(', ')}`;
    case 'reaction': return m.reaction?.emoji || '';
    default: return '';
  }
}

async function handleWhatsApp(payload) {
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      const channel = await channelBy('whatsapp', v.metadata?.phone_number_id);
      if (!channel) continue;
      const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of v.messages || []) {
        if (m.type === 'unsupported' || m.type === 'system') continue;
        await ingestInbound({
          channel,
          externalUserId: m.from,
          phone: m.from,
          profile: { name: names[m.from] || null },
          message: {
            externalId: m.id,
            text: waText(m),
            attachments: waAttachments(m),
            timestamp: Number(m.timestamp) * 1000,
            referral: m.referral || null,
          },
        });
      }
      for (const st of v.statuses || []) {
        await ingestDeliveryStatus({
          channelKind: 'whatsapp', externalId: st.id, status: st.status,
          error: st.errors?.map((e) => e.title || e.message).join('; '),
        });
      }
    }
  }
}

// Payloads are processed one at a time so a customer's burst of messages keeps its order.
let chain = Promise.resolve();

function processPayload(payload) {
  chain = chain.then(async () => {
    try {
      if (payload.object === 'page') await handlePage(payload);
      else if (payload.object === 'instagram') await handleInstagram(payload);
      else if (payload.object === 'whatsapp_business_account') await handleWhatsApp(payload);
      await log(payload);
    } catch (err) {
      console.error('[inbox] webhook processing failed', err);
      await log(payload, String(err.stack || err.message).slice(0, 2000));
    }
  });
  return chain;
}

module.exports = { processPayload };
