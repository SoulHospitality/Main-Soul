const express = require('express');
const multer = require('multer');
const { q, tx, audit, parseJson } = require('../../../lib/inbox/db');
const { HttpError, badRequest, forbidden, int, normalizePhone, notFound, wrap } = require('../../../lib/inbox/http');
const { can } = require('../../../lib/inbox/permissions');
const { getSettings } = require('../../../lib/inbox/settings');
const { assign } = require('../../../lib/inbox/assignment');
const { broadcast, viewersSnapshot } = require('../../../lib/inbox/realtime');
const { messagingWindow, sendToCustomer } = require('../../../lib/inbox/outbound');
const { createLead } = require('../../../lib/inbox/leads');
const { aiAvailable, classify, suggestReply, summarize } = require('../../../lib/inbox/ai');
const { applyClassification, markExistingGuest } = require('../../../lib/inbox/ingest');
const { downloadWhatsAppMedia } = require('../../../lib/inbox/meta');
const { guestHistory, availabilityFacts } = require('../../../lib/inbox/pmsLink');
const { loadConversation, ensureCanAct, visibilitySql } = require('./common');

const router = express.Router();

const TYPES = ['unknown', 'sales_lead', 'existing_guest', 'owner', 'broker', 'complaint', 'supplier', 'spam', 'other'];

const LIST_SELECT = `
  SELECT c.id, c.status, c.type, c.priority, c.channel_kind, c.assigned_user_id, c.awaiting_since, c.sla_start_at,
         c.sla_due_at, c.sla_breached, c.escalation_level, c.last_message_at, c.last_inbound_at, c.last_message_preview,
         c.unread_count, c.snooze_until, c.current_lead_id, c.source,
         cu.name AS customer_name, cu.avatar_url, cu.phone,
         ch.name AS channel_name, u.name AS assigned_name,
         l.stage_key, l.temperature
  FROM inbox_conversations c
  JOIN inbox_customers cu ON cu.id = c.customer_id
  JOIN inbox_channels ch ON ch.id = c.channel_id
  LEFT JOIN inbox_users u ON u.id = c.assigned_user_id
  LEFT JOIN inbox_leads l ON l.id = c.current_lead_id`;

router.get('/conversations', wrap(async (req, res) => {
  const user = req.inbox;
  const { view = 'mine', channel, assigned, stage, search, type } = req.query;
  const vis = visibilitySql(user);
  const where = [vis.sql];
  const params = [...vis.params];
  const now = Date.now();

  switch (view) {
    case 'mine': where.push("c.assigned_user_id = ? AND c.status <> 'closed'"); params.push(user.id); break;
    case 'unassigned': where.push("c.assigned_user_id IS NULL AND c.status <> 'closed'"); break;
    case 'needs_reply': where.push("c.status = 'needs_reply'"); break;
    case 'overdue': where.push("c.status = 'needs_reply' AND c.sla_due_at IS NOT NULL AND c.sla_due_at <= ?"); params.push(now); break;
    case 'waiting': where.push("c.status = 'waiting_customer'"); break;
    case 'snoozed': where.push("c.status = 'snoozed'"); break;
    case 'closed': where.push("c.status = 'closed'"); break;
    case 'hot': where.push("l.temperature = 'hot' AND c.status <> 'closed'"); break;
    default: where.push("c.status <> 'closed'");
  }
  if (channel) { where.push('c.channel_kind = ?'); params.push(String(channel)); }
  if (type) { where.push('c.type = ?'); params.push(String(type)); }
  if (assigned === 'none') where.push('c.assigned_user_id IS NULL');
  else if (assigned) { where.push('c.assigned_user_id = ?'); params.push(Number(assigned) || 0); }
  if (stage) { where.push('l.stage_key = ?'); params.push(String(stage)); }
  if (search) {
    const term = String(search).trim().slice(0, 100);
    const like = `%${term.replace(/[%_\\]/g, '\\$&')}%`;
    const digits = term.replace(/\D/g, '');
    where.push(`(cu.name ILIKE ? OR cu.phone LIKE ? OR c.id = ? OR EXISTS (
      SELECT 1 FROM inbox_messages m WHERE m.conversation_id = c.id AND m.body ILIKE ?))`);
    params.push(like, digits ? `%${digits}%` : like, /^\d{1,9}$/.test(term) ? Number(term) : -1, like);
  }

  // Customers waiting longest first, then most recent activity.
  const rows = await q.all(
    `${LIST_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY CASE WHEN c.status = 'needs_reply' THEN 0 ELSE 1 END, COALESCE(c.sla_due_at, 9000000000000000) ASC,
              c.last_message_at DESC NULLS LAST
     LIMIT 300`,
    ...params,
  );

  const counts = await q.get(
    `SELECT
       COUNT(*) FILTER (WHERE c.assigned_user_id = ? AND c.status <> 'closed') AS mine,
       COUNT(*) FILTER (WHERE c.assigned_user_id IS NULL AND c.status <> 'closed') AS unassigned,
       COUNT(*) FILTER (WHERE c.status = 'needs_reply') AS needs_reply,
       COUNT(*) FILTER (WHERE c.status = 'needs_reply' AND c.sla_due_at <= ?) AS overdue,
       COUNT(*) FILTER (WHERE c.status = 'waiting_customer') AS waiting,
       COUNT(*) FILTER (WHERE c.status = 'snoozed') AS snoozed
     FROM inbox_conversations c WHERE ${vis.sql}`,
    user.id, now, ...vis.params,
  );
  res.json({ items: rows, counts, viewers: viewersSnapshot(), now });
}));

