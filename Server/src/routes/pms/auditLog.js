const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { CATEGORY_KEYS, categorySql } = require('../../lib/auditCatalog');
const { RESERVATION_AUDIT_TEAM_ROLES } = require('../../lib/reservationScope');
const { FINANCE_AGENT_ROLES } = require('../../lib/financeScope');
const { UNIT_ACQUISITION_ROLES } = require('../../lib/unitAcquisition');
const { pageGrant, hasCustomAccess } = require('../../lib/pageAccess');

const router = express.Router();

const AUDIT_ROLES = ['admin', 'reservations_manager', 'finance_manager', 'unit_acquisition_manager'];

// Department managers keep seeing their own team's activity; the CEO sees everything.
const MANAGER_SCOPES = {
  reservations_manager: { categories: ['reservations', 'payments'], teamRoles: RESERVATION_AUDIT_TEAM_ROLES },
  finance_manager: { categories: ['finance', 'payments'], teamRoles: FINANCE_AGENT_ROLES },
  unit_acquisition_manager: { categories: ['units', 'acquisition'], teamRoles: UNIT_ACQUISITION_ROLES },
};

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const EXPORT_LIMIT = 20000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Every source of staff activity, normalised to one shape. Finance desk entries and inbox
// actions live in their own tables, so they are merged in here rather than copied.
const FEED_SQL = `
  WITH feed AS (
    SELECT 'a' || a.id AS uid, 'audit' AS source, a.created_at, a.user_id,
           COALESCE(s.full_name, a.actor_name) AS actor_name,
           COALESCE(s.role, a.actor_role) AS actor_role,
           a.action, a.entity_type, a.entity_id, COALESCE(a.details, '{}'::jsonb) AS details,
           a.reservation_id, a.unit_id,
           COALESCE(NULLIF(btrim(u.unit_number), ''), a.unit_code) AS unit_code,
           u.compound AS unit_compound,
           r.guest_name AS reservation_guest, r.check_in AS reservation_check_in,
           r.check_out AS reservation_check_out
    FROM audit_log a
    LEFT JOIN staff_users s ON s.id = a.user_id
    LEFT JOIN units u ON u.id = a.unit_id
    LEFT JOIN reservations r ON r.id = a.reservation_id
    UNION ALL
    SELECT 'm' || e.id, 'finance', e.created_at, e.created_by, s.full_name, s.role,
           'MANUAL_ENTRY', 'financial_manual_entry', e.id::text,
           jsonb_build_object('description', e.description, 'amount', e.amount,
                              'entry_type', e.entry_type, 'entry_date', e.entry_date, 'notes', e.notes),
           NULL::integer, e.unit_id, NULLIF(btrim(u.unit_number), ''), u.compound, NULL, NULL::date, NULL::date
    FROM financial_manual_entries e
    LEFT JOIN staff_users s ON s.id = e.created_by
    LEFT JOIN units u ON u.id = e.unit_id
    UNION ALL
    SELECT 'h' || hb.id, 'finance', hb.created_at, hb.created_by, s.full_name, s.role,
           'HOLDBACK_CREATED', 'holdback', hb.id::text,
           jsonb_build_object('amount', hb.amount, 'reason', hb.reason, 'owner_name', o.full_name),
           NULL::integer, hb.unit_id, NULLIF(btrim(u.unit_number), ''), u.compound, NULL, NULL::date, NULL::date
    FROM financial_owner_holdbacks hb
    LEFT JOIN staff_users s ON s.id = hb.created_by
    LEFT JOIN staff_users o ON o.id = hb.owner_id
    LEFT JOIN units u ON u.id = hb.unit_id
    UNION ALL
    SELECT 'b' || bs.id, 'finance', bs.created_at, bs.created_by, s.full_name, s.role,
           'BANK_SNAPSHOT', 'bank_snapshot', bs.id::text,
           jsonb_build_object('account_code', bs.account_code, 'statement_balance', bs.statement_balance,
                              'statement_date', bs.statement_date, 'notes', bs.notes),
           NULL::integer, NULL::uuid, NULL, NULL, NULL, NULL::date, NULL::date
    FROM financial_bank_snapshots bs
    LEFT JOIN staff_users s ON s.id = bs.created_by
    UNION ALL
    SELECT 'i' || ev.id, 'inbox', to_timestamp(ev.at / 1000.0), ev.user_id, s.full_name, s.role,
           'INBOX_' || upper(ev.type), 'conversation', ev.conversation_id::text,
           jsonb_build_object('conversation_id', ev.conversation_id, 'lead_id', ev.lead_id,
                              'data', CASE WHEN ev.data_json IS NULL OR ev.data_json = '' THEN NULL ELSE ev.data_json::jsonb END),
           NULL::integer, NULL::uuid, NULL, NULL, NULL, NULL::date, NULL::date
    FROM inbox_events ev
    LEFT JOIN staff_users s ON s.id = ev.user_id
    WHERE ev.user_id IS NOT NULL
  ),
  events AS (
    SELECT feed.*, ${categorySql('feed.action')} AS category,
           to_char(feed.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS ts_key
    FROM feed
  )
`;

