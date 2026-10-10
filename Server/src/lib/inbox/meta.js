const { config } = require('./config');
const { decrypt } = require('./security');

// Thin client for the official Meta Graph API (Messenger, Instagram Messaging, WhatsApp Cloud API).

const base = () => `https://graph.facebook.com/${config.meta.graphVersion}`;

class MetaError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

async function graph(path, { method = 'GET', token, body, query } = {}) {
  const url = new URL(`${base()}/${String(path).replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error || {};
    throw new MetaError(e.error_user_msg || e.message || `Meta API HTTP ${res.status}`, e);
  }
  return data;
}

function channelToken(channel) {
  const token = decrypt(channel.access_token_enc);
  if (!token) throw new MetaError(`Channel "${channel.name}" has no access token`);
  return token;
}

const attachmentType = (mime = '') =>
  mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'file';

/**
 * Messenger and Instagram DMs share the Send API (Instagram through the linked Page).
 * `tag` = 'HUMAN_AGENT' allows replies up to 7 days after the customer's last message,
 * only if the app was approved for the Human Agent permission.
 */
async function sendPageMessage(channel, recipient, { text, attachment, tag }) {
  const pageId = channel.kind === 'instagram' ? channel.page_id : channel.external_id;
  const message = attachment
    ? { attachment: { type: attachmentType(attachment.mime), payload: { url: attachment.url, is_reusable: true } } }
    : { text };
  const body = {
    recipient,
    message,
    messaging_type: tag ? 'MESSAGE_TAG' : 'RESPONSE',
    ...(tag ? { tag } : {}),
  };
  const data = await graph(`${pageId || 'me'}/messages`, { method: 'POST', token: channelToken(channel), body });
  return data.message_id;
}

async function sendWhatsApp(channel, to, { text, attachment, template }) {
  let payload;
  if (template) {
    payload = { type: 'template', template: { name: template.name, language: { code: template.language || 'ar' } } };
  } else if (attachment) {
    const type = attachmentType(attachment.mime) === 'file' ? 'document' : attachmentType(attachment.mime);
    payload = {
      type,
      [type]: {
        link: attachment.url,
        ...(attachment.caption && type !== 'audio' ? { caption: attachment.caption } : {}),
        ...(type === 'document' ? { filename: attachment.filename } : {}),
      },
    };
  } else {
    payload = { type: 'text', text: { body: text, preview_url: true } };
  }
  const data = await graph(`${channel.external_id}/messages`, {
    method: 'POST',
    token: channelToken(channel),
    body: { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload },
  });
  return data.messages?.[0]?.id;
}

async function replyToCommentPublicly(channel, platform, commentId, text) {
  const path = platform === 'instagram' ? `${commentId}/replies` : `${commentId}/comments`;
  const data = await graph(path, { method: 'POST', token: channelToken(channel), body: { message: text } });
  return data.id;
}

/** Private reply: one DM to the commenter, allowed once per comment within Meta's window (about 7 days). */
async function replyToCommentPrivately(channel, commentId, text) {
  return sendPageMessage(channel, { comment_id: commentId }, { text });
}

async function fetchProfile(channel, userId) {
  const fields = channel.kind === 'instagram' ? 'name,username,profile_pic' : 'first_name,last_name,profile_pic';
  const p = await graph(userId, { token: channelToken(channel), query: { fields } });
  return {
    name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' ') || p.username || null,
    username: p.username || null,
    avatar: p.profile_pic || null,
  };
}

/** WhatsApp media is fetched in two steps: id -> short-lived URL -> bytes (both need the token). */
async function downloadWhatsAppMedia(channel, mediaId) {
  const token = channelToken(channel);
  const meta = await graph(mediaId, { token });
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new MetaError(`Media download failed (${res.status})`);
  return { mime: meta.mime_type, buffer: Buffer.from(await res.arrayBuffer()) };
}

/** Subscribe a Facebook Page to this app's webhooks (messages, echoes, referrals, comments). */
async function subscribePage(channel) {
  const pageId = channel.kind === 'instagram' ? channel.page_id : channel.external_id;
  return graph(`${pageId}/subscribed_apps`, {
    method: 'POST',
    token: channelToken(channel),
    query: { subscribed_fields: 'messages,message_echoes,messaging_postbacks,messaging_referrals,feed' },
  });
}

async function subscribeWaba(channel) {
  if (!channel.waba_id) throw new MetaError('WhatsApp Business Account ID is required');
  return graph(`${channel.waba_id}/subscribed_apps`, { method: 'POST', token: channelToken(channel) });
}

async function checkChannel(channel) {
  const token = channelToken(channel);
  if (channel.kind === 'whatsapp') {
    const d = await graph(channel.external_id, { token, query: { fields: 'display_phone_number,verified_name,quality_rating' } });
    return `${d.verified_name || ''} ${d.display_phone_number || ''} (quality: ${d.quality_rating || 'n/a'})`.trim();
  }
  const d = await graph(channel.external_id, { token, query: { fields: channel.kind === 'instagram' ? 'username,name' : 'name' } });
  return d.username ? `@${d.username}` : d.name;
}

module.exports = {
  MetaError,
  sendPageMessage,
  sendWhatsApp,
  replyToCommentPublicly,
  replyToCommentPrivately,
  fetchProfile,
  downloadWhatsAppMedia,
  subscribePage,
  subscribeWaba,
  checkChannel,
};
