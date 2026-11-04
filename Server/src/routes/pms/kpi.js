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
  checklistCompletion,
  blendKpiPercent,
  eachDate,
  dayCount,
  kpiPace,
  dailyTarget,
  personScore,
  statusCounts,
  workingDays,
  STATUS_LABELS,
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

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/** Validates a KPI coming from the KPI page or a user record. */
function validateTargetInput(body, allowedMetrics) {
  const metric = String(body?.metric || '');
  if (!allowedMetrics.includes(metric)) throw badRequest('Choose a KPI type');
  const allowedMeasures = measuresForMetric(metric);
  const measure = allowedMeasures.includes(body?.measure) ? body.measure : allowedMeasures[0];
  const targetValue = Number(body?.target_value);
  const startsOn = isoDate(body?.starts_on);
  const deadline = isoDate(body?.deadline);
  if (metric === 'reviews') {
    if (!(targetValue >= 1 && targetValue <= 5)) throw badRequest('The review target must be a rating from 1 to 5');
  } else if (measure === 'value') {
    if (!(targetValue > 0)) throw badRequest('Enter the reservation value for this period');
  } else if (!Number.isFinite(targetValue) || targetValue < 1) {
    throw badRequest('Enter the target number');
  }
  if (!startsOn || !deadline || deadline < startsOn) throw badRequest('The deadline must be on or after the start date');
  if (dayCount(startsOn, deadline) > 120) throw badRequest('A KPI can cover at most 120 days');
  const weight = body?.weight == null || body.weight === '' ? 1 : Number(body.weight);
  if (!Number.isInteger(weight) || weight < 1 || weight > 5) throw badRequest('Importance must be from 1 to 5');
  const title = body?.title ? String(body.title).trim().slice(0, 80) || null : null;
  const notes = body?.notes ? String(body.notes).trim().slice(0, 500) || null : null;
  return { metric, measure, targetValue, startsOn, deadline, weight, title, notes };
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

  if (metric === 'check_ins') {
    const { rows } = await query(
      `SELECT r.ops_handed_over_by AS staff_id,
              (r.ops_handed_over_at AT TIME ZONE 'Africa/Cairo')::date::text AS day,
              COUNT(*)::int AS amount
       FROM reservations r
       WHERE r.status <> 'cancelled'
         AND COALESCE(r.ops_handed_over, 0)::int = 1
         AND r.ops_handed_over_at IS NOT NULL
         AND r.ops_handed_over_by = ANY($3::int[])
         AND (r.ops_handed_over_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1::date AND $2::date
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
            COALESCE(t.weight, 1)::int AS weight, t.title, t.notes,
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
          weight: Number(row.weight) || 1,
          title: row.title,
          notes: row.notes,
          created_by: row.created_by,
          created_by_name: row.created_by_name,
          staff_ids: [],
        };
        byTarget.set(row.id, target);
      }
      target.staff_ids.push(Number(row.staff_user_id));
    }

    const targetIds = [...byTarget.keys()];
    const checklistByTarget = new Map();
    const tickSet = new Set();
    if (targetIds.length) {
      const { rows: checklistRows } = await query(
        `SELECT c.id, c.target_id, c.title, c.weight_percent::float AS weight_percent, c.created_by,
                maker.full_name AS created_by_name,
                i.id AS item_id, i.label, i.sort_order,
                a.staff_user_id
         FROM kpi_checklists c
         LEFT JOIN staff_users maker ON maker.id = c.created_by
         LEFT JOIN kpi_checklist_items i ON i.checklist_id = c.id
         LEFT JOIN kpi_checklist_assignees a ON a.checklist_id = c.id
         WHERE c.target_id = ANY($1::int[])
         ORDER BY c.id, i.sort_order, i.id`,
        [targetIds]
      );
      for (const row of checklistRows) {
        let checklist = checklistByTarget.get(row.target_id);
        if (!checklist) {
          checklist = [];
          checklistByTarget.set(row.target_id, checklist);
        }
        let entry = checklist.find((item) => item.id === row.id);
        if (!entry) {
          entry = {
            id: row.id,
            title: row.title,
            weight_percent: Number(row.weight_percent),
            created_by: row.created_by,
            created_by_name: row.created_by_name,
            items: [],
            staff_ids: [],
          };
          checklist.push(entry);
        }
        if (row.item_id && !entry.items.some((item) => item.id === row.item_id)) {
          entry.items.push({ id: row.item_id, label: row.label });
        }
        if (row.staff_user_id && !entry.staff_ids.includes(Number(row.staff_user_id))) {
          entry.staff_ids.push(Number(row.staff_user_id));
        }
      }
      const checklistIds = [...checklistByTarget.values()].flat().map((item) => item.id);
      if (checklistIds.length) {
        const { rows: ticks } = await query(
          `SELECT t.item_id, t.staff_user_id, t.work_date::text AS work_date
           FROM kpi_checklist_ticks t
           JOIN kpi_checklist_items i ON i.id = t.item_id
           WHERE i.checklist_id = ANY($1::int[])`,
          [checklistIds]
        );
        for (const tick of ticks) {
          tickSet.add(`${tick.staff_user_id}|${tick.item_id}|${String(tick.work_date).slice(0, 10)}`);
        }
      }
    }

    // Working days per person (days off and approved leave are not expected checklist days).
    const personIds = directory.map((p) => Number(p.id));
    const daysOffById = new Map();
    const leaveById = new Map();
    if (personIds.length && byTarget.size) {
      const starts = [...byTarget.values()].map((t) => t.starts_on).sort();
      const ends = [...byTarget.values()].map((t) => t.deadline).sort();
      const [{ rows: offRows }, { rows: leaveRows }] = await Promise.all([
        query(`SELECT id, days_off FROM staff_users WHERE id = ANY($1::int[])`, [personIds]),
        query(
          `SELECT staff_user_id, start_date::text AS start_date, end_date::text AS end_date
           FROM staff_leave_requests
           WHERE staff_user_id = ANY($1::int[]) AND status = 'approved'
             AND start_date <= $3::date AND end_date >= $2::date
             AND leave_type NOT IN ('paid_excuse', 'unpaid_excuse', 'early_leave', 'meeting', 'mission')`,
          [personIds, starts[0], ends[ends.length - 1]]
        ).catch(() => ({ rows: [] })),
      ]);
      for (const row of offRows) daysOffById.set(Number(row.id), row.days_off || []);
      for (const row of leaveRows) {
        const set = leaveById.get(Number(row.staff_user_id)) || new Set();
        for (const d of eachDate(row.start_date, row.end_date)) set.add(d);
        leaveById.set(Number(row.staff_user_id), set);
      }
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
        const workDays = workingDays(stats.days, {
          daysOff: daysOffById.get(Number(person.id)) || [],
          leaveDates: leaveById.get(Number(person.id)) || new Set(),
        });
        const checklists = (checklistByTarget.get(target.id) || [])
          .filter((checklist) => checklist.staff_ids.includes(Number(person.id)))
          .map((checklist) => {
            const checkedByDay = {};
            for (const date of workDays) {
              checkedByDay[date] = checklist.items.filter((item) => (
                tickSet.has(`${Number(person.id)}|${item.id}|${date}`)
              )).length;
            }
            const completion = checklistCompletion({
              days: workDays,
              itemCount: checklist.items.length,
              checkedByDay,
            });
            return {
              id: checklist.id,
              title: checklist.title,
              weight_percent: checklist.weight_percent,
              created_by_name: checklist.created_by_name,
              can_delete: req.user.role === 'admin' || Number(checklist.created_by) === Number(req.user.id),
              items: checklist.items.map((item) => ({
                id: item.id,
                label: item.label,
                checked_dates: stats.days.filter((date) => tickSet.has(`${Number(person.id)}|${item.id}|${date}`)),
              })),
              completion_percent: completion.percent,
              daily: completion.days,
            };
          });
        const percent = blendKpiPercent({
          metricPercent: score.percent,
          parts: checklists.map((checklist) => ({
            weight: checklist.weight_percent,
            percent: checklist.completion_percent,
          })),
        });
        const pace = kpiPace({
          metric: target.metric,
          actual,
          targetValue: target.target_value,
          startsOn: target.starts_on,
          deadline: target.deadline,
          today,
          reviewCount: reviewCount || 0,
        });
        // With a checklist, the blended percent decides achieved/missed at the end of the period.
        let status = pace.status;
        if (checklists.length && today > target.deadline) status = percent >= 100 ? 'achieved' : 'missed';
        kpis.push({
          id: target.id,
          title: target.title,
          notes: target.notes,
          weight: target.weight,
          status,
          status_label: STATUS_LABELS[status] || status,
          pace,
          daily_target: dailyTarget({
            metric: target.metric,
            targetValue: target.target_value,
            actual,
            todayValue: target.metric === 'reviews' ? 0 : stats.daily.get(`${Number(person.id)}|${today}`) || 0,
            startsOn: target.starts_on,
            deadline: target.deadline,
            today,
          }),
          work_days: workDays,
          metric: target.metric,
          metric_label: METRIC_LABELS[target.metric] || target.metric,
          measure: target.measure,
          measure_label: MEASURE_LABELS[target.measure] || target.measure,
          target_value: target.target_value,
          starts_on: target.starts_on,
          deadline: target.deadline,
          created_by_name: target.created_by_name,
          actual: score.actual,
          metric_percent: score.percent,
          percent,
          checklist_weight: checklists.reduce((sum, checklist) => sum + checklist.weight_percent, 0),
          checklists,
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
      // Current scorecard: KPIs running today, or ended in the last 7 days.
      const current = kpis.filter((k) => k.starts_on <= today && dayCount(k.deadline, today) <= 8);
      const score = personScore(current);
      staff.push({
        id: person.id,
        full_name: person.full_name,
        role: person.role,
        staff_code: person.staff_code,
        score: score.score,
        scored_kpis: score.counted,
        status_counts: statusCounts(current),
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
      statuses: STATUS_LABELS,
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
    const { metric, measure, targetValue, startsOn, deadline, weight, title, notes } = validateTargetInput(
      req.body,
      metricsForRole(req.user.role)
    );

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
           (metric, measure, target_value, reward_amount, min_percent, starts_on, deadline, created_by, weight, title, notes)
         VALUES ($1,$2,$3,NULL,0,$4::date,$5::date,$6,$7,$8,$9)
         RETURNING id`,
        [metric, measure, targetValue, startsOn, deadline, req.user.id, weight, title, notes]
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
      details: { metric, measure, title, weight, target_value: targetValue, starts_on: startsOn, deadline, staff: unique.length },
    });
    res.status(201).json({ id: targetId });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/** Change a KPI's target, dates, importance, name or notes (CEO or the manager who added it). */
router.patch('/kpi/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await query(
      `SELECT id, metric, measure, target_value::float AS target_value, starts_on::text AS starts_on,
              deadline::text AS deadline, COALESCE(weight, 1)::int AS weight, title, notes, created_by
       FROM kpi_targets WHERE id = $1`,
      [id]
    );
    const before = rows[0];
    if (!before) return res.status(404).json({ error: 'KPI not found' });
    if (req.user.role !== 'admin' && Number(before.created_by) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Only the CEO or the manager who added this KPI can change it' });
    }
    const next = validateTargetInput({ ...before, ...req.body, metric: before.metric }, [before.metric]);
    const { rows: updated } = await query(
      `UPDATE kpi_targets
       SET measure = $2, target_value = $3, starts_on = $4::date, deadline = $5::date, weight = $6, title = $7, notes = $8
       WHERE id = $1
       RETURNING id, metric, measure, target_value::float AS target_value, starts_on::text AS starts_on,
                 deadline::text AS deadline, weight, title, notes`,
      [id, next.measure, next.targetValue, next.startsOn, next.deadline, next.weight, next.title, next.notes]
    );
    await logAudit({
      userId: req.user.id,
      action: 'KPI_TARGET_UPDATE',
      entityType: 'kpi_target',
      entityId: id,
      details: { title: next.title || METRIC_LABELS[before.metric], before, after: updated[0] },
    });
    res.json(updated[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/** Copy a KPI into the next period of the same length, with the same people and checklists. */
router.post('/kpi/:id/repeat', async (req, res, next) => {
  try {
    if (!canManageKpi(req.user)) return res.status(403).json({ error: 'Only the CEO and managers can repeat a KPI' });
    const id = Number(req.params.id);
    const { rows } = await query(
      `SELECT id, metric, measure, target_value, starts_on::text AS starts_on, deadline::text AS deadline,
              COALESCE(weight, 1)::int AS weight, title, notes, created_by
       FROM kpi_targets WHERE id = $1`,
      [id]
    );
    const source = rows[0];
    if (!source) return res.status(404).json({ error: 'KPI not found' });
    if (req.user.role !== 'admin' && Number(source.created_by) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Only the CEO or the manager who added this KPI can repeat it' });
    }
    const length = dayCount(source.starts_on, source.deadline);
    const shift = (iso, days) => {
      const d = new Date(`${iso}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    // Whole calendar months repeat as the next calendar month; anything else keeps its length.
    const startsDay = Number(source.starts_on.slice(8, 10));
    const endsOnMonthEnd = shift(source.deadline, 1).slice(8, 10) === '01';
    let startsOn = shift(source.deadline, 1);
    let deadline = shift(startsOn, length - 1);
    if (startsDay === 1 && endsOnMonthEnd) {
      const nextMonthEnd = new Date(`${startsOn}T12:00:00Z`);
      nextMonthEnd.setUTCMonth(nextMonthEnd.getUTCMonth() + 1, 0);
      deadline = nextMonthEnd.toISOString().slice(0, 10);
    }
    const client = await pool.connect();
    let newId;
    try {
      await client.query('BEGIN');
      const { rows: created } = await client.query(
        `INSERT INTO kpi_targets
           (metric, measure, target_value, reward_amount, min_percent, starts_on, deadline, created_by, weight, title, notes)
         VALUES ($1,$2,$3,NULL,0,$4::date,$5::date,$6,$7,$8,$9) RETURNING id`,
        [source.metric, source.measure, source.target_value, startsOn, deadline, req.user.id, source.weight, source.title, source.notes]
      );
      newId = created[0].id;
      await client.query(
        `INSERT INTO kpi_target_assignees (target_id, staff_user_id)
         SELECT $2, a.staff_user_id FROM kpi_target_assignees a
         JOIN staff_users s ON s.id = a.staff_user_id AND COALESCE(s.is_active, 1)::int = 1
         WHERE a.target_id = $1`,
        [id, newId]
      );
      const { rows: lists } = await client.query(`SELECT id, title, weight_percent FROM kpi_checklists WHERE target_id = $1`, [id]);
      for (const list of lists) {
        const { rows: made } = await client.query(
          `INSERT INTO kpi_checklists (target_id, title, weight_percent, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
          [newId, list.title, list.weight_percent, req.user.id]
        );
        await client.query(
          `INSERT INTO kpi_checklist_items (checklist_id, label, sort_order)
           SELECT $2, label, sort_order FROM kpi_checklist_items WHERE checklist_id = $1`,
          [list.id, made[0].id]
        );
        await client.query(
          `INSERT INTO kpi_checklist_assignees (checklist_id, staff_user_id)
           SELECT $2, ca.staff_user_id FROM kpi_checklist_assignees ca
           JOIN kpi_target_assignees ta ON ta.staff_user_id = ca.staff_user_id AND ta.target_id = $3
           WHERE ca.checklist_id = $1`,
          [list.id, made[0].id, newId]
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
      action: 'KPI_TARGET_REPEAT',
      entityType: 'kpi_target',
      entityId: newId,
      details: { title: source.title || METRIC_LABELS[source.metric], from_kpi: id, starts_on: startsOn, deadline },
    });
    res.status(201).json({ id: newId, starts_on: startsOn, deadline });
  } catch (err) {
    next(err);
  }
});

router.delete('/kpi/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const staffId = Number(req.query.staff_id);
    const { rows } = await query(
      `SELECT created_by, metric, title, target_value, starts_on::text AS starts_on, deadline::text AS deadline
       FROM kpi_targets WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'KPI not found' });
    if (req.user.role !== 'admin' && Number(rows[0].created_by) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await logAudit({
      userId: req.user.id,
      action: 'KPI_TARGET_DELETE',
      entityType: 'kpi_target',
      entityId: id,
      details: { title: rows[0].title || METRIC_LABELS[rows[0].metric], before: rows[0], staff_id: staffId || null },
    });
    if (staffId) {
      await query(`DELETE FROM kpi_target_assignees WHERE target_id = $1 AND staff_user_id = $2`, [id, staffId]);
      await query(
        `DELETE FROM kpi_checklist_assignees a
         USING kpi_checklists c
         WHERE a.checklist_id = c.id AND c.target_id = $1 AND a.staff_user_id = $2`,
        [id, staffId]
      );
      await query(
        `DELETE FROM kpi_checklists c
         WHERE c.target_id = $1
           AND NOT EXISTS (SELECT 1 FROM kpi_checklist_assignees a WHERE a.checklist_id = c.id)`,
        [id]
      );
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

router.post('/kpi/:id/checklists', async (req, res, next) => {
  try {
    if (!canManageKpi(req.user)) {
      return res.status(403).json({ error: 'Only the CEO and managers can add a checklist' });
    }
    const targetId = Number(req.params.id);
    const { rows: targets } = await query(
      `SELECT id, starts_on::text AS starts_on, deadline::text AS deadline FROM kpi_targets WHERE id = $1`,
      [targetId]
    );
    if (!targets[0]) return res.status(404).json({ error: 'KPI not found' });
    const title = String(req.body?.title || '').trim().slice(0, 120);
    if (title.length < 2) return res.status(400).json({ error: 'Name the checklist' });
    const weight = Number(req.body?.weight_percent);
    if (!(weight > 0 && weight <= 100)) {
      return res.status(400).json({ error: 'Choose how much of the KPI this checklist is, from 1 to 100' });
    }
    const labels = (Array.isArray(req.body?.items) ? req.body.items : [])
      .map((item) => String(item || '').trim().slice(0, 160))
      .filter(Boolean)
      .slice(0, 12);
    if (!labels.length) return res.status(400).json({ error: 'Add at least one item to check each day' });

    const { rows: weightRows } = await query(
      `SELECT COALESCE(SUM(weight_percent), 0)::float AS used FROM kpi_checklists WHERE target_id = $1`,
      [targetId]
    );
    if (Number(weightRows[0]?.used || 0) + weight > 100) {
      return res.status(400).json({ error: 'Checklists on this KPI cannot add up to more than 100%' });
    }

    const { rows: assigneeRows } = await query(
      `SELECT staff_user_id FROM kpi_target_assignees WHERE target_id = $1`,
      [targetId]
    );
    const onTarget = new Set(assigneeRows.map((row) => Number(row.staff_user_id)));
    const assignable = await loadAssignable(req.user);
    const allowed = new Set(assignable.map((row) => Number(row.id)));
    const poolIds = [...onTarget].filter((id) => req.user.role === 'admin' || allowed.has(id));
    const scope = req.body?.scope === 'staff' ? 'staff' : 'all';
    let chosen = poolIds;
    if (scope === 'staff') {
      const ids = Array.isArray(req.body?.staff_ids) ? req.body.staff_ids.map(Number) : [];
      chosen = ids.filter((id) => poolIds.includes(id));
    }
    chosen = [...new Set(chosen)];
    if (!chosen.length) return res.status(400).json({ error: 'Choose at least one person on this KPI' });

    const client = await pool.connect();
    let checklistId;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO kpi_checklists (target_id, title, weight_percent, created_by)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [targetId, title, weight, req.user.id]
      );
      checklistId = rows[0].id;
      for (let index = 0; index < labels.length; index += 1) {
        await client.query(
          `INSERT INTO kpi_checklist_items (checklist_id, label, sort_order) VALUES ($1,$2,$3)`,
          [checklistId, labels[index], index]
        );
      }
      for (const staffId of chosen) {
        await client.query(
          `INSERT INTO kpi_checklist_assignees (checklist_id, staff_user_id) VALUES ($1,$2)`,
          [checklistId, staffId]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.status(201).json({ id: checklistId });
  } catch (err) {
    next(err);
  }
});

router.delete('/kpi/:id/checklists/:checklistId', async (req, res, next) => {
  try {
    const id = Number(req.params.checklistId);
    const { rows } = await query(
      `SELECT created_by FROM kpi_checklists WHERE id = $1 AND target_id = $2`,
      [id, Number(req.params.id)]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Checklist not found' });
    if (req.user.role !== 'admin' && Number(rows[0].created_by) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await query(`DELETE FROM kpi_checklists WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/kpi/checklists/:id/ticks', async (req, res, next) => {
  try {
    const checklistId = Number(req.params.id);
    const staffId = Number(req.body?.staff_id);
    const itemId = Number(req.body?.item_id);
    const workDate = isoDate(req.body?.date);
    const checked = Boolean(req.body?.checked);
    if (!staffId || !itemId || !workDate) return res.status(400).json({ error: 'Choose the person, the item, and the day' });

    const { rows } = await query(
      `SELECT c.created_by, t.starts_on::text AS starts_on, t.deadline::text AS deadline
       FROM kpi_checklists c
       JOIN kpi_targets t ON t.id = c.target_id
       JOIN kpi_checklist_items i ON i.checklist_id = c.id AND i.id = $2
       JOIN kpi_checklist_assignees a ON a.checklist_id = c.id AND a.staff_user_id = $3
       WHERE c.id = $1`,
      [checklistId, itemId, staffId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'That item is not on this person\'s checklist' });
    const today = cairoToday();
    if (workDate < rows[0].starts_on || workDate > rows[0].deadline || workDate > today) {
      return res.status(400).json({ error: 'That day is outside this KPI' });
    }
    const isManager = req.user.role === 'admin' || Number(rows[0].created_by) === Number(req.user.id);
    const canTick = isManager || Number(req.user.id) === staffId;
    if (!canTick) return res.status(403).json({ error: 'Forbidden' });
    // Staff tick their own list for today or yesterday; older days need their manager, so lists can't be backfilled.
    if (!isManager && dayCount(workDate, today) > 2) {
      return res.status(403).json({ error: 'You can tick today or yesterday. Ask your manager to fix older days.' });
    }

    if (checked) {
      await query(
        `INSERT INTO kpi_checklist_ticks (item_id, staff_user_id, work_date, checked_by)
         VALUES ($1,$2,$3::date,$4)
         ON CONFLICT (item_id, staff_user_id, work_date) DO NOTHING`,
        [itemId, staffId, workDate, req.user.id]
      );
    } else {
      await query(
        `DELETE FROM kpi_checklist_ticks
         WHERE item_id = $1 AND staff_user_id = $2 AND work_date = $3::date`,
        [itemId, staffId, workDate]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

function canSetStaffKpi(user) {
  return Boolean(user && (user.role === 'admin' || user.role === 'hr' || user.role === 'hr_supervisor' || canManageKpi(user)));
}

async function assertStaffKpiAccess(user, staffId) {
  const { rows } = await query(`SELECT id, role FROM staff_users WHERE id = $1`, [staffId]);
  const person = rows[0];
  if (!person || person.role === 'owner' || person.role === 'admin') {
    const err = new Error('KPIs are for staff members');
    err.status = 400;
    throw err;
  }
  if (!canSetStaffKpi(user)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  if (user.role === 'admin' || user.role === 'hr' || user.role === 'hr_supervisor') return person;
  const assignable = await loadAssignable(user);
  if (!assignable.some((row) => Number(row.id) === Number(staffId))) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  return person;
}

router.get('/users/:id/kpis', async (req, res, next) => {
  try {
    const staffId = Number(req.params.id);
    await assertStaffKpiAccess(req.user, staffId);
    const { rows } = await query(
      `SELECT t.id, t.metric, COALESCE(t.measure, 'count') AS measure, t.target_value,
              t.starts_on::text AS starts_on, t.deadline::text AS deadline,
              (SELECT COUNT(*)::int FROM kpi_target_assignees a2 WHERE a2.target_id = t.id) AS assignee_count
       FROM kpi_targets t
       JOIN kpi_target_assignees a ON a.target_id = t.id AND a.staff_user_id = $1
       ORDER BY t.deadline DESC, t.id DESC`,
      [staffId]
    );
    res.json(rows.map((row) => ({
      id: row.id,
      metric: row.metric,
      measure: row.measure,
      target_value: Number(row.target_value),
      starts_on: String(row.starts_on).slice(0, 10),
      deadline: String(row.deadline).slice(0, 10),
      shared: Number(row.assignee_count) > 1,
    })));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.put('/users/:id/kpis', async (req, res, next) => {
  try {
    const staffId = Number(req.params.id);
    await assertStaffKpiAccess(req.user, staffId);
    const incoming = Array.isArray(req.body?.kpis) ? req.body.kpis : [];
    const { rows: current } = await query(
      `SELECT t.id,
              (SELECT COUNT(*)::int FROM kpi_target_assignees a2 WHERE a2.target_id = t.id) AS assignee_count
       FROM kpi_targets t
       JOIN kpi_target_assignees a ON a.target_id = t.id AND a.staff_user_id = $1`,
      [staffId]
    );
    const currentIds = new Set(current.map((row) => Number(row.id)));
    const sharedIds = new Set(current.filter((row) => Number(row.assignee_count) > 1).map((row) => Number(row.id)));
    const kept = new Set();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of incoming) {
        const metric = String(row?.metric || '');
        if (!metricsForRole('admin').includes(metric)) {
          const err = new Error('Choose a KPI type');
          err.status = 400;
          throw err;
        }
        const allowedMeasures = measuresForMetric(metric);
        const measure = allowedMeasures.includes(row?.measure) ? row.measure : allowedMeasures[0];
        const targetValue = Number(row?.target_value);
        const startsOn = isoDate(row?.starts_on);
        const deadline = isoDate(row?.deadline);
        if (metric === 'reviews') {
          if (!(targetValue >= 1 && targetValue <= 5)) {
            const err = new Error('The review target must be a rating from 1 to 5');
            err.status = 400;
            throw err;
          }
        } else if (measure === 'value') {
          if (!(targetValue > 0)) {
            const err = new Error('Enter the reservation value for this period');
            err.status = 400;
            throw err;
          }
        } else if (!Number.isFinite(targetValue) || targetValue < 1) {
          const err = new Error('Enter the target number');
          err.status = 400;
          throw err;
        }
        if (!startsOn || !deadline || deadline < startsOn || eachDate(startsOn, deadline).length > 120) {
          const err = new Error('Set a start and a deadline within 120 days');
          err.status = 400;
          throw err;
        }

        const existingId = Number(row?.id);
        if (existingId && currentIds.has(existingId)) {
          kept.add(existingId);
          if (sharedIds.has(existingId)) continue;
          await client.query(
            `UPDATE kpi_targets
             SET metric = $2, measure = $3, target_value = $4, starts_on = $5::date, deadline = $6::date
             WHERE id = $1`,
            [existingId, metric, measure, targetValue, startsOn, deadline]
          );
          continue;
        }
        const { rows: created } = await client.query(
          `INSERT INTO kpi_targets
             (metric, measure, target_value, reward_amount, min_percent, starts_on, deadline, created_by)
           VALUES ($1,$2,$3,NULL,0,$4::date,$5::date,$6)
           RETURNING id`,
          [metric, measure, targetValue, startsOn, deadline, req.user.id]
        );
        await client.query(
          `INSERT INTO kpi_target_assignees (target_id, staff_user_id) VALUES ($1,$2)`,
          [created[0].id, staffId]
        );
        kept.add(created[0].id);
      }

      for (const row of current) {
        const id = Number(row.id);
        if (kept.has(id)) continue;
        await client.query(
          `DELETE FROM kpi_target_assignees WHERE target_id = $1 AND staff_user_id = $2`,
          [id, staffId]
        );
        await client.query(
          `DELETE FROM kpi_checklist_assignees a
           USING kpi_checklists c
           WHERE a.checklist_id = c.id AND c.target_id = $1 AND a.staff_user_id = $2`,
          [id, staffId]
        );
        await client.query(
          `DELETE FROM kpi_checklists c
           WHERE c.target_id = $1
             AND NOT EXISTS (SELECT 1 FROM kpi_checklist_assignees a WHERE a.checklist_id = c.id)`,
          [id]
        );
        await client.query(
          `DELETE FROM kpi_targets t
           WHERE t.id = $1
             AND NOT EXISTS (SELECT 1 FROM kpi_target_assignees a WHERE a.target_id = t.id)`,
          [id]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
