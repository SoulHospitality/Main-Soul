const express = require('express');
const { query } = require('../config/db');
const { authStaff, requireRoles, requirePasswordChanged } = require('../middleware/auth');
const {
  listConnections,
  listProviders,
  runChannelSync,
  upsertApiConnection,
  updateApiConnection,
  upsertUnitMapping,
  listSyncLogs,
  listThreads,
  getThread,
  replyToThread,
  unreadCount,
  channelRevenueSummary,
} = require('../lib/channelManager');

const router = express.Router();
const ROLES = ['admin', 'reservations', 'reservations_web', 'reservations_manual', 'reservations_manager'];

router.use(authStaff, requirePasswordChanged, requireRoles(...ROLES));

router.get('/providers', (_req, res) => {
  res.json({ providers: listProviders() });
});

router.get('/connections', async (_req, res, next) => {
  try {
    const data = await listConnections();
    res.json(data);
  } catch (e) {
    next(e);
  }
});

router.get('/channel-stats', async (req, res, next) => {
  try {
    const from = req.query.from || null;
    const to = req.query.to || null;
    const summary = await channelRevenueSummary({ from, to });
    res.json(summary);
  } catch (e) {
    next(e);
  }
});

/** Units with their channel mappings, connections, providers and revenue by channel. */
router.get('/overview', async (_req, res, next) => {
  try {
    const { rows: units } = await query(
      `SELECT id, wp_post_id, slug, title, unit_number, status
       FROM units
       WHERE status = 'published'
       ORDER BY title NULLS LAST, unit_number NULLS LAST`
    );
    const [connections, revenue] = await Promise.all([
      listConnections(),
      channelRevenueSummary({}).catch(() => ({ channels: [], totals: {} })),
    ]);
    const mappingsByUnit = new Map();
    for (const c of connections.api || []) {
      for (const m of c.mappings || []) {
        if (!mappingsByUnit.has(m.unit_id)) mappingsByUnit.set(m.unit_id, []);
        mappingsByUnit.get(m.unit_id).push({ ...m, connection_id: c.id, provider_label: c.provider_label });
      }
    }
    res.json({
      units: units.map((unit) => ({ ...unit, mappings: mappingsByUnit.get(unit.id) || [] })),
      connections,
      providers: listProviders(),
      revenue,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/sync', async (req, res, next) => {
  try {
    const { connection_id: connectionId = null } = req.body || {};
    const result = await runChannelSync({ connectionId });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get('/sync-logs', async (req, res, next) => {
  try {
    const logs = await listSyncLogs({
      limit: req.query.limit,
      connectionId: req.query.connection_id || null,
      unitId: req.query.unit_id || null,
    });
    res.json({ logs });
  } catch (e) {
    next(e);
  }
});

router.post('/connections/api', async (req, res, next) => {
  try {
    const {
      provider_key: providerKey,
      display_name: displayName,
      credentials = {},
      config = {},
      enabled = true,
      sync_enabled: syncEnabled = true,
    } = req.body || {};
    const row = await upsertApiConnection({
      providerKey,
      displayName,
      credentials,
      config,
      enabled,
      syncEnabled,
    });
    res.status(201).json({ connection: row });
  } catch (e) {
    if (/Invalid API provider|not configured/i.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    next(e);
  }
});

router.patch('/connections/api/:id', async (req, res, next) => {
  try {
    const {
      display_name: displayName,
      credentials,
      config,
      enabled,
      sync_enabled: syncEnabled,
    } = req.body || {};
    const row = await updateApiConnection(req.params.id, {
      displayName,
      credentials,
      config,
      enabled,
      syncEnabled,
    });
    res.json({ connection: row });
  } catch (e) {
    if (/Connection not found/i.test(e.message)) {
      return res.status(404).json({ error: e.message });
    }
    next(e);
  }
});

router.put('/connections/api/:id/mappings', async (req, res, next) => {
  try {
    const {
      unit_id: unitId,
      external_listing_id: externalListingId,
      external_room_type_id: externalRoomTypeId,
      external_rate_plan_id: externalRatePlanId,
    } = req.body || {};
    const mapping = await upsertUnitMapping({
      connectionId: req.params.id,
      unitId,
      externalListingId,
      externalRoomTypeId,
      externalRatePlanId,
    });
    res.json({ mapping });
  } catch (e) {
    if (/required/i.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
});

router.delete('/connections/api/:id/mappings/:mappingId', async (req, res, next) => {
  try {
    await query(`DELETE FROM channel_unit_mappings WHERE id = $1 AND connection_id = $2`, [
      req.params.mappingId,
      req.params.id,
    ]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/messages/unread-count', async (_req, res, next) => {
  try {
    const count = await unreadCount();
    res.json({ count });
  } catch (e) {
    next(e);
  }
});

router.get('/messages/threads', async (req, res, next) => {
  try {
    const threads = await listThreads({
      limit: req.query.limit,
      connectionId: req.query.connection_id || null,
    });
    res.json({ threads });
  } catch (e) {
    if (/channel_message_threads/i.test(e.message)) {
      return res.json({ threads: [] });
    }
    next(e);
  }
});

router.get('/messages/threads/:id', async (req, res, next) => {
  try {
    const thread = await getThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    await query(
      `UPDATE channel_message_threads SET unread_count = 0, updated_at = now() WHERE id = $1`,
      [req.params.id]
    ).catch(() => {});
    res.json({ thread: { ...thread, unread_count: 0 } });
  } catch (e) {
    next(e);
  }
});

router.post('/messages/threads/:id/reply', async (req, res, next) => {
  try {
    const message = await replyToThread(req.params.id, req.body?.body, req.user);
    res.status(201).json({ message });
  } catch (e) {
    if (/required|not found|does not support/i.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    next(e);
  }
});

module.exports = router;
