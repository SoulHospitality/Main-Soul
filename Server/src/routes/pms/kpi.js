const express = require('express');
const { query, pool } = require('../../config/db');
const { logAudit } = require('../../lib/audit');
const { sqlStaffManagedBy } = require('../../lib/staffManagers');
const {
  METRIC_LABELS,
  MEASURE_LABELS,
  RESERVATION_TEAM_ROLES,
  OPERATIONS_TEAM_ROLES,
  ACQUISITION_TEAM_ROLES,
  canManageKpi,
  metricsForRole,
  measuresForMetric,
  teamKeysForRole,
  kpiProgress,
  eachDate,
} = require('../../lib/kpi');

const router = express.Router();

const ACTIVE_STAY_SQL = `
  r.status <> 'cancelled'
  AND NOT (
    COALESCE(r.is_owner_reservation, 0)::int = 1
    AND COALESCE(r.total_amount, 0) = 0
  )
`;

function isoDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function loadAssignable(user) {
  if (user.role === 'admin') {
    const { rows } = await query(
      `SELECT id, full_name, role, staff_code
       FROM staff_users
       WHERE COALESCE(is_active, 1)::int = 1
         AND role NOT IN ('admin', 'owner')
       ORDER BY full_name`
    );
    return rows;
  }
  const { rows } = await query(
    `SELECT s.id, s.full_name, s.role, s.staff_code
     FROM staff_users s
     WHERE COALESCE(s.is_active, 1)::int = 1
       AND s.role NOT IN ('admin', 'owner')
       AND ${sqlStaffManagedBy('$1', 's')}
     ORDER BY s.full_name`,
    [user.id]
  );
  return rows;
}

async function loadDirectory(user) {
  if (user.role === 'admin' || canManageKpi(user)) {
    const people = await loadAssignable(user);
    if (user.role !== 'admin' && !people.some((person) => Number(person.id) === Number(user.id))) {
      people.unshift({
        id: user.id,
        full_name: user.full_name,
        role: user.role,
        staff_code: user.staff_code,
      });
    }
    return people;
  }
  const { rows } = await query(
    `SELECT id, full_name, role, staff_code FROM staff_users WHERE id = $1`,
    [user.id]
  );
  return rows;
}

function filterTeam(rows, teamKey) {
  if (teamKey === 'reservations') return rows.filter((row) => RESERVATION_TEAM_ROLES.includes(row.role));
  if (teamKey === 'operations') return rows.filter((row) => OPERATIONS_TEAM_ROLES.includes(row.role));
  if (teamKey === 'acquisition') return rows.filter((row) => ACQUISITION_TEAM_ROLES.includes(row.role));
  return rows;
}

async function progressFor(metric, measure, staffIds, from, to) {
  const totals = new Map();
  const daily = new Map();
  if (!staffIds.length) return { totals, daily };
  if (metric === 'reservations') {
    const valueSql = measure === 'value'
      ? 'COALESCE(SUM(COALESCE(r.total_amount, 0)), 0)::float'
      : 'COUNT(*)::int';
    const { rows } = await query(
      `SELECT COALESCE(r.sales_person_id, r.created_by) AS staff_id,
              (r.created_at AT TIME ZONE 'Africa/Cairo')::date::text AS day,
              ${valueSql} AS amount
       FROM reservations r
       WHERE ${ACTIVE_STAY_SQL}
         AND COALESCE(r.sales_person_id, r.created_by) = ANY($3::int[])
         AND (r.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1::date AND $2::date
       GROUP BY 1, 2`,
      [from, to, staffIds]
    );
    for (const row of rows) {
      const staffId = Number(row.staff_id);
      const amount = Number(row.amount) || 0;
      totals.set(staffId, (totals.get(staffId) || 0) + amount);
      daily.set(`${staffId}|${row.day}`, amount);
    }
    return { totals, daily };
  }

  if (metric === 'unit_acquisitions') {
    const { rows } = await query(
      `SELECT u.created_by_staff AS staff_id,
              (u.created_at AT TIME ZONE 'Africa/Cairo')::date::text AS day,
              COUNT(*)::int AS amount
       FROM units u
       WHERE u.created_by_staff = ANY($3::int[])
         AND (u.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1::date AND $2::date
       GROUP BY 1, 2`,
      [from, to, staffIds]
    );
    for (const row of rows) {
      const staffId = Number(row.staff_id);
      const amount = Number(row.amount) || 0;
      totals.set(staffId, (totals.get(staffId) || 0) + amount);
      daily.set(`${staffId}|${row.day}`, amount);
    }
    return { totals, daily };
  }

  const { rows } = await query(
    `SELECT staff_id, day, rating
     FROM (
       SELECT DISTINCT ON (rev.id)
              res.ops_handed_over_by AS staff_id,
              (rev.created_at AT TIME ZONE 'Africa/Cairo')::date::text AS day,
              rev.rating
       FROM reviews rev
       JOIN reservations res ON res.unit_id = rev.unit_id
         AND COALESCE(res.ops_handed_over, 0)::int = 1
         AND res.ops_handed_over_by IS NOT NULL
         AND res.status <> 'cancelled'
       LEFT JOIN profiles p ON p.id = rev.guest_user_id
       WHERE rev.published = true
         AND res.ops_handed_over_by = ANY($3::int[])
         AND (rev.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1::date AND $2::date
         AND res.check_in::date <= (rev.created_at AT TIME ZONE 'Africa/Cairo')::date
         AND (
           (p.email IS NOT NULL AND lower(p.email) = lower(COALESCE(res.guest_email, '')))
           OR lower(trim(rev.guest_name)) = lower(trim(COALESCE(res.guest_name, '')))
         )
       ORDER BY rev.id, res.check_out DESC NULLS LAST
     ) matched`,
    [from, to, staffIds]
  );
  const buckets = new Map();
  for (const row of rows) {
    const staffId = Number(row.staff_id);
    const rating = Number(row.rating) || 0;
    const key = `${staffId}|${row.day}`;
    const total = buckets.get(staffId) || { sum: 0, count: 0 };
    total.sum += rating;
    total.count += 1;
    buckets.set(staffId, total);
    const day = daily.get(key) || { sum: 0, count: 0 };
    day.sum += rating;
    day.count += 1;
    daily.set(key, day);
  }
  for (const [staffId, bucket] of buckets) {
    totals.set(staffId, {
      average: bucket.count ? Math.round((bucket.sum / bucket.count) * 10) / 10 : null,
      count: bucket.count,
    });
  }
  return { totals, daily, reviews: true };
}

