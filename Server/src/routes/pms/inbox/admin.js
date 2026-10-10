const express = require('express');
const { config } = require('../../../lib/inbox/config');
const { q, audit } = require('../../../lib/inbox/db');
const { badRequest, forbidden, int, notFound, wrap } = require('../../../lib/inbox/http');
const { OVERRIDE_ROLES, can } = require('../../../lib/inbox/permissions');
const { encrypt } = require('../../../lib/inbox/security');
const { DEFAULTS, getSettings, updateSettings } = require('../../../lib/inbox/settings');
const { handleAgentOffline } = require('../../../lib/inbox/assignment');
const { checkChannel, subscribePage, subscribeWaba } = require('../../../lib/inbox/meta');
const { broadcast } = require('../../../lib/inbox/realtime');
const { requirePerm } = require('./common');

const router = express.Router();

// ---------- Team: who works in the inbox. The PMS role gives the default; managers can override it.
router.get('/team', requirePerm('users.manage'), wrap(async (req, res) => {
  const items = await q.all(
    `SELECT u.id, u.name, u.pms_role, u.role, u.role_override, u.active, u.in_rotation, u.max_open, u.presence, u.last_seen_at,
       (SELECT COUNT(*) FROM inbox_conversations c WHERE c.assigned_user_id = u.id AND c.status = 'needs_reply') AS waiting,
       (SELECT COUNT(*) FROM inbox_conversations c WHERE c.assigned_user_id = u.id AND c.status <> 'closed') AS open
     FROM inbox_users u
     WHERE u.active = 1 AND u.pms_role <> 'owner'
     ORDER BY (u.role IS NULL), u.name`,
  );
  res.json({ items });
}));

router.patch('/team/:id', requirePerm('users.manage'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const target = await q.get('SELECT * FROM inbox_users WHERE id = ?', id);
  if (!target || target.pms_role === 'owner') throw notFound();
  if (target.pms_role === 'admin') throw forbidden('The CEO always has full inbox access');
  const b = req.body || {};
  const patch = {};
  if ('inbox_role' in b) {
    const role = b.inbox_role === 'default' || b.inbox_role === null ? null : b.inbox_role;
    if (role !== null && !OVERRIDE_ROLES.includes(role)) throw badRequest('Invalid inbox role');
    if (role === 'manager' && !can(req.inbox, 'channels.manage')) throw forbidden('Only the CEO can make inbox managers');
    if (target.role === 'manager' && !can(req.inbox, 'channels.manage') && target.id !== req.inbox.id) {
      throw forbidden('Only the CEO can change an inbox manager');
    }
    patch.inbox_role = role;
  }
  if ('in_rotation' in b) patch.in_rotation = b.in_rotation ? 1 : 0;
  if ('max_open' in b) {
    const n = Number(b.max_open);
    if (!Number.isInteger(n) || n < 1 || n > 500) throw badRequest('Max chats must be 1-500');
    patch.max_open = n;
  }
  const keys = Object.keys(patch);
  if (keys.length) {
    await q.run('INSERT INTO inbox_agents (staff_user_id) VALUES (?) ON CONFLICT (staff_user_id) DO NOTHING', id);
    await q.run(
      `UPDATE inbox_agents SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE staff_user_id = ?`,
      ...keys.map((k) => patch[k]), id,
    );
    await audit({ userId: req.inbox.id, type: 'team_updated', data: { id, ...patch } });
  }
  const after = await q.get('SELECT role, in_rotation FROM inbox_users WHERE id = ?', id);
  if (!after.role || !after.in_rotation) await handleAgentOffline(id);
  broadcast('users', {});
  res.json({ ok: true });
}));

