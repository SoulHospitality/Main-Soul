const express = require('express');
const multer = require('multer');
const { q, tx, audit, parseJson } = require('../../../lib/inbox/db');
const { HttpError, badRequest, forbidden, int, normalizePhone, notFound, wrap } = require('../../../lib/inbox/http');
const { can } = require('../../../lib/inbox/permissions');
const { addAssignee, removeAssignee, listAssignees } = require('../../../lib/inbox/assignment');
const { broadcast, viewersSnapshot } = require('../../../lib/inbox/realtime');
const { messagingWindow, sendToCustomer } = require('../../../lib/inbox/outbound');
const { createLead } = require('../../../lib/inbox/leads');
const { aiAvailable, classify, suggestReply, summarize } = require('../../../lib/inbox/ai');
const { applyClassification, markExistingGuest } = require('../../../lib/inbox/ingest');
const { downloadWhatsAppMedia, fetchProfile } = require('../../../lib/inbox/meta');
const { guestHistory, availabilityFacts } = require('../../../lib/inbox/pmsLink');
const { fillPlaceholders } = require('../../../lib/inbox/templates');
const { loadConversation, ensureCanAct, visibilitySql, onChatSql } = require('./common');

const router = express.Router();

const TYPES = ['unknown', 'sales_lead', 'existing_guest', 'owner', 'broker', 'complaint', 'supplier', 'spam', 'other'];

function publicMessage(row) {
  if (!row) return row;
  return { ...row, attachments: parseJson(row.attachments_json, []), attachments_json: undefined };
}

async function personalize(text, conv, agent) {
  if (typeof text !== 'string' || !text.includes('{{')) return text;
  const customer = await q.get('SELECT name FROM inbox_customers WHERE id = ?', conv.customer_id);
  return fillPlaceholders(text, { agentName: agent?.name, customerName: customer?.name });
}

const LIST_SELECT = `
  SELECT c.id, c.status, c.type, c.priority, c.channel_kind, c.assigned_user_id, c.awaiting_since, c.sla_start_at,
         c.sla_due_at, c.sla_breached, c.escalation_level, c.last_message_at, c.last_inbound_at, c.last_message_preview,
         c.unread_count, c.snooze_until, c.current_lead_id, c.source,
         cu.name AS customer_name, cu.avatar_url, cu.phone,
         ch.name AS channel_name, u.name AS assigned_name,
         l.stage_key, l.temperature,
         COALESCE((
           SELECT json_agg(json_build_object('id', a.user_id, 'name', iu.name) ORDER BY a.assigned_at)
           FROM inbox_conversation_assignees a
           JOIN inbox_users iu ON iu.id = a.user_id
           WHERE a.conversation_id = c.id
         ), '[]'::json) AS assignees
  FROM inbox_conversations c
  JOIN inbox_customers cu ON cu.id = c.customer_id
  JOIN inbox_channels ch ON ch.id = c.channel_id
  LEFT JOIN inbox_users u ON u.id = c.assigned_user_id
  LEFT JOIN inbox_leads l ON l.id = c.current_lead_id`;

