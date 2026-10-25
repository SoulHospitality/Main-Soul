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
  const token = channelToken(channel);
  const fields = channel.kind === 'instagram' ? 'name,username,profile_pic' : 'name,profile_pic';
  try {
    const p = await graph(userId, { token, query: { fields } });
    const name = p.name || p.username || null;
    if (name) return { name, username: p.username || null, avatar: p.profile_pic || null };
  } catch {
    // The user id often refuses a direct read. The thread participants include the name.
  }
  const pageId = channel.kind === 'instagram' ? channel.page_id : channel.external_id;
  const data = await graph(`${pageId}/conversations`, {
    token,
    query: {
      platform: channel.kind === 'instagram' ? 'instagram' : 'messenger',
      user_id: String(userId),
      fields: 'participants',
    },
  });
  const people = data.data?.[0]?.participants?.data || [];
  const person = people.find((p) => String(p.id) === String(userId))
    || people.find((p) => String(p.id) !== String(pageId));
  if (!person?.name && !person?.username) throw new MetaError('Meta did not return a name for this guest');
  return { name: person.name || person.username, username: person.username || null, avatar: null };
}

/** WhatsApp media is fetched in two steps: id -> short-lived URL -> bytes (both need the token). */
async function downloadWhatsAppMedia(channel, mediaId) {
  const token = channelToken(channel);
  const meta = await graph(mediaId, { token });
  const res = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new MetaError(`Media download failed (${res.status})`);
  return { mime: meta.mime_type, buffer: Buffer.from(await res.arrayBuffer()) };
}

/** Page tokens are the long EAA string. App IDs, secrets, and verify tokens are not. */
function pageToken(raw) {
  const token = String(raw || '').trim().replace(/^Bearer\s+/i, '').replace(/\s+/g, '');
  if (!token.startsWith('EAA') || token.length < 40) {
    throw new MetaError('That is not a Page access token. Paste the long token that starts with EAA, the same kind Messenger uses. The app ID, app secret, and verify token will not work here.');
  }
  return token;
}

/** The Instagram professional account linked to a Facebook Page. */
async function instagramAccount(pageId, token) {
  const clean = pageToken(token);
  let data;
  try {
    // The Page name field requires pages_read_engagement. The linked account id does not.
    data = await graph(String(pageId).trim(), {
      token: clean,
      query: { fields: 'instagram_business_account{id,username}' },
    });
  } catch (err) {
    if (/Cannot parse access token/i.test(err.message || '')) {
      throw new MetaError('Meta could not read that access token. Paste only the Page token, the long value that starts with EAA.');
    }
    if (/pages_read_engagement|Page Public/i.test(err.message || '')) {
      throw new MetaError('This Page token cannot see the linked Instagram account. In Graph API Explorer, generate a new Page token for this Page and include pages_show_list, pages_read_engagement, and instagram_basic.');
    }
    throw err;
  }
  const ig = data.instagram_business_account;
  if (!ig?.id) throw new MetaError('This Facebook Page has no linked Instagram professional account');
  return { id: String(ig.id), username: ig.username || null, name: ig.username || 'Instagram', pageName: null };
}

/** Subscribe a Facebook Page, or the linked Instagram account, to this app's webhooks. */
async function subscribePage(channel) {
  const token = channelToken(channel);
  if (channel.kind === 'instagram') {
    const fields = 'messages,message_echoes,messaging_postbacks,message_reads,messaging_referrals,message_reactions';
    const page = await graph(`${channel.page_id}/subscribed_apps`, {
      method: 'POST',
      token,
      query: { subscribed_fields: fields },
    });
    let instagram = null;
    try {
      instagram = await graph(`${channel.external_id}/subscribed_apps`, {
        method: 'POST',
        token,
        query: { subscribed_fields: fields },
      });
    } catch (err) {
      instagram = { warning: err.message };
    }
    return { page, instagram };
  }
  return graph(`${channel.external_id}/subscribed_apps`, {
    method: 'POST',
    token,
    query: { subscribed_fields: 'messages,message_echoes,messaging_postbacks,messaging_referrals' },
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
  const pageId = channel.kind === 'instagram' ? channel.page_id : channel.external_id;
  // Reading the Page name requires pages_read_engagement. Managing webhooks does not.
  await graph(`${pageId}/subscribed_apps`, { token });
  return channel.name;
}

module.exports = {
  MetaError,
  sendPageMessage,
  sendWhatsApp,
  replyToCommentPublicly,
  replyToCommentPrivately,
  fetchProfile,
  downloadWhatsAppMedia,
  pageToken,
  instagramAccount,
  subscribePage,
  subscribeWaba,
  checkChannel,
};
