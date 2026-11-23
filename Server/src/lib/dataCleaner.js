/**
 * Data cleaner: keeps the database small enough for the Supabase free plan (500 MB).
 *
 * Runs in the background (jobs/dataCleaner.js): every night it removes old logs and temporary records
 * by the rules below (per-rule overrides can go in data_cleaner_config.rules). When the database passes 80% of
 * the plan limit it runs in "tight" mode: keep periods are halved (never below each rule's minimum)
 * and the cleaned tables are compacted so the space is really given back.
 *
 * Never touched: reservations, payments, finance, owners, units, guests, staff, payroll, attendance,
 * reviews and Live Inbox conversations. Guest ID photos are removed separately (jobs/dataRetention.js).
 */
const { query } = require('../config/db');

const DAY_MS = 86400000;
const BATCH = 5000;

const cutoffTs = (days) => `now() - make_interval(days => ${Number(days)})`;
const cutoffMs = (days) => Date.now() - Number(days) * DAY_MS;

/**
 * Each rule: key, label, what it holds, default keep (days), the lowest keep allowed, on by default,
 * and the statements it runs: { table, where: (days) => [sql, params] } deletes; `set` makes it an update.
 */
const RULES = [
  {
    key: 'webhook_log',
    label: 'Meta webhook log',
    about: 'Raw copies of every Instagram, Messenger and WhatsApp event, kept only to debug delivery problems.',
    days: 14, min: 3, on: true,
    steps: [{ table: 'inbox_webhook_log', where: (d) => ['received_at < $1', [cutoffMs(d)]] }],
  },
  {
    key: 'site_telemetry',
    label: 'Website visit and error tracking',
    about: 'Anonymous page events and browser errors from the guest website.',
    days: 90, min: 30, on: true,
    steps: [
      { table: 'site_guest_events', where: (d) => [`created_at < ${cutoffTs(d)}`, []] },
      { table: 'site_guest_errors', where: (d) => [`created_at < ${cutoffTs(d)}`, []] },
    ],
  },
  {
    key: 'channel_sync_logs',
    label: 'Channel manager sync log',
    about: 'One line per channel manager sync attempt.',
    days: 30, min: 7, on: true,
    steps: [{ table: 'channel_sync_logs', where: (d) => [`created_at < ${cutoffTs(d)}`, []] }],
  },
  {
    key: 'partner_webhooks',
    label: 'Partner webhook deliveries',
    about: 'Delivery attempts of booking updates sent to partners.',
    days: 30, min: 7, on: true,
    steps: [{ table: 'partner_webhook_deliveries', where: (d) => [`created_at < ${cutoffTs(d)}`, []] }],
  },
  {
    key: 'notifications',
    label: 'Staff notifications',
    about: 'Bell notifications: read ones after the keep period, unread ones after three times as long.',
    days: 60, min: 14, on: true,
    steps: [
      { table: 'notifications', where: (d) => [`(COALESCE(is_read, 0) = 1 AND created_at < ${cutoffTs(d)}) OR created_at < ${cutoffTs(d * 3)}`, []] },
      { table: 'sales_notifications', where: (d) => [`(COALESCE(is_read, 0) = 1 AND created_at < ${cutoffTs(d)}) OR created_at < ${cutoffTs(d * 3)}`, []] },
    ],
  },
  {
    key: 'chatbot_tests',
    label: 'Chatbot test chats',
    about: 'Chats from the CEO chatbot test page.',
    days: 30, min: 7, on: true,
    steps: [{ table: 'chatbot_sessions', where: (d) => [`mode = 'test' AND updated_at < ${cutoffTs(d)}`, []] }],
  },
  {
    key: 'chatbot_website',
    label: 'Old website chats',
    about: 'Website chat windows nobody used for this long. Chats handed to the team stay in the Live Inbox.',
    days: 60, min: 14, on: true,
    steps: [{ table: 'chatbot_sessions', where: (d) => [`mode = 'website' AND updated_at < ${cutoffTs(d)}`, []] }],
  },
  {
    key: 'chatbot_memory',
    label: 'Chatbot memory of quiet chats',
    about: 'The AI working copy of an Instagram / Messenger chat with no message for this long (the chat itself stays in the Live Inbox; the bot starts fresh).',
    days: 30, min: 7, on: true,
    steps: [{ table: 'chatbot_sessions', set: `history = '[]'::jsonb`, where: (d) => [`mode = 'live' AND history <> '[]'::jsonb AND updated_at < ${cutoffTs(d)}`, []] }],
  },
  {
    key: 'inbox_activity',
    label: 'Live Inbox activity trail',
    about: 'Assignment, reply-clock and escalation events behind the inbox analytics (not the messages).',
    days: 180, min: 60, on: true,
    steps: [
      { table: 'inbox_events', where: (d) => ['at < $1', [cutoffMs(d)]] },
      { table: 'inbox_sla_events', where: (d) => ['at < $1', [cutoffMs(d)]] },
    ],
  },
  {
    key: 'inbox_response_times',
    label: 'Live Inbox response-time records',
    about: 'One row per agent reply, used for response-time reports.',
    days: 365, min: 180, on: true,
    steps: [{ table: 'inbox_responses', where: (d) => ['responded_at < $1', [cutoffMs(d)]] }],
  },
  {
    key: 'whatsapp_log',
    label: 'WhatsApp send log',
    about: 'Record of automatic WhatsApp messages sent (used to avoid sending twice).',
    days: 180, min: 60, on: true,
    steps: [{ table: 'whatsapp_outbound_log', where: (d) => [`created_at < ${cutoffTs(d)}`, []] }],
  },
  {
    key: 'guest_outreach',
    label: 'Guest email log',
    about: 'Record of pre-arrival, rating and invite-back emails.',
    days: 365, min: 180, on: true,
    steps: [{ table: 'guest_outreach', where: (d) => [`created_at < ${cutoffTs(d)}`, []] }],
  },
  {
    key: 'ops_assignment_log',
    label: 'Operations assignment history',
    about: 'Who was assigned to each check-in, checkout and clean, and when.',
    days: 365, min: 180, on: true,
    steps: [{ table: 'ops_assignment_log', where: (d) => [`created_at < ${cutoffTs(d)}`, []] }],
  },
  {
    key: 'audit_log',
    label: 'Audit log (off by default)',
    about: 'Who changed what in the PMS. Keep it unless space is really tight.',
    days: 730, min: 365, on: false,
    steps: [{ table: 'audit_log', where: (d) => [`created_at < ${cutoffTs(d)}`, []] }],
  },
  {
    key: 'cleaner_history',
    label: 'Data cleaner history',
    about: 'This page\'s own run history.',
    days: 180, min: 30, on: true,
    steps: [{ table: 'data_cleaner_runs', where: (d) => [`started_at < ${cutoffTs(d)}`, []] }],
  },
];