router.get('/conversations', wrap(async (req, res) => {
  const user = req.inbox;
  const channel = req.query.channel || req.query.channel_kind;
  const search = req.query.search || req.query.q;
  const { view = 'mine', assigned, stage, type } = req.query;
  const vis = visibilitySql(user);
  const where = [vis.sql];
  const params = [...vis.params];
  const now = Date.now();

  switch (view) {
    case 'all': break;
    case 'mine': where.push(`${onChatSql()} AND c.status <> 'closed'`); params.push(user.id, user.id); break;
    case 'unassigned': where.push(`c.status <> 'closed' AND c.assigned_user_id IS NULL AND NOT EXISTS (
      SELECT 1 FROM inbox_conversation_assignees a WHERE a.conversation_id = c.id)`); break;
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
  if (assigned === 'none') {
    where.push(`c.assigned_user_id IS NULL AND NOT EXISTS (
      SELECT 1 FROM inbox_conversation_assignees a WHERE a.conversation_id = c.id)`);
  } else if (assigned) { where.push(onChatSql()); params.push(Number(assigned) || 0, Number(assigned) || 0); }
  if (stage) { where.push('l.stage_key = ?'); params.push(String(stage)); }
  if (search) {
    const term = String(search).trim().slice(0, 100);
    const like = `%${term.replace(/[%_\\]/g, '\\$&')}%`;
    const digits = term.replace(/\D/g, '');
    where.push('(cu.name ILIKE ? OR cu.phone LIKE ? OR c.id = ?)');
    params.push(like, digits ? `%${digits}%` : like, /^\d{1,9}$/.test(term) ? Number(term) : -1);
  }

  // Customers waiting longest first, then most recent activity.
  async function fillGuestNames(items) {
    const missing = items.filter((row) => !row.customer_name && (row.channel_kind === 'messenger' || row.channel_kind === 'instagram')).slice(0, 8);
    await Promise.all(missing.map(async (row) => {
      try {
        const identity = await q.get(
          `SELECT i.id, i.external_id FROM inbox_customer_identities i
           JOIN inbox_conversations c ON c.identity_id = i.id WHERE c.id = ?`,
          row.id,
        );
        const channel = await q.get('SELECT * FROM inbox_channels WHERE id = (SELECT channel_id FROM inbox_conversations WHERE id = ?)', row.id);
        if (!identity?.external_id || !channel) return;
        const profile = await fetchProfile(channel, identity.external_id);
        if (!profile?.name) return;
        await q.run(
          `UPDATE inbox_customers SET name = COALESCE(name, ?), avatar_url = COALESCE(avatar_url, ?), updated_at = ?
           WHERE id = (SELECT customer_id FROM inbox_conversations WHERE id = ?)`,
          profile.name, profile.avatar, Date.now(), row.id,
        );
        await q.run(
          'UPDATE inbox_customer_identities SET display_name = COALESCE(display_name, ?), username = COALESCE(username, ?) WHERE id = ?',
          profile.name, profile.username, identity.id,
        );
        row.customer_name = profile.name;
        if (!row.avatar_url && profile.avatar) row.avatar_url = profile.avatar;
      } catch (err) {
        console.warn('[inbox] name lookup failed:', err.message);
      }
    }));
  }

  const rows = await q.all(
    `${LIST_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY CASE WHEN c.status = 'needs_reply' THEN 0 ELSE 1 END, COALESCE(c.sla_due_at, 9000000000000000) ASC,
              c.last_message_at DESC NULLS LAST
     LIMIT ${view === 'all' ? 200 : 80}`,
    ...params,
  );
  await fillGuestNames(rows);

  const counts = await q.get(
    `SELECT
       COUNT(*) AS "all",
       COUNT(*) FILTER (WHERE ${onChatSql()} AND c.status <> 'closed') AS mine,
       COUNT(*) FILTER (WHERE c.assigned_user_id IS NULL AND c.status <> 'closed' AND NOT EXISTS (
         SELECT 1 FROM inbox_conversation_assignees a WHERE a.conversation_id = c.id)) AS unassigned,
       COUNT(*) FILTER (WHERE c.status = 'needs_reply') AS needs_reply,
       COUNT(*) FILTER (WHERE c.status = 'needs_reply' AND c.sla_due_at <= ?) AS overdue,
       COUNT(*) FILTER (WHERE c.status = 'waiting_customer') AS waiting,
       COUNT(*) FILTER (WHERE c.status = 'snoozed') AS snoozed
     FROM inbox_conversations c WHERE ${vis.sql}`,
    user.id, user.id, now, ...vis.params,
  );
  res.json({ items: rows, counts, viewers: viewersSnapshot(), now });
}));

router.get('/conversations/:id', wrap(async (req, res) => {
  const conv = await loadConversation(int(req.params.id), req.inbox);
  const [customer, messageRows, notes, leads, followUps, assignees, channel] = await Promise.all([
    q.get('SELECT id, name, phone, email, avatar_url, is_simulated FROM inbox_customers WHERE id = ?', conv.customer_id),
    q.all(
      `SELECT m.id, m.direction, m.sender_type, m.user_id, m.body, m.attachments_json, m.delivery_status, m.error, m.created_at,
              u.name AS user_name
       FROM inbox_messages m LEFT JOIN inbox_users u ON u.id = m.user_id
       WHERE m.conversation_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 120`,
      conv.id,
    ),
    q.all(
      `SELECT n.id, n.user_id, n.body, n.created_at, u.name AS user_name
       FROM inbox_notes n LEFT JOIN inbox_users u ON u.id = n.user_id
       WHERE n.conversation_id = ? ORDER BY n.created_at`,
      conv.id,
    ),
    q.all(
      `SELECT l.*, u.name AS owner_name, un.title AS unit_title, un.unit_number AS unit_number
       FROM inbox_leads l LEFT JOIN inbox_users u ON u.id = l.owner_user_id
       LEFT JOIN units un ON un.id = l.unit_id
       WHERE l.customer_id = ? ORDER BY l.created_at DESC LIMIT 20`,
      conv.customer_id,
    ),
    q.all(
      `SELECT f.*, u.name AS assigned_name FROM inbox_follow_ups f LEFT JOIN inbox_users u ON u.id = f.assigned_user_id
       WHERE f.conversation_id = ? ORDER BY f.due_at DESC LIMIT 30`,
      conv.id,
    ),
    listAssignees(conv.id),
    q.get('SELECT id, kind, name FROM inbox_channels WHERE id = ?', conv.channel_id),
  ]);
  if (!customer?.name && (conv.channel_kind === 'messenger' || conv.channel_kind === 'instagram') && Number(customer?.is_simulated) !== 1) {
    try {
      const identity = await q.get('SELECT id, external_id FROM inbox_customer_identities WHERE id = ?', conv.identity_id);
      const fullChannel = await q.get('SELECT * FROM inbox_channels WHERE id = ?', conv.channel_id);
      const profile = identity?.external_id && fullChannel ? await fetchProfile(fullChannel, identity.external_id) : null;
      if (profile?.name) {
        await q.run(
          'UPDATE inbox_customers SET name = COALESCE(name, ?), avatar_url = COALESCE(avatar_url, ?), updated_at = ? WHERE id = ?',
          profile.name, profile.avatar, Date.now(), customer.id,
        );
        await q.run(
          'UPDATE inbox_customer_identities SET display_name = COALESCE(display_name, ?), username = COALESCE(username, ?) WHERE id = ?',
          profile.name, profile.username, identity.id,
        );
        customer.name = profile.name;
        if (!customer.avatar_url && profile.avatar) customer.avatar_url = profile.avatar;
      }
    } catch (err) {
      console.warn('[inbox] name lookup failed:', err.message);
    }
  }
  res.json({
    conversation: {
      ...conv,
      customer_name: customer?.name || null,
      avatar_url: customer?.avatar_url || null,
      phone: customer?.phone || conv.phone,
      email: customer?.email || null,
      ai: parseJson(conv.ai_json),
      ai_summary: parseJson(conv.ai_summary),
      ad_ref: parseJson(conv.ad_ref_json),
      window: messagingWindow(conv),
      assignees,
      ai_json: undefined,
      ad_ref_json: undefined,
    },
    channel,
    customer,
    messages: messageRows.reverse().map((m) => ({ ...m, attachments: parseJson(m.attachments_json, []), attachments_json: undefined })),
    notes,
    leads,
    followUps,
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
  const raw = req.body || {};
  const text = typeof raw.text === 'string' ? raw.text : typeof raw.body === 'string' ? raw.body : undefined;
  const { template } = raw;
  const message = await sendToCustomer(conv.id, {
    text: typeof text === 'string' ? (await personalize(text, conv, req.inbox)).trim() : undefined,
    template: template?.name ? { name: String(template.name).slice(0, 200), language: String(template.language || 'ar').slice(0, 10) } : undefined,
    senderType: 'agent',
    userId: req.inbox.id,
  });
  await addAssignee(conv.id, req.inbox.id, { byUserId: req.inbox.id, reason: 'reply' });
  res.json({ message: publicMessage(message) });
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
  const caption = req.body?.caption
    ? (await personalize(String(req.body.caption), conv, req.inbox)).slice(0, 1000)
    : undefined;
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
  await addAssignee(conv.id, req.inbox.id, { byUserId: req.inbox.id, reason: 'reply' });
  res.json({ message: publicMessage(message) });
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
  if (!to) throw badRequest('Choose a staff member');
  const removing = Boolean(req.body?.remove);
  if (to !== req.inbox.id && !can(req.inbox, 'conv.assign')) throw forbidden('Only supervisors can change other people on a chat');
  if (!(await q.get('SELECT 1 AS x FROM inbox_users WHERE id = ? AND active = 1 AND role IS NOT NULL', to))) {
    throw badRequest('User not found');
  }
  const conversation = removing
    ? await removeAssignee(conv.id, to, { byUserId: req.inbox.id })
    : await addAssignee(conv.id, to, { byUserId: req.inbox.id, reason: to === req.inbox.id ? 'claim' : 'manual' });
  res.json({ conversation, assignees: await listAssignees(conv.id) });
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
  const onIt = conv.assigned_user_id === req.inbox.id || await q.get(
    'SELECT 1 AS x FROM inbox_conversation_assignees WHERE conversation_id = ? AND user_id = ?',
    conv.id, req.inbox.id,
  );
  if (onIt && conv.unread_count) {
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
    || await q.get(
      `SELECT 1 AS x FROM inbox_conversations c
       WHERE c.customer_id = ? AND (
         c.assigned_user_id = ? OR EXISTS (
           SELECT 1 FROM inbox_conversation_assignees a WHERE a.conversation_id = c.id AND a.user_id = ?
         ))`,
      id, req.inbox.id, req.inbox.id,
    );
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