async function timeline(convId) {
  const rows = await q.all(
    `SELECT e.id, e.type, e.data_json, e.at, e.user_id, u.name AS user_name FROM inbox_events e
     LEFT JOIN inbox_users u ON u.id = e.user_id
     WHERE e.conversation_id = ? OR e.lead_id IN (SELECT id FROM inbox_leads WHERE conversation_id = ?)
     ORDER BY e.at, e.id LIMIT 500`,
    convId, convId,
  );
  return rows.map((e) => ({ ...e, data: parseJson(e.data_json), data_json: undefined }));
}

router.get('/conversations/:id', wrap(async (req, res) => {
  const conv = await loadConversation(int(req.params.id), req.inbox);
  const customer = await q.get('SELECT * FROM inbox_customers WHERE id = ?', conv.customer_id);
  const messages = await q.all(
    `SELECT * FROM (
       SELECT m.*, u.name AS user_name FROM inbox_messages m LEFT JOIN inbox_users u ON u.id = m.user_id
       WHERE m.conversation_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 500
     ) t ORDER BY created_at, id`,
    conv.id,
  );
  const notes = await q.all(
    `SELECT n.*, u.name AS user_name FROM inbox_notes n LEFT JOIN inbox_users u ON u.id = n.user_id
     WHERE n.conversation_id = ? ORDER BY n.created_at`,
    conv.id,
  );
  const leads = await q.all(
    `SELECT l.*, u.name AS owner_name, un.title AS unit_title, un.unit_number AS unit_number
     FROM inbox_leads l LEFT JOIN inbox_users u ON u.id = l.owner_user_id
     LEFT JOIN units un ON un.id = l.unit_id
     WHERE l.customer_id = ? ORDER BY l.created_at DESC`,
    conv.customer_id,
  );
  const leadIds = leads.map((l) => l.id);
  const stageHistory = leadIds.length
    ? await q.all(
      `SELECT h.*, u.name AS user_name FROM inbox_lead_stage_history h LEFT JOIN inbox_users u ON u.id = h.user_id
       WHERE h.lead_id = ANY(?::int[]) ORDER BY h.at`,
      leadIds,
    )
    : [];
  const followUps = await q.all(
    `SELECT f.*, u.name AS assigned_name FROM inbox_follow_ups f LEFT JOIN inbox_users u ON u.id = f.assigned_user_id
     WHERE f.conversation_id = ? OR f.lead_id IN (SELECT id FROM inbox_leads WHERE customer_id = ?) ORDER BY f.due_at DESC`,
    conv.id, conv.customer_id,
  );
  const responses = await q.all(
    `SELECT r.*, u.name AS user_name FROM inbox_responses r LEFT JOIN inbox_users u ON u.id = r.user_id
     WHERE r.conversation_id = ? ORDER BY r.responded_at`,
    conv.id,
  );
  const otherConversations = await q.all(
    `SELECT c.id, c.channel_kind, c.status, c.last_message_at, ch.name AS channel_name FROM inbox_conversations c
     JOIN inbox_channels ch ON ch.id = c.channel_id WHERE c.customer_id = ? AND c.id <> ? ORDER BY c.last_message_at DESC NULLS LAST`,
    conv.customer_id, conv.id,
  );
  res.json({
    conversation: {
      ...conv,
      ai: parseJson(conv.ai_json),
      ai_summary: parseJson(conv.ai_summary),
      ad_ref: parseJson(conv.ad_ref_json),
      window: messagingWindow(conv),
      ai_json: undefined,
      ad_ref_json: undefined,
    },
    channel: await q.get('SELECT id, kind, name FROM inbox_channels WHERE id = ?', conv.channel_id),
    customer,
    identities: await q.all(
      `SELECT i.channel_kind, i.external_id, i.display_name, i.username, ch.name AS channel_name
       FROM inbox_customer_identities i JOIN inbox_channels ch ON ch.id = i.channel_id WHERE i.customer_id = ?`,
      conv.customer_id,
    ),
    messages: messages.map((m) => ({ ...m, attachments: parseJson(m.attachments_json, []), attachments_json: undefined })),
    notes,
    leads,
    stageHistory,
    followUps,
    responses,
    otherConversations,
    timeline: await timeline(conv.id),
    now: Date.now(),
  });
}));