function list(value) {
  if (value == null || value === '') return [];
  return (Array.isArray(value) ? value : String(value).split(','))
    .map((v) => String(v).trim())
    .filter(Boolean);
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify({ t: row.ts_key, u: row.uid })).toString('base64url');
}

function decodeCursor(value) {
  try {
    const c = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (typeof c?.t === 'string' && typeof c?.u === 'string') return c;
  } catch {
    /* ignore a malformed cursor */
  }
  return null;
}

async function resolveScope(user) {
  if (user.role === 'admin') return { admin: true, categories: CATEGORY_KEYS, teamIds: null };
  // Per-user page access: 'all' sees everything, 'team' sees their direct reports in any area.
  if (hasCustomAccess(user)) {
    const grant = pageGrant(user, 'audit_log');
    if (!grant) return null;
    if (grant.scope === 'all') return { admin: true, categories: CATEGORY_KEYS, teamIds: null };
    const { rows } = await query(`SELECT id FROM staff_users WHERE id = $1 OR manager_id = $1`, [user.id]);
    return { admin: false, categories: CATEGORY_KEYS, teamIds: rows.map((r) => Number(r.id)) };
  }
  const scope = MANAGER_SCOPES[user.role];
  if (!scope) return null;
  const { rows } = await query(
    `SELECT id FROM staff_users WHERE (id = $1 OR manager_id = $1) AND role = ANY($2::text[])`,
    [user.id, scope.teamRoles]
  );
  const teamIds = rows.map((r) => Number(r.id));
  if (!teamIds.includes(Number(user.id))) teamIds.push(Number(user.id));
  return { admin: false, categories: scope.categories, teamIds };
}

/**
 * Builds the WHERE clause. `skip` drops one filter so a facet can count across it
 * (the category chips show counts for every category, not only the selected one).
 */
function buildWhere(q, scope, { skip } = {}) {
  const params = [];
  const where = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (!scope.admin) {
    where.push(`user_id = ANY(${add(scope.teamIds)}::int[])`);
    where.push(`category = ANY(${add(scope.categories)}::text[])`);
  }

  const categories = list(q.category).filter((c) => scope.categories.includes(c));
  if (categories.length && skip !== 'category') where.push(`category = ANY(${add(categories)}::text[])`);

  const actors = list(q.actor).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (actors.length && skip !== 'actor') where.push(`user_id = ANY(${add(actors)}::int[])`);

  const actions = list(q.action);
  if (actions.length) where.push(`action = ANY(${add(actions)}::text[])`);

  if (DATE_RE.test(String(q.from || ''))) {
    where.push(`created_at >= (${add(q.from)}::date::timestamp AT TIME ZONE 'Africa/Cairo')`);
  }
  if (DATE_RE.test(String(q.to || ''))) {
    where.push(`created_at < ((${add(q.to)}::date + 1)::timestamp AT TIME ZONE 'Africa/Cairo')`);
  }

  const unit = String(q.unit || '').trim();
  if (unit) where.push(`unit_code ILIKE ${add(`%${unit}%`)}`);

  if (UUID_RE.test(String(q.unit_id || ''))) where.push(`unit_id = ${add(q.unit_id)}::uuid`);

  const reservationId = Number(q.reservation_id);
  if (Number.isInteger(reservationId) && reservationId > 0) {
    where.push(`reservation_id = ${add(reservationId)}`);
  }

  const search = String(q.q || '').trim();
  if (search) {
    const like = add(`%${search}%`);
    const tests = [
      `actor_name ILIKE ${like}`,
      `action ILIKE ${like}`,
      `unit_code ILIKE ${like}`,
      `reservation_guest ILIKE ${like}`,
      `entity_id ILIKE ${like}`,
      `details::text ILIKE ${like}`,
    ];
    const asNumber = search.replace(/^#/, '');
    if (/^\d{1,9}$/.test(asNumber)) tests.push(`reservation_id = ${add(Number(asNumber))}`);
    where.push(`(${tests.join(' OR ')})`);
  }

  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params, add };
}

/** Unit codes for any unit ids mentioned inside details (e.g. a transfer's from/to units). */
async function unitCodesFor(rows) {
  const ids = new Set();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.details || {})) {
      if (/unit_id$/.test(key) && UUID_RE.test(String(value || ''))) ids.add(String(value));
    }
  }
  if (!ids.size) return {};
  const { rows: units } = await query(
    `SELECT id, unit_number FROM units WHERE id = ANY($1::uuid[])`,
    [[...ids]]
  );
  return Object.fromEntries(units.filter((u) => u.unit_number).map((u) => [u.id, u.unit_number]));
}

function mapEvent(row) {
  return {
    id: row.uid,
    source: row.source,
    created_at: row.created_at,
    user_id: row.user_id,
    actor_name: row.actor_name,
    actor_role: row.actor_role,
    action: row.action,
    category: row.category,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    details: row.details || {},
    reservation_id: row.reservation_id,
    unit_id: row.unit_id,
    unit_code: row.unit_code,
    unit_compound: row.unit_compound,
    reservation: row.reservation_id
      ? {
          guest_name: row.reservation_guest,
          check_in: row.reservation_check_in,
          check_out: row.reservation_check_out,
        }
      : null,
  };
}

