const express = require('express');
const { query, pool } = require('../../config/db');
const { logAudit } = require('../../lib/audit');
const { sqlStaffManagedBy } = require('../../lib/staffManagers');
const {
  METRIC_LABELS,
  RESERVATION_TEAM_ROLES,
  OPERATIONS_TEAM_ROLES,
  canManageKpi,
  metricsForRole,
  teamKeysForRole,
  kpiBonus,
  eachDate,
  roundMoney,
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

function filterTeam(rows, teamKey) {
  if (teamKey === 'reservations') {
    return rows.filter((row) => RESERVATION_TEAM_ROLES.includes(row.role));
  }
  if (teamKey === 'operations') {
    return rows.filter((row) => OPERATIONS_TEAM_ROLES.includes(row.role));
  }
  return rows;
}

async function progressFor(metric, staffIds, from, to) {
  const totals = new Map();
  const daily = new Map();
  if (!staffIds.length) return { totals, daily };
  let sql;
  if (metric === 'reservations') {
    sql = `SELECT COALESCE(r.sales_person_id, r.created_by) AS staff_id,
                  (r.created_at AT TIME ZONE 'Africa/Cairo')::date::text AS day,
                  COUNT(*)::int AS cnt
           FROM reservations r
           WHERE ${ACTIVE_STAY_SQL}
             AND COALESCE(r.sales_person_id, r.created_by) = ANY($3::int[])
             AND (r.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1::date AND $2::date
           GROUP BY 1, 2`;
  } else if (metric === 'check_ins') {
    sql = `SELECT r.ops_handed_over_by AS staff_id,
                  (r.ops_handed_over_at AT TIME ZONE 'Africa/Cairo')::date::text AS day,
                  COUNT(*)::int AS cnt
           FROM reservations r
           WHERE COALESCE(r.ops_handed_over, 0)::int = 1
             AND r.ops_handed_over_by = ANY($3::int[])
             AND (r.ops_handed_over_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1::date AND $2::date
           GROUP BY 1, 2`;
  } else {
    sql = `SELECT r.insurance_refunded_by AS staff_id,
                  r.insurance_refunded_at::date::text AS day,
                  COUNT(*)::int AS cnt
           FROM reservations r
           WHERE r.insurance_refunded_by = ANY($3::int[])
             AND r.insurance_refunded_at IS NOT NULL
             AND r.insurance_refunded_at::date BETWEEN $1::date AND $2::date
           GROUP BY 1, 2`;
  }
  const { rows } = await query(sql, [from, to, staffIds]);
  for (const row of rows) {
    const staffId = Number(row.staff_id);
    const count = Number(row.cnt) || 0;
    totals.set(staffId, (totals.get(staffId) || 0) + count);
    daily.set(`${staffId}|${row.day}`, count);
  }
  return { totals, daily };
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
    `SELECT t.id, t.metric, t.target_value, t.reward_amount, t.min_percent,
            t.starts_on::text AS starts_on, t.deadline::text AS deadline,
            t.created_by, t.created_at,
            maker.full_name AS created_by_name,
            a.staff_user_id, a.applied_bonus_id, a.applied_at,
            s.full_name, s.role, s.staff_code
     FROM kpi_targets t
     LEFT JOIN staff_users maker ON maker.id = t.created_by
     JOIN kpi_target_assignees a ON a.target_id = t.id
     JOIN staff_users s ON s.id = a.staff_user_id
     WHERE ${where}
     ORDER BY t.deadline DESC, t.id DESC, s.full_name`,
    params
  );
  return rows;
}

function groupTargets(rows) {
  const targets = [];
  const byId = new Map();
  for (const row of rows) {
    let target = byId.get(row.id);
    if (!target) {
      target = {
        id: row.id,
        metric: row.metric,
        metric_label: METRIC_LABELS[row.metric] || row.metric,
        target_value: Number(row.target_value),
        reward_amount: roundMoney(row.reward_amount),
        min_percent: Number(row.min_percent) || 0,
        starts_on: row.starts_on,
        deadline: row.deadline,
        created_by: row.created_by,
        created_by_name: row.created_by_name,
        assignees: [],
      };
      byId.set(row.id, target);
      targets.push(target);
    }
    target.assignees.push({
      staff_user_id: Number(row.staff_user_id),
      full_name: row.full_name,
      role: row.role,
      staff_code: row.staff_code,
      applied: Boolean(row.applied_at),
      applied_bonus_id: row.applied_bonus_id,
    });
  }
  return targets;
}