async function loadVisibleTargets(user) {
  const params = [];
  let where = 'TRUE';
  if (user.role !== 'admin') {
    params.push(user.id);
    where = `(
      t.created_by = $1
      OR EXISTS (
        SELECT 1 FROM kpi_target_assignees mine
        WHERE mine.target_id = t.id AND mine.staff_user_id = $1
      )
      OR EXISTS (
        SELECT 1
        FROM kpi_target_assignees team
        JOIN staff_users s ON s.id = team.staff_user_id
        WHERE team.target_id = t.id
          AND ${sqlStaffManagedBy('$1', 's')}
      )
    )`;
  }
  const { rows } = await query(
    `SELECT t.id, t.metric, COALESCE(t.measure, 'count') AS measure, t.target_value,
            t.starts_on::text AS starts_on, t.deadline::text AS deadline,
            t.created_by, maker.full_name AS created_by_name,
            a.staff_user_id
     FROM kpi_targets t
     LEFT JOIN staff_users maker ON maker.id = t.created_by
     JOIN kpi_target_assignees a ON a.target_id = t.id
     WHERE ${where}
     ORDER BY t.deadline DESC, t.id DESC`,
    params
  );
  return rows;
}

router.get('/kpi', async (req, res, next) => {
  try {
    if (req.user.role === 'owner') return res.status(403).json({ error: 'Forbidden' });
    const today = cairoToday();
    const directory = await loadDirectory(req.user);
    const assignable = canManageKpi(req.user) ? await loadAssignable(req.user) : [];
    const rows = await loadVisibleTargets(req.user);
    const byTarget = new Map();
    for (const row of rows) {
      let target = byTarget.get(row.id);
      if (!target) {
        target = {
          id: row.id,
          metric: row.metric,
          measure: row.measure,
          target_value: Number(row.target_value),
          starts_on: row.starts_on,
          deadline: row.deadline,
          created_by: row.created_by,
          created_by_name: row.created_by_name,
          staff_ids: [],
        };
        byTarget.set(row.id, target);
      }
      target.staff_ids.push(Number(row.staff_user_id));
    }

    const progressCache = new Map();
    async function progress(target) {
      const key = `${target.id}`;
      if (progressCache.has(key)) return progressCache.get(key);
      const through = today < target.starts_on ? null : (today < target.deadline ? today : target.deadline);
      const result = through
        ? await progressFor(target.metric, target.measure, target.staff_ids, target.starts_on, through)
        : { totals: new Map(), daily: new Map(), reviews: target.metric === 'reviews' };
      result.days = through ? eachDate(target.starts_on, through) : [];
      progressCache.set(key, result);
      return result;
    }

    const staff = [];
    for (const person of directory) {
      const kpis = [];
      for (const target of byTarget.values()) {
        if (!target.staff_ids.includes(Number(person.id))) continue;
        const stats = await progress(target);
        const raw = stats.totals.get(Number(person.id));
        const actual = target.metric === 'reviews' ? (raw?.average ?? null) : (raw || 0);
        const reviewCount = target.metric === 'reviews' ? (raw?.count || 0) : null;
        const score = kpiProgress({ actual, targetValue: target.target_value });
        kpis.push({
          id: target.id,
          metric: target.metric,
          metric_label: METRIC_LABELS[target.metric] || target.metric,
          measure: target.measure,
          measure_label: MEASURE_LABELS[target.measure] || target.measure,
          target_value: target.target_value,
          starts_on: target.starts_on,
          deadline: target.deadline,
          created_by_name: target.created_by_name,
          actual: score.actual,
          percent: score.percent,
          review_count: reviewCount,
          days: stats.days,
          daily: stats.days.map((date) => {
            const cell = stats.daily.get(`${Number(person.id)}|${date}`);
            if (target.metric === 'reviews') {
              return {
                date,
                value: cell?.count ? Math.round((cell.sum / cell.count) * 10) / 10 : 0,
                count: cell?.count || 0,
              };
            }
            return { date, value: cell || 0 };
          }),
          can_delete: req.user.role === 'admin' || Number(target.created_by) === Number(req.user.id),
        });
      }
      staff.push({
        id: person.id,
        full_name: person.full_name,
        role: person.role,
        staff_code: person.staff_code,
        kpis,
      });
    }

    res.json({
      today,
      can_manage: canManageKpi(req.user),
      metrics: metricsForRole(req.user.role).map((key) => ({
        key,
        label: METRIC_LABELS[key],
        measures: measuresForMetric(key).map((measure) => ({
          key: measure,
          label: MEASURE_LABELS[measure],
        })),
      })),
      team_keys: teamKeysForRole(req.user.role),
      team: assignable,
      staff,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/kpi', async (req, res, next) => {
  try {
    if (!canManageKpi(req.user)) {
      return res.status(403).json({ error: 'Only the CEO and managers can add a KPI' });
    }
    const metric = String(req.body?.metric || '');
    if (!metricsForRole(req.user.role).includes(metric)) {
      return res.status(400).json({ error: 'Choose a KPI type' });
    }
    const allowedMeasures = measuresForMetric(metric);
    const measure = allowedMeasures.includes(req.body?.measure) ? req.body.measure : allowedMeasures[0];
    const targetValue = Number(req.body?.target_value);
    const startsOn = isoDate(req.body?.starts_on);
    const deadline = isoDate(req.body?.deadline);
    if (metric === 'reviews') {
      if (!(targetValue >= 1 && targetValue <= 5)) {
        return res.status(400).json({ error: 'The review target must be a rating from 1 to 5' });
      }
    } else if (measure === 'value') {
      if (!(targetValue > 0)) return res.status(400).json({ error: 'Enter the reservation value for this period' });
    } else if (!Number.isFinite(targetValue) || targetValue < 1) {
      return res.status(400).json({ error: 'Enter the target number' });
    }
    if (!startsOn || !deadline || deadline < startsOn) {
      return res.status(400).json({ error: 'The deadline must be on or after the start date' });
    }
    if (eachDate(startsOn, deadline).length > 120) {
      return res.status(400).json({ error: 'A KPI can cover at most 120 days' });
    }

    const assignable = await loadAssignable(req.user);
    const allowed = new Map(assignable.map((row) => [Number(row.id), row]));
    const scope = req.body?.scope === 'staff' ? 'staff' : 'team';
    let chosen = assignable;
    if (req.user.role === 'admin' && scope === 'team') {
      const teamKey = ['reservations', 'operations', 'acquisition', 'all'].includes(req.body?.team_key)
        ? req.body.team_key
        : 'all';
      chosen = filterTeam(assignable, teamKey);
    }
    if (scope === 'staff') {
      const ids = Array.isArray(req.body?.staff_ids) ? req.body.staff_ids.map(Number) : [];
      chosen = ids.filter((id) => allowed.has(id)).map((id) => allowed.get(id));
    }
    const unique = [];
    const seen = new Set();
    for (const person of chosen) {
      const id = Number(person.id);
      if (seen.has(id)) continue;
      seen.add(id);
      unique.push(person);
    }
    if (!unique.length) return res.status(400).json({ error: 'Choose at least one staff member' });

    const client = await pool.connect();
    let targetId;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO kpi_targets
           (metric, measure, target_value, reward_amount, min_percent, starts_on, deadline, created_by)
         VALUES ($1,$2,$3,NULL,0,$4::date,$5::date,$6)
         RETURNING id`,
        [metric, measure, targetValue, startsOn, deadline, req.user.id]
      );
      targetId = rows[0].id;
      for (const person of unique) {
        await client.query(
          `INSERT INTO kpi_target_assignees (target_id, staff_user_id) VALUES ($1,$2)`,
          [targetId, person.id]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    await logAudit({
      userId: req.user.id,
      action: 'KPI_TARGET_CREATE',
      entityType: 'kpi_target',
      entityId: targetId,
      details: { metric, measure, staff: unique.length },
    });
    res.status(201).json({ id: targetId });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.delete('/kpi/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const staffId = Number(req.query.staff_id);
    const { rows } = await query(`SELECT created_by FROM kpi_targets WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'KPI not found' });
    if (req.user.role !== 'admin' && Number(rows[0].created_by) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (staffId) {
      await query(`DELETE FROM kpi_target_assignees WHERE target_id = $1 AND staff_user_id = $2`, [id, staffId]);
      const { rows: left } = await query(`SELECT 1 FROM kpi_target_assignees WHERE target_id = $1 LIMIT 1`, [id]);
      if (!left.length) await query(`DELETE FROM kpi_targets WHERE id = $1`, [id]);
    } else {
      await query(`DELETE FROM kpi_targets WHERE id = $1`, [id]);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