// ---------- Settings
function webhookUrl(req) {
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}/api/inbox/webhooks/meta`;
}

router.get('/settings', requirePerm('settings.manage'), wrap(async (req, res) => {
  res.json({
    settings: getSettings(),
    webhook: {
      url: webhookUrl(req),
      verifyTokenSet: Boolean(config.meta.verifyToken),
      appSecretSet: Boolean(config.meta.appSecret),
      appIdSet: Boolean(config.meta.appId),
    },
    aiConfigured: Boolean(config.ai.apiKey),
    aiModel: config.ai.model,
    simulatorEnabled: config.simulatorEnabled,
  });
}));

const NUMBER_KEYS = ['sla_target_min', 'sla_warning_min', 'reassign_window_min', 'max_auto_reassign', 'escalate_supervisor_min',
  'escalate_manager_min', 'comment_sla_min', 'follow_up_escalate_min', 'presence_timeout_min', 'night_ai_max_replies'];

router.put('/settings', requirePerm('settings.manage'), wrap(async (req, res) => {
  const patch = {};
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!(k in DEFAULTS)) continue;
    const def = DEFAULTS[k];
    if (NUMBER_KEYS.includes(k)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 10000) throw badRequest(`Invalid value for ${k}`);
      patch[k] = n;
    } else if (typeof def === 'boolean') patch[k] = Boolean(v);
    else if (Array.isArray(def)) {
      if (!Array.isArray(v)) throw badRequest(`${k} must be a list`);
      patch[k] = v.map((x) => String(x).trim().slice(0, 100)).filter(Boolean).slice(0, 100);
    } else patch[k] = String(v).slice(0, 8000);
  }
  for (const k of ['business_start', 'business_end']) {
    if (k in patch && !/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(patch[k])) throw badRequest(`${k} must be HH:MM`);
  }
  if ('night_mode' in patch && !['ai', 'message', 'off'].includes(patch.night_mode)) throw badRequest('Invalid night mode');
  const merged = { ...getSettings(), ...patch };
  if (merged.sla_warning_min >= merged.sla_target_min) throw badRequest('Warning must come before the SLA target');
  if (merged.sla_target_min < 1) throw badRequest('SLA target must be at least 1 minute');
  if (merged.presence_timeout_min < 1) throw badRequest('Presence timeout must be at least 1 minute');
  await updateSettings(patch);
  await audit({ userId: req.inbox.id, type: 'settings_changed', data: patch });
  broadcast('settings', {});
  res.json({ settings: getSettings() });
}));

// ---------- Channels (CEO only: they hold access tokens)
router.get('/channels', requirePerm('channels.manage'), wrap(async (req, res) => {
  const items = await q.all(
    `SELECT id, kind, name, external_id, page_id, waba_id, active, created_at, (access_token_enc IS NOT NULL) AS has_token
     FROM inbox_channels ORDER BY kind, name`,
  );
  res.json({ items });
}));

router.post('/channels', requirePerm('channels.manage'), wrap(async (req, res) => {
  const { kind, name, external_id: externalId, page_id: pageId, waba_id: wabaId, access_token: token } = req.body || {};
  if (!['messenger', 'instagram', 'whatsapp'].includes(kind)) throw badRequest('Invalid channel type');
  if (!String(name || '').trim() || !String(externalId || '').trim()) throw badRequest('Name and ID are required');
  if (kind === 'instagram' && !pageId) throw badRequest('Instagram needs the linked Facebook Page ID');
  if (kind === 'whatsapp' && await q.get("SELECT 1 AS x FROM inbox_channels WHERE kind = 'whatsapp' AND active = 1 AND external_id NOT LIKE 'demo-%'")) {
    throw badRequest('Only one WhatsApp number is supported. Disable the current one first.');
  }
  if (await q.get('SELECT 1 AS x FROM inbox_channels WHERE kind = ? AND external_id = ?', kind, String(externalId).trim())) {
    throw badRequest('Channel already exists');
  }
  const { id } = await q.insert(
    'INSERT INTO inbox_channels (kind, name, external_id, page_id, waba_id, access_token_enc, created_at) VALUES (?,?,?,?,?,?,?)',
    kind, String(name).trim(), String(externalId).trim(), pageId || null, wabaId || null,
    token ? encrypt(String(token).trim()) : null, Date.now(),
  );
  await audit({ userId: req.inbox.id, type: 'channel_created', data: { id, kind, name } });
  broadcast('settings', {});
  res.json({ id });
}));

router.patch('/channels/:id', requirePerm('channels.manage'), wrap(async (req, res) => {
  const id = int(req.params.id);
  if (!(await q.get('SELECT 1 AS x FROM inbox_channels WHERE id = ?', id))) throw notFound();
  const b = req.body || {};
  if ('name' in b) await q.run('UPDATE inbox_channels SET name = ? WHERE id = ?', String(b.name).trim(), id);
  if ('active' in b) await q.run('UPDATE inbox_channels SET active = ? WHERE id = ?', b.active ? 1 : 0, id);
  if ('page_id' in b) await q.run('UPDATE inbox_channels SET page_id = ? WHERE id = ?', b.page_id || null, id);
  if ('waba_id' in b) await q.run('UPDATE inbox_channels SET waba_id = ? WHERE id = ?', b.waba_id || null, id);
  if (b.access_token) await q.run('UPDATE inbox_channels SET access_token_enc = ? WHERE id = ?', encrypt(String(b.access_token).trim()), id);
  await audit({
    userId: req.inbox.id, type: 'channel_updated',
    data: { id, fields: Object.keys(b).filter((k) => k !== 'access_token'), token_changed: Boolean(b.access_token) },
  });
  broadcast('settings', {});
  res.json({ ok: true });
}));

router.post('/channels/:id/test', requirePerm('channels.manage'), wrap(async (req, res) => {
  const channel = await q.get('SELECT * FROM inbox_channels WHERE id = ?', int(req.params.id));
  if (!channel) throw notFound();
  try {
    res.json({ ok: true, info: await checkChannel(channel) });
  } catch (err) {
    throw badRequest(err.message);
  }
}));

router.post('/channels/:id/subscribe', requirePerm('channels.manage'), wrap(async (req, res) => {
  const channel = await q.get('SELECT * FROM inbox_channels WHERE id = ?', int(req.params.id));
  if (!channel) throw notFound();
  try {
    const result = channel.kind === 'whatsapp' ? await subscribeWaba(channel) : await subscribePage(channel);
    await audit({ userId: req.inbox.id, type: 'channel_subscribed', data: { id: channel.id } });
    res.json({ ok: true, result });
  } catch (err) {
    throw badRequest(err.message);
  }
}));

// ---------- Lead stages & lost reasons (configurable without code changes)
router.get('/stages', requirePerm('settings.manage'), wrap(async (req, res) => {
  res.json({
    stages: await q.all('SELECT * FROM inbox_lead_stages ORDER BY position'),
    lostReasons: await q.all('SELECT * FROM inbox_lost_reasons ORDER BY position'),
  });
}));

const cleanKey = (k) => String(k || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);

router.put('/stages', requirePerm('settings.manage'), wrap(async (req, res) => {
  const list = req.body?.stages;
  if (!Array.isArray(list) || !list.length) throw badRequest('Stages are required');
  for (const kind of ['won', 'lost']) {
    if (!list.some((s) => s.kind === kind && s.active !== false)) throw badRequest(`At least one active "${kind}" stage is required`);
  }
  const { tx } = require('../../../lib/inbox/db');
  await tx(async () => {
    for (const [i, s] of list.entries()) {
      const key = cleanKey(s.key);
      if (!key || !s.name_en || !s.name_ar) throw badRequest('Each stage needs a key and names');
      if (!['open', 'won', 'lost', 'invalid'].includes(s.kind)) throw badRequest('Invalid stage kind');
      await q.run(
        `INSERT INTO inbox_lead_stages (key, name_en, name_ar, position, kind, requires_phone, requires_follow_up, is_qualified, active)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT (key) DO UPDATE SET name_en = EXCLUDED.name_en, name_ar = EXCLUDED.name_ar, position = EXCLUDED.position,
           kind = EXCLUDED.kind, requires_phone = EXCLUDED.requires_phone, requires_follow_up = EXCLUDED.requires_follow_up,
           is_qualified = EXCLUDED.is_qualified, active = EXCLUDED.active`,
        key, String(s.name_en).slice(0, 80), String(s.name_ar).slice(0, 80), i + 1, s.kind,
        s.requires_phone ? 1 : 0, s.requires_follow_up ? 1 : 0, s.is_qualified ? 1 : 0, s.active === false ? 0 : 1,
      );
    }
    await audit({ userId: req.inbox.id, type: 'stages_changed', data: { count: list.length } });
  });
  broadcast('settings', {});
  res.json({ stages: await q.all('SELECT * FROM inbox_lead_stages ORDER BY position') });
}));

router.put('/lost-reasons', requirePerm('settings.manage'), wrap(async (req, res) => {
  const list = req.body?.reasons;
  if (!Array.isArray(list)) throw badRequest('Reasons are required');
  for (const [i, r] of list.entries()) {
    const key = cleanKey(r.key);
    if (!key || !r.name_en || !r.name_ar) throw badRequest('Each reason needs a key and names');
    await q.run(
      `INSERT INTO inbox_lost_reasons (key, name_en, name_ar, position, active) VALUES (?,?,?,?,?)
       ON CONFLICT (key) DO UPDATE SET name_en = EXCLUDED.name_en, name_ar = EXCLUDED.name_ar,
         position = EXCLUDED.position, active = EXCLUDED.active`,
      key, String(r.name_en).slice(0, 80), String(r.name_ar).slice(0, 80), i + 1, r.active === false ? 0 : 1,
    );
  }
  await audit({ userId: req.inbox.id, type: 'lost_reasons_changed', data: { count: list.length } });
  broadcast('settings', {});
  res.json({ ok: true });
}));

// ---------- Saved replies
router.get('/templates', requirePerm('templates.manage'), wrap(async (req, res) => {
  res.json({ items: await q.all('SELECT * FROM inbox_templates ORDER BY active DESC, title') });
}));

router.post('/templates', requirePerm('templates.manage'), wrap(async (req, res) => {
  const { title, body, shortcut } = req.body || {};
  if (!String(title || '').trim() || !String(body || '').trim()) throw badRequest('Title and text are required');
  const { id } = await q.insert(
    'INSERT INTO inbox_templates (title, body, shortcut, created_by, created_at) VALUES (?,?,?,?,?)',
    String(title).trim().slice(0, 100), String(body).slice(0, 4000), shortcut ? String(shortcut).trim().slice(0, 40) : null,
    req.inbox.id, Date.now(),
  );
  broadcast('settings', {});
  res.json({ id });
}));

router.patch('/templates/:id', requirePerm('templates.manage'), wrap(async (req, res) => {
  const id = int(req.params.id);
  const b = req.body || {};
  await q.run(
    `UPDATE inbox_templates SET title = COALESCE(?, title), body = COALESCE(?, body),
       shortcut = CASE WHEN ?::int = 1 THEN ? ELSE shortcut END, active = COALESCE(?::smallint, active) WHERE id = ?`,
    b.title ? String(b.title).slice(0, 100) : null, b.body ? String(b.body).slice(0, 4000) : null,
    'shortcut' in b, b.shortcut ? String(b.shortcut).slice(0, 40) : null,
    'active' in b ? (b.active ? 1 : 0) : null, id,
  );
  broadcast('settings', {});
  res.json({ ok: true });
}));

// ---------- Audit log
router.get('/audit', requirePerm('audit.view'), wrap(async (req, res) => {
  const before = Number(req.query.before) || Date.now() + 1;
  const user = req.query.user ? Number(req.query.user) || 0 : null;
  const items = await q.all(
    `SELECT e.*, u.name AS user_name FROM inbox_events e LEFT JOIN inbox_users u ON u.id = e.user_id
     WHERE e.at < ? ${user ? 'AND e.user_id = ?' : ''} ORDER BY e.at DESC, e.id DESC LIMIT 200`,
    before, ...(user ? [user] : []),
  );
  res.json({ items });
}));

/** Last webhook deliveries, to debug a channel connection. */
router.get('/webhook-log', requirePerm('channels.manage'), wrap(async (req, res) => {
  const items = await q.all(
    'SELECT id, object, received_at, error, left(payload, 2000) AS payload FROM inbox_webhook_log ORDER BY id DESC LIMIT 50',
  );
  res.json({ items });
}));

module.exports = router;