/** PMS stays for this customer's phone: past guests, upcoming arrivals and in-house guests. */
router.get('/conversations/:id/guest', wrap(async (req, res) => {
  const conv = await loadConversation(int(req.params.id), req.inbox);
  const customer = await q.get('SELECT phone FROM inbox_customers WHERE id = ?', conv.customer_id);
  if (!customer?.phone) return res.json({ phone: null, reservations: [], bookings: [] });
  res.json({ phone: customer.phone, ...(await guestHistory(customer.phone)) });
}));

router.post('/conversations/:id/messages', wrap(async (req, res) => {
  const conv = await loadConversation(int(req.params.id), req.inbox);
  await ensureCanAct(conv, req.inbox);
  const { text, template } = req.body || {};
  const message = await sendToCustomer(conv.id, {
    text: typeof text === 'string' ? text.trim() : undefined,
    template: template?.name ? { name: String(template.name).slice(0, 200), language: String(template.language || 'ar').slice(0, 10) } : undefined,
    senderType: 'agent',
    userId: req.inbox.id,
  });
  res.json({ message });
}));

const ALLOWED_MIME = /^(image\/(jpeg|png|webp|gif)|video\/mp4|audio\/(mpeg|ogg|aac|mp4)|application\/pdf)$/;
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!ALLOWED_MIME.test(file.mimetype || '')) return cb(new HttpError(400, 'Allowed: JPG, PNG, WEBP, GIF, MP4, MP3/OGG audio, PDF'));
    return cb(null, true);
  },
});

function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    attachmentUpload.single('file')(req, res, (err) => {
      if (!err) return resolve();
      if (err.code === 'LIMIT_FILE_SIZE') return reject(badRequest('File must be under 16 MB'));
      return reject(err instanceof HttpError ? err : badRequest(err.message));
    });
  });
}

router.post('/conversations/:id/attachments', wrap(async (req, res) => {
  const conv = await loadConversation(int(req.params.id), req.inbox);
  await ensureCanAct(conv, req.inbox);
  await runUpload(req, res);
  if (!req.file?.buffer?.length) throw badRequest('Choose a file');
  const { uploadBufferToCloudinary } = require('../../../config/cloudinary');
  const uploaded = await uploadBufferToCloudinary(req.file.buffer, req.file.originalname, req.file.mimetype, {
    folder: 'soul-hospitality/inbox',
  });
  const caption = req.body?.caption ? String(req.body.caption).slice(0, 1000) : undefined;
  const message = await sendToCustomer(conv.id, {
    attachment: {
      url: uploaded.secure_url,
      mime: req.file.mimetype,
      filename: String(req.file.originalname || 'file').slice(0, 100),
      caption,
    },
    senderType: 'agent',
    userId: req.inbox.id,
  });
  res.json({ message });
}));