router.get('/kpi', async (req, res, next) => {
  try {
    if (req.user.role === 'owner') return res.status(403).json({ error: 'Forbidden' });
    const today = cairoToday();
    const assignable = canManageKpi(req.user) ? await loadAssignable(req.user) : [];
    const grouped = groupTargets(await loadVisibleTargets(req.user));
    const targets = [];
    for (const target of grouped) {
      const through = today < target.starts_on ? null : (today < target.deadline ? today : target.deadline);
      const { totals, daily } = through
        ? await progressFor(
        target.metric,
        target.assignees.map((person) => person.staff_user_id),
        target.starts_on,
        through
      )
        : { totals: new Map(), daily: new Map() };
      const days = through ? eachDate(target.starts_on, through) : [];
      const assignees = target.assignees.map((person) => {
        const count = totals.get(person.staff_user_id) || 0;
        const pay = kpiBonus({
          count,
          targetValue: target.target_value,
          rewardAmount: target.reward_amount,
          minPercent: target.min_percent,
        });
        return {
          ...person,
          count,
          percent: pay.percent,
          bonus: pay.bonus,
          eligible: pay.eligible,
          daily: days.map((date) => ({
            date,
            count: daily.get(`${person.staff_user_id}|${date}`) || 0,
          })),
        };
      });
      const open = assignees.some((person) => !person.applied);
      targets.push({
        ...target,
        assignees,
        days,
        can_apply:
          open &&
          today >= target.deadline &&
          (req.user.role === 'admin' || Number(target.created_by) === Number(req.user.id)),
        can_delete:
          assignees.every((person) => !person.applied) &&
          (req.user.role === 'admin' || Number(target.created_by) === Number(req.user.id)),
      });
    }
    res.json({
      today,
      can_manage: canManageKpi(req.user),
      metrics: metricsForRole(req.user.role).map((key) => ({ key, label: METRIC_LABELS[key] })),
      team_keys: teamKeysForRole(req.user.role),
      team: assignable,
      targets,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/kpi', async (req, res, next) => {
  try {
    if (!canManageKpi(req.user)) return res.status(403).json({ error: 'Only the CEO and managers can add a target' });
    const metric = String(req.body?.metric || '');
    if (!metricsForRole(req.user.role).includes(metric)) {
      return res.status(400).json({ error: 'Choose a target type this role can set' });
    }
    const targetValue = Math.round(Number(req.body?.target_value));
    const rewardAmount = roundMoney(req.body?.reward_amount);
    const minPercent = Number(req.body?.min_percent);
    const startsOn = isoDate(req.body?.starts_on);
    const deadline = isoDate(req.body?.deadline);
    if (!Number.isFinite(targetValue) || targetValue < 1) {
      return res.status(400).json({ error: 'Enter how many must be completed' });
    }
    if (!(rewardAmount > 0)) return res.status(400).json({ error: 'Enter the reward in EGP' });
    if (!Number.isFinite(minPercent) || minPercent < 0 || minPercent > 100) {
      return res.status(400).json({ error: 'Minimum percent must be between 0 and 100' });
    }
    if (!startsOn || !deadline || deadline < startsOn) {
      return res.status(400).json({ error: 'The deadline must be on or after the start date' });
    }
    if (eachDate(startsOn, deadline).length > 120) {
      return res.status(400).json({ error: 'A target can cover at most 120 days' });
    }

    const assignable = await loadAssignable(req.user);
    const allowed = new Map(assignable.map((row) => [Number(row.id), row]));
    const scope = req.body?.scope === 'staff' ? 'staff' : 'team';
    let chosen = assignable;
    if (req.user.role === 'admin' && scope === 'team') {
      const teamKey = ['reservations', 'operations', 'all'].includes(req.body?.team_key)
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
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO kpi_targets
           (metric, target_value, reward_amount, min_percent, starts_on, deadline, created_by)
         VALUES ($1,$2,$3,$4,$5::date,$6::date,$7)
         RETURNING id`,
        [metric, targetValue, rewardAmount, minPercent, startsOn, deadline, req.user.id]
      );
      const targetId = rows[0].id;
      for (const person of unique) {
        await client.query(
          `INSERT INTO kpi_target_assignees (target_id, staff_user_id) VALUES ($1,$2)`,
          [targetId, person.id]
        );
      }
      await client.query('COMMIT');
      await logAudit({
        userId: req.user.id,
        action: 'KPI_TARGET_CREATE',
        entityType: 'kpi_target',
        entityId: targetId,
        details: { metric, target_value: targetValue, staff: unique.length },
      });
      res.status(201).json({ id: targetId });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/kpi/:id/apply', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await query(
      `SELECT t.*, a.staff_user_id, a.applied_at, s.full_name
       FROM kpi_targets t
       JOIN kpi_target_assignees a ON a.target_id = t.id
       JOIN staff_users s ON s.id = a.staff_user_id
       WHERE t.id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Target not found' });
    const target = rows[0];
    if (req.user.role !== 'admin' && Number(target.created_by) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Only the CEO or the manager who added this target can add the bonus' });
    }
    const today = cairoToday();
    const deadline = String(target.deadline).slice(0, 10);
    if (today < deadline) {
      return res.status(400).json({ error: 'Bonuses can be added after the deadline' });
    }
    const open = rows.filter((row) => !row.applied_at);
    if (!open.length) return res.status(400).json({ error: 'This target is already on the payslips' });

    const { totals } = await progressFor(
      target.metric,
      open.map((row) => Number(row.staff_user_id)),
      String(target.starts_on).slice(0, 10),
      deadline
    );
    const label = METRIC_LABELS[target.metric] || target.metric;
    const results = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of open) {
        const count = totals.get(Number(row.staff_user_id)) || 0;
        const pay = kpiBonus({
          count,
          targetValue: target.target_value,
          rewardAmount: target.reward_amount,
          minPercent: target.min_percent,
        });
        let bonusId = null;
        if (pay.bonus > 0) {
          const { rows: bonusRows } = await client.query(
            `INSERT INTO staff_salary_bonuses (staff_user_id, amount, reason, bonus_date, created_by)
             VALUES ($1,$2,$3,$4::date,$5)
             RETURNING id`,
            [
              row.staff_user_id,
              pay.bonus,
              `${label} target ${count}/${target.target_value} (${pay.percent}%)`.slice(0, 255),
              deadline,
              req.user.id,
            ]
          );
          bonusId = bonusRows[0].id;
        }
        await client.query(
          `UPDATE kpi_target_assignees
           SET applied_bonus_id = $3, applied_at = now(), applied_by = $4
           WHERE target_id = $1 AND staff_user_id = $2 AND applied_at IS NULL`,
          [id, row.staff_user_id, bonusId, req.user.id]
        );
        results.push({
          staff_user_id: row.staff_user_id,
          full_name: row.full_name,
          count,
          percent: pay.percent,
          bonus: pay.bonus,
        });
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
      action: 'KPI_TARGET_APPLY',
      entityType: 'kpi_target',
      entityId: id,
      details: { people: results.length },
    });
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

router.delete('/kpi/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await query(
      `SELECT t.created_by, BOOL_OR(a.applied_at IS NOT NULL) AS applied
       FROM kpi_targets t
       LEFT JOIN kpi_target_assignees a ON a.target_id = t.id
       WHERE t.id = $1
       GROUP BY t.created_by`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Target not found' });
    if (req.user.role !== 'admin' && Number(rows[0].created_by) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (rows[0].applied) {
      return res.status(400).json({ error: 'This target is already on the payslips' });
    }
    await query(`DELETE FROM kpi_targets WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