const TIGHT_SHARE = 0.8;

async function loadConfig() {
  const { rows } = await query('SELECT * FROM data_cleaner_config WHERE id = 1');
  return rows[0] || { enabled: true, size_limit_mb: 500, rules: {} };
}

/** The rules with this database's settings applied. */
function effectiveRules(config, { tight = false } = {}) {
  return RULES.map((r) => {
    const o = (config.rules || {})[r.key] || {};
    const enabled = typeof o.enabled === 'boolean' ? o.enabled : r.on;
    const chosen = Math.max(r.min, Number.isFinite(Number(o.days)) && Number(o.days) > 0 ? Math.round(Number(o.days)) : r.days);
    const days = tight ? Math.max(r.min, Math.floor(chosen / 2)) : chosen;
    return { ...r, enabled, days, chosenDays: chosen };
  });
}

async function databaseSize() {
  const { rows } = await query('SELECT pg_database_size(current_database())::bigint AS bytes');
  return Number(rows[0]?.bytes || 0);
}

async function largestTables(limit = 15) {
  const { rows } = await query(
    `SELECT relname AS name, pg_total_relation_size(relid)::bigint AS bytes, n_live_tup::bigint AS rows
     FROM pg_stat_user_tables WHERE schemaname = 'public'
     ORDER BY pg_total_relation_size(relid) DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({ name: r.name, bytes: Number(r.bytes), rows: Number(r.rows) }));
}

const missingTable = (err) => err?.code === '42P01' || /does not exist/.test(String(err?.message || ''));

/** Rows a step would remove (or update). */
async function countStep(step, days) {
  const [where, params] = step.where(days);
  try {
    const { rows } = await query(`SELECT COUNT(*)::bigint AS n FROM ${step.table} WHERE ${where}`, params);
    return Number(rows[0]?.n || 0);
  } catch (err) {
    if (missingTable(err)) return 0;
    throw err;
  }
}

/** Removes (or updates) in batches so no table is locked for long. */
async function runStep(step, days) {
  const [where, params] = step.where(days);
  let total = 0;
  try {
    for (let i = 0; i < 400; i += 1) {
      const sql = step.set
        ? `UPDATE ${step.table} SET ${step.set} WHERE ctid = ANY(ARRAY(SELECT ctid FROM ${step.table} WHERE ${where} LIMIT ${BATCH}))`
        : `DELETE FROM ${step.table} WHERE ctid = ANY(ARRAY(SELECT ctid FROM ${step.table} WHERE ${where} LIMIT ${BATCH}))`;
      const res = await query(sql, params);
      const n = Number(res.rowCount || 0);
      total += n;
      if (n < BATCH) break;
    }
  } catch (err) {
    if (missingTable(err)) return 0;
    throw err;
  }
  return total;
}

/** Gives freed space back: a plain VACUUM normally, a full rewrite in tight mode (log tables are small). */
async function compact(tables, full) {
  for (const t of tables) {
    try {
      await query(full ? `VACUUM (FULL, ANALYZE) ${t}` : `VACUUM (ANALYZE) ${t}`);
    } catch (err) {
      console.warn('[data-cleaner] vacuum skipped for', t, err.message);
    }
  }
}

let running = false;

/**
 * One cleaning run. trigger: 'auto' (nightly), 'manual' (Run now), 'tight' (database near the limit).
 * dryRun only counts what would go.
 */
async function runCleaner({ trigger = 'auto', dryRun = false, userId = null } = {}) {
  if (running) {
    const err = new Error('A cleaning run is already in progress');
    err.status = 409;
    throw err;
  }
  running = true;
  const config = await loadConfig();
  const sizeBefore = await databaseSize();
  const limitBytes = Number(config.size_limit_mb || 500) * 1024 * 1024;
  const tight = trigger === 'tight' || sizeBefore > limitBytes * TIGHT_SHARE;
  const { rows: started } = await query(
    `INSERT INTO data_cleaner_runs (trigger, dry_run, size_before, started_by) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tight && trigger === 'auto' ? 'tight' : trigger, dryRun, sizeBefore, userId]
  );
  const runId = started[0].id;
  const results = {};
  const touched = new Set();
  try {
    if (!config.enabled && trigger === 'auto') {
      await query(`UPDATE data_cleaner_runs SET finished_at = now(), size_after = $2, error = 'Cleaner is switched off' WHERE id = $1`, [runId, sizeBefore]);
      return { id: runId, skipped: 'off' };
    }
    for (const rule of effectiveRules(config, { tight })) {
      if (!rule.enabled) continue;
      let n = 0;
      for (const step of rule.steps) {
        const done = dryRun ? await countStep(step, rule.days) : await runStep(step, rule.days);
        if (done > 0) touched.add(step.table);
        n += done;
      }
      results[rule.key] = { rows: n, days: rule.days };
    }
    if (!dryRun && touched.size) await compact([...touched], tight);
    const sizeAfter = await databaseSize();
    await query(`UPDATE data_cleaner_runs SET finished_at = now(), size_after = $2, results = $3 WHERE id = $1`, [runId, sizeAfter, JSON.stringify(results)]);
    if (!dryRun && sizeAfter > limitBytes * TIGHT_SHARE) {
      const { notifyStaff } = require('../services/pmsNotifications');
      await notifyStaff({
        roles: ['admin'],
        type: 'database_size_warning',
        title: 'Database almost full',
        message: `The database is ${Math.round(sizeAfter / 1048576)} MB of ${config.size_limit_mb} MB after cleaning. Largest tables: ${(await largestTables(3)).map((t) => `${t.name} ${Math.round(t.bytes / 1048576)} MB`).join(', ')}.`,
        entity_type: 'data_cleaner',
        entity_id: 1,
        dedupeSameDay: true,
      }).catch(() => {});
    }
    return { id: runId, tight, dryRun, sizeBefore, sizeAfter, results };
  } catch (err) {
    await query(`UPDATE data_cleaner_runs SET finished_at = now(), error = $2, results = $3 WHERE id = $1`, [runId, String(err.message).slice(0, 500), JSON.stringify(results)]).catch(() => {});
    throw err;
  } finally {
    running = false;
  }
}

/** Between nightly runs: if the database crosses the tight line, clean right away (at most every 6 hours). */
async function checkPressure() {
  const config = await loadConfig();
  if (!config.enabled) return { skipped: 'off' };
  const size = await databaseSize();
  if (size <= config.size_limit_mb * 1024 * 1024 * TIGHT_SHARE) return { ok: true, size };
  const { rows } = await query(`SELECT 1 FROM data_cleaner_runs WHERE NOT dry_run AND started_at > now() - interval '6 hours' LIMIT 1`);
  if (rows.length) return { recent: true, size };
  return runCleaner({ trigger: 'tight' });
}

module.exports = { RULES, effectiveRules, runCleaner, checkPressure, databaseSize, largestTables };
