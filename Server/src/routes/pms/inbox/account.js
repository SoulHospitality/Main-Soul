const express = require('express');
const { config } = require('../../../lib/inbox/config');
const { q, audit } = require('../../../lib/inbox/db');
const { badRequest, wrap } = require('../../../lib/inbox/http');
const { can, permissionsFor } = require('../../../lib/inbox/permissions');
const { getSettings, loadSettings, getProjects } = require('../../../lib/inbox/settings');
const { broadcast, viewersSnapshot } = require('../../../lib/inbox/realtime');
const { handleAgentOffline } = require('../../../lib/inbox/assignment');
const { aiAvailable } = require('../../../lib/inbox/ai');
const { isBusinessTime } = require('../../../lib/inbox/hours');
const { loadInboxUser } = require('./common');

const publicRouter = express.Router();
const router = express.Router();

/** Everything the UI needs to boot. Also answers "no access" so the sidebar can hide the inbox. */
publicRouter.get('/me', wrap(async (req, res) => {
  let u;
  try {
    await loadSettings();
    u = await loadInboxUser(req.user.id);
  } catch (err) {
    if (/inbox_/.test(err.message)) return res.json({ access: false, reason: 'not_installed' });
    throw err;
  }
  if (!u?.role) return res.json({ access: false });
  const s = getSettings();
  const counts = await q.get(
    `SELECT
       COUNT(*) FILTER (WHERE assigned_user_id = ? AND status = 'needs_reply') AS mine_waiting,
       COUNT(*) FILTER (WHERE assigned_user_id IS NULL AND status = 'needs_reply') AS unassigned_waiting
     FROM inbox_conversations`,
    u.id,
  );
  res.json({
    access: true,
    user: { id: u.id, name: u.name, role: u.role, pms_role: u.pms_role, presence: u.presence, in_rotation: u.in_rotation },
    permissions: permissionsFor(u),
    badge: (counts?.mine_waiting || 0) + (can(u, 'conv.assign') || s.allow_agent_claim ? counts?.unassigned_waiting || 0 : 0),
    users: await q.all(
      'SELECT id, name, role, pms_role, presence, active, in_rotation FROM inbox_users WHERE role IS NOT NULL ORDER BY active DESC, name',
    ),
    channels: await q.all('SELECT id, kind, name, active FROM inbox_channels ORDER BY kind, name'),
    stages: await q.all('SELECT * FROM inbox_lead_stages WHERE active = 1 ORDER BY position'),
    lostReasons: await q.all('SELECT * FROM inbox_lost_reasons WHERE active = 1 ORDER BY position'),
    templates: await q.all('SELECT id, title, body, shortcut FROM inbox_templates WHERE active = 1 ORDER BY title'),
    rules: {
      company_name: s.company_name,
      business_start: s.business_start,
      business_end: s.business_end,
      sla_target_min: s.sla_target_min,
      sla_warning_min: s.sla_warning_min,
      comment_sla_min: s.comment_sla_min,
      projects: await getProjects(),
      lead_sources: s.lead_sources,
      allow_agent_claim: s.allow_agent_claim,
    },
    businessNow: isBusinessTime(),
    aiAvailable: aiAvailable(),
    simulator: config.simulatorEnabled && can(u, 'simulator'),
    viewers: viewersSnapshot(),
    now: Date.now(),
  });
}));

router.post('/me/presence', wrap(async (req, res) => {
  const presence = req.body?.presence;
  if (!['online', 'away', 'offline'].includes(presence)) throw badRequest('Invalid presence');
  await q.run(
    `INSERT INTO inbox_agents (staff_user_id, presence, last_seen_at) VALUES (?, ?, ?)
     ON CONFLICT (staff_user_id) DO UPDATE SET presence = EXCLUDED.presence, last_seen_at = EXCLUDED.last_seen_at`,
    req.inbox.id, presence, Date.now(),
  );
  await audit({ userId: req.inbox.id, type: 'presence', data: { presence } });
  if (presence !== 'online') await handleAgentOffline(req.inbox.id);
  broadcast('presence', { user_id: req.inbox.id, presence });
  res.json({ ok: true });
}));

module.exports = { publicRouter, router };