router.get('/audit-log', requireRoles(...AUDIT_ROLES), async (req, res, next) => {
  try {
    const scope = await resolveScope(req.user);
    if (!scope) return res.status(403).json({ error: 'Forbidden' });

    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.limit) || PAGE_SIZE));
    const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null;

    const page = buildWhere(req.query, scope);
    let pageWhere = page.where;
    if (cursor) {
      const t = page.add(cursor.t);
      const u = page.add(cursor.u);
      const keyset = `(created_at, uid) < ((${t}::timestamp AT TIME ZONE 'UTC'), ${u})`;
      pageWhere = pageWhere ? `${pageWhere} AND ${keyset}` : `WHERE ${keyset}`;
    }
    const limitParam = page.add(limit + 1);

    const eventsPromise = query(
      `${FEED_SQL} SELECT * FROM events ${pageWhere} ORDER BY created_at DESC, uid DESC LIMIT ${limitParam}`,
      page.params
    );

    // Summary and facets only on the first page; later pages just append rows.
    let summaryPromise = Promise.resolve(null);
    if (!cursor) {
      const byCategory = buildWhere(req.query, scope, { skip: 'category' });
      const byActor = buildWhere(req.query, scope, { skip: 'actor' });
      const totals = buildWhere(req.query, scope);
      summaryPromise = Promise.all([
        query(
          `${FEED_SQL} SELECT category, count(*)::int AS count FROM events ${byCategory.where} GROUP BY category`,
          byCategory.params
        ),
        query(
          `${FEED_SQL} SELECT user_id, max(actor_name) AS actor_name, max(actor_role) AS actor_role,
                  count(*)::int AS count
           FROM events ${byActor.where} GROUP BY user_id ORDER BY count(*) DESC`,
          byActor.params
        ),
        query(
          `${FEED_SQL} SELECT count(*)::int AS events, count(DISTINCT user_id)::int AS people,
                  count(DISTINCT COALESCE(unit_id::text, unit_code))::int AS units,
                  min(created_at) AS first_at
           FROM events ${totals.where}`,
          totals.params
        ),
      ]);
    }

    const [{ rows }, summary] = await Promise.all([eventsPromise, summaryPromise]);
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const unitCodes = await unitCodesFor(pageRows);

    const body = {
      events: pageRows.map(mapEvent),
      next_cursor: hasMore ? encodeCursor(pageRows[pageRows.length - 1]) : null,
      unit_codes: unitCodes,
    };

    if (summary) {
      const [categoryRows, actorRows, totalRows] = summary;
      const counts = Object.fromEntries(categoryRows.rows.map((r) => [r.category, r.count]));
      body.scope = { admin: scope.admin, categories: scope.categories };
      body.categories = scope.categories.map((key) => ({ key, count: counts[key] || 0 }));
      body.actors = actorRows.rows
        .filter((r) => r.user_id != null)
        .map((r) => ({ id: r.user_id, name: r.actor_name, role: r.actor_role, count: r.count }));
      body.totals = totalRows.rows[0] || { events: 0, people: 0, units: 0, first_at: null };
    }

    res.json(body);
  } catch (err) {
    next(err);
  }
});

function csvCell(value) {
  if (value == null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

router.get('/audit-log/export', requireRoles(...AUDIT_ROLES), async (req, res, next) => {
  try {
    const scope = await resolveScope(req.user);
    if (!scope) return res.status(403).json({ error: 'Forbidden' });

    const filters = buildWhere(req.query, scope);
    const limitParam = filters.add(EXPORT_LIMIT);
    const { rows } = await query(
      `${FEED_SQL}
       SELECT *, to_char(created_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD HH24:MI:SS') AS cairo_time
       FROM events ${filters.where}
       ORDER BY created_at DESC, uid DESC
       LIMIT ${limitParam}`,
      filters.params
    );

    const header = [
      'Time (Cairo)',
      'Person',
      'Role',
      'Category',
      'Action',
      'Unit code',
      'Compound',
      'Reservation #',
      'Guest',
      'Entity',
      'Entity ID',
      'Details',
    ];
    const lines = [header.join(',')];
    for (const row of rows) {
      lines.push(
        [
          row.cairo_time,
          row.actor_name,
          row.actor_role,
          row.category,
          row.action,
          row.unit_code,
          row.unit_compound,
          row.reservation_id,
          row.reservation_guest || row.details?.guest_name,
          row.entity_type,
          row.entity_id,
          row.details,
        ]
          .map(csvCell)
          .join(',')
      );
    }

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${stamp}.csv"`);
    if (rows.length >= EXPORT_LIMIT) res.setHeader('X-Audit-Truncated', String(EXPORT_LIMIT));
    // BOM so Excel opens Arabic names correctly.
    res.send(`﻿${lines.join('\r\n')}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