/** WhatsApp media needs the channel token, so the browser loads it through us. */
router.get('/media/wa/:messageId/:index', wrap(async (req, res) => {
  const msg = await q.get('SELECT * FROM inbox_messages WHERE id = ?', int(req.params.messageId));
  if (!msg) throw notFound();
  const conv = await loadConversation(msg.conversation_id, req.inbox);
  const att = parseJson(msg.attachments_json, [])[Number(req.params.index)];
  if (!att?.mediaId) throw notFound();
  const channel = await q.get('SELECT * FROM inbox_channels WHERE id = ?', conv.channel_id);
  const media = await downloadWhatsAppMedia(channel, att.mediaId);
  res.setHeader('Content-Type', media.mime || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(media.buffer);
}));

router.post('/conversations/:id/notes', wrap(async (req, res) => {
  const conv = await loadConversation(int(req.params.id), req.inbox);
  const body = String(req.body?.body || '').trim();
  if (!body) throw badRequest('Note is empty');
  const { id } = await q.insert(
    'INSERT INTO inbox_notes (conversation_id, user_id, body, created_at) VALUES (?,?,?,?)',
    conv.id, req.inbox.id, body.slice(0, 4000), Date.now(),
  );
  await audit({ conversationId: conv.id, userId: req.inbox.id, type: 'note_added', data: { note_id: id } });
  // @mentions: "@Name" of a teammate notifies them.
  const mentioned = (await q.all('SELECT id, name FROM inbox_users WHERE active = 1 AND role IS NOT NULL'))
    .filter((u) => u.id !== req.inbox.id && u.name && body.toLowerCase().includes(`@${u.name.toLowerCase()}`))
    .map((u) => u.id);
  if (mentioned.length) {
    const { notify } = require('../../../lib/inbox/realtime');
    await notify(mentioned, { kind: 'mention', title: `${req.inbox.name} mentioned you`, body: body.slice(0, 200), conversationId: conv.id });
  }
  broadcast('conversation', { id: conv.id });
  res.json({ ok: true, id });
}));

router.post('/conversations/:id/assign', wrap(async (req, res) => {
  const conv = await loadConversation(int(req.params.id), req.inbox);
  const to = req.body?.user_id ? int(req.body.user_id, 'user') : null;
  if (!can(req.inbox, 'conv.assign')) {
    // Agents may only hand their own chat to someone else or claim an unassigned one.
    const ownChat = conv.assigned_user_id === req.inbox.id;
    const claiming = conv.assigned_user_id === null && to === req.inbox.id && getSettings().allow_agent_claim;
    if (!ownChat && !claiming) throw forbidden('Only supervisors can reassign');
  }
  if (to && !(await q.get('SELECT 1 AS x FROM inbox_users WHERE id = ? AND active = 1 AND role IS NOT NULL', to))) {
    throw badRequest('User not found');
  }
  const reason = to === req.inbox.id ? (conv.assigned_user_id ? 'takeover' : 'claim') : 'manual';
  res.json({ conversation: await assign(conv.id, to, { byUserId: req.inbox.id, reason }) });
}));

router.post('/conversations/:id/status', wrap(async (req, res) => {
  const conv = await loadConversation(int(req.params.id), req.inbox);
  await ensureCanAct(conv, req.inbox);
  const { status } = req.body || {};
  if (!['needs_reply', 'waiting_customer', 'snoozed', 'closed'].includes(status)) throw badRequest('Invalid status');
  let snoozeUntil = null;
  if (status === 'snoozed') {
    snoozeUntil = Number(req.body.snooze_until);
    if (!Number.isFinite(snoozeUntil) || snoozeUntil <= Date.now()) throw badRequest('Choose when the chat should come back');
  }
  const fresh = await q.get('SELECT type FROM inbox_conversations WHERE id = ?', conv.id);
  if (status === 'closed' && fresh.type === 'unknown') {
    throw badRequest('Set the conversation type before closing it', 'type_required');
  }
  const now = Date.now();
  const closing = status === 'closed';
  await tx(async () => {
    await q.run(
      `UPDATE inbox_conversations SET status = ?, snooze_until = ?, closed_at = ?,
         awaiting_since = CASE WHEN ?::int = 1 THEN NULL ELSE awaiting_since END,
         sla_start_at = CASE WHEN ?::int = 1 THEN NULL ELSE sla_start_at END,
         sla_due_at = CASE WHEN ?::int = 1 THEN NULL ELSE sla_due_at END
       WHERE id = ?`,
      status, snoozeUntil, closing ? now : null, closing, closing, closing, conv.id,
    );
    await audit({
      conversationId: conv.id, userId: req.inbox.id, type: 'status_changed',
      data: {
        from: conv.status, to: status, snooze_until: snoozeUntil || undefined,
        closed_without_reply: closing && conv.awaiting_since ? true : undefined,
      },
    });
  });
  broadcast('conversation', { id: conv.id });
  res.json({ ok: true });
}));

router.post('/conversations/:id/type', wrap(async (req, res) => {
  const conv = await loadConversation(int(req.params.id), req.inbox);
  await ensureCanAct(conv, req.inbox);
  const { type, priority } = req.body || {};
  if (type !== undefined && !TYPES.includes(type)) throw badRequest('Invalid type');
  if (priority !== undefined && !['normal', 'high', 'urgent'].includes(priority)) throw badRequest('Invalid priority');
  await q.run(
    'UPDATE inbox_conversations SET type = COALESCE(?, type), priority = COALESCE(?, priority) WHERE id = ?',
    type ?? null, priority ?? null, conv.id,
  );
  await audit({ conversationId: conv.id, userId: req.inbox.id, type: 'classified', data: { type, priority } });
  broadcast('conversation', { id: conv.id });
  res.json({ ok: true });
}));

router.post('/conversations/:id/read', wrap(async (req, res) => {
  const conv = await loadConversation(int(req.params.id), req.inbox);
  if (conv.assigned_user_id === req.inbox.id && conv.unread_count) {
    await q.run('UPDATE inbox_conversations SET unread_count = 0 WHERE id = ?', conv.id);
  }
  res.json({ ok: true });
}));

router.post('/conversations/:id/leads', wrap(async (req, res) => {
  const conv = await loadConversation(int(req.params.id), req.inbox);
  await ensureCanAct(conv, req.inbox);
  const lead = await createLead({ conversationId: conv.id, customerId: conv.customer_id, userId: req.inbox.id, fields: req.body || {} });
  res.json({ lead });
}));

router.post('/conversations/:id/current-lead', wrap(async (req, res) => {
  const conv = await loadConversation(int(req.params.id), req.inbox);
  const leadId = int(req.body?.lead_id, 'lead');
  if (!(await q.get('SELECT 1 AS x FROM inbox_leads WHERE id = ? AND customer_id = ?', leadId, conv.customer_id))) {
    throw badRequest('Lead not found');
  }
  await q.run('UPDATE inbox_conversations SET current_lead_id = ? WHERE id = ?', leadId, conv.id);
  broadcast('conversation', { id: conv.id });
  res.json({ ok: true });
}));

router.patch('/customers/:id', wrap(async (req, res) => {
  const id = int(req.params.id);
  const customer = await q.get('SELECT * FROM inbox_customers WHERE id = ?', id);
  if (!customer) throw notFound();
  const allowed = can(req.inbox, 'conv.view_all')
    || await q.get('SELECT 1 AS x FROM inbox_conversations WHERE customer_id = ? AND assigned_user_id = ?', id, req.inbox.id);
  if (!allowed) throw forbidden();
  const b = req.body || {};
  const patch = {};
  if ('name' in b) patch.name = String(b.name || '').trim().slice(0, 120) || null;
  if ('phone' in b) {
    patch.phone = b.phone ? normalizePhone(b.phone) : null;
    if (b.phone && !patch.phone) throw badRequest('Invalid phone number');
  }
  if ('email' in b) patch.email = String(b.email || '').trim().slice(0, 200) || null;
  if ('notes' in b) patch.notes = String(b.notes || '').slice(0, 4000) || null;
  const keys = Object.keys(patch);
  if (!keys.length) return res.json({ customer });
  await q.run(
    `UPDATE inbox_customers SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    ...keys.map((k) => patch[k]), Date.now(), id,
  );
  const changes = Object.fromEntries(keys.filter((k) => customer[k] !== patch[k]).map((k) => [k, { from: customer[k], to: patch[k] }]));
  const conv = await q.get('SELECT id FROM inbox_conversations WHERE customer_id = ? ORDER BY last_message_at DESC NULLS LAST LIMIT 1', id);
  await audit({ conversationId: conv?.id, userId: req.inbox.id, type: 'customer_updated', data: changes });
  if (conv && patch.phone && patch.phone !== customer.phone) await markExistingGuest(conv.id, id);
  if (conv) broadcast('conversation', { id: conv.id });
  res.json({ customer: await q.get('SELECT * FROM inbox_customers WHERE id = ?', id) });
}));

// ---- AI helpers (assistive: results are shown to the agent, never sent automatically)
function requireAi() {
  if (!aiAvailable()) throw new HttpError(503, 'AI is not configured');
}

router.post('/conversations/:id/ai/suggest', wrap(async (req, res) => {
  requireAi();
  const conv = await loadConversation(int(req.params.id), req.inbox);
  const lead = conv.current_lead_id ? await q.get('SELECT * FROM inbox_leads WHERE id = ?', conv.current_lead_id) : null;
  const facts = await availabilityFacts(lead).catch(() => '');
  res.json({ text: await suggestReply(conv.id, req.inbox.name, facts) });
}));

router.post('/conversations/:id/ai/summary', wrap(async (req, res) => {
  requireAi();
  const conv = await loadConversation(int(req.params.id), req.inbox);
  res.json({ summary: await summarize(conv.id) });
}));

router.post('/conversations/:id/ai/classify', wrap(async (req, res) => {
  requireAi();
  const conv = await loadConversation(int(req.params.id), req.inbox);
  const result = await classify(conv.id);
  await applyClassification(conv.id, result);
  res.json({ result });
}));

module.exports = router;
