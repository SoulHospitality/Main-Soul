const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { isReservationsManager, isAdmin } = require('../../lib/reservationScope');

const router = express.Router();

const AGENT_ROLES = ['reservations', 'reservations_web', 'reservations_manual', 'reservations_manager'];
const TEAM_AGENT_ROLES = ['reservations', 'reservations_web', 'reservations_manual', 'reservations_manager'];

const ACTIVE_STAY_SQL = `
  r.status <> 'cancelled'
  AND NOT (
    COALESCE(r.is_owner_reservation, 0)::int = 1
    AND COALESCE(r.total_amount, 0) = 0
  )
`;
const CAIRO_CREATED_DATE = `(r.created_at AT TIME ZONE 'Africa/Cairo')::date`;
const CAIRO_TODAY = `(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo')::date`;

function isoDate(d) {
  return String(d || '').slice(0, 10);
}

function addDays(iso, n) {
  const dt = new Date(`${iso}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function defaultRange() {
  const to = new Date().toISOString().slice(0, 10);
  const fromDt = new Date(`${to}T12:00:00Z`);
  fromDt.setUTCDate(fromDt.getUTCDate() - 29);
  return { from: fromDt.toISOString().slice(0, 10), to };
}

router.get(
  '/reservations-performance',
  requireRoles('admin', 'reservations_manager'),
  async (req, res, next) => {
    try {
      if (!isAdmin(req.user) && !isReservationsManager(req.user)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const defaults = defaultRange();
      const from = isoDate(req.query.from_date) || defaults.from;
      const to = isoDate(req.query.to_date) || defaults.to;
      const admin = isAdmin(req.user);

      // Admin + Reservations Manager see the full reservation desk.
      const teamSql = `SELECT id, full_name, role FROM staff_users
           WHERE is_active = 1 AND role = ANY($1::text[])`;
      const roles = admin ? AGENT_ROLES : TEAM_AGENT_ROLES;
      const { rows: team } = await query(teamSql, [roles]);

      if (!team.length) {
        return res.json({
          from,
          to,
          today: null,
          totals: { total: 0, today: 0, team_size: 0 },
          daily: [],
          leaderboard: [],
        });
      }

      const teamIds = team.map((row) => row.id);
      const { rows: todayRows } = await query(`SELECT ${CAIRO_TODAY} AS today`);
      const today = isoDate(todayRows[0]?.today);

      const { rows: counted } = await query(
        `SELECT
           COALESCE(r.sales_person_id, r.created_by) AS staff_id,
           ${CAIRO_CREATED_DATE} AS day,
           COUNT(*)::int AS cnt,
           COALESCE(SUM(COALESCE(r.total_amount, 0)), 0)::float AS value
         FROM reservations r
         WHERE ${ACTIVE_STAY_SQL}
           AND ${CAIRO_CREATED_DATE} BETWEEN $1::date AND $2::date
           AND COALESCE(r.sales_person_id, r.created_by) = ANY($3::int[])
         GROUP BY 1, 2`,
        [from, to, teamIds]
      );

      const { rows: todayCounts } = await query(
        `SELECT COALESCE(r.sales_person_id, r.created_by) AS staff_id, COUNT(*)::int AS cnt
         FROM reservations r
         WHERE ${ACTIVE_STAY_SQL}
           AND ${CAIRO_CREATED_DATE} = ${CAIRO_TODAY}
           AND COALESCE(r.sales_person_id, r.created_by) = ANY($1::int[])
         GROUP BY 1`,
        [teamIds]
      );

      const todayByStaff = new Map(todayCounts.map((row) => [Number(row.staff_id), Number(row.cnt)]));
      const totalByStaff = new Map();
      const valueByStaff = new Map();
      const byDay = new Map();
      for (const row of counted) {
        const staffId = Number(row.staff_id);
        const day = isoDate(row.day);
        const cnt = Number(row.cnt) || 0;
        const value = Number(row.value) || 0;
        totalByStaff.set(staffId, (totalByStaff.get(staffId) || 0) + cnt);
        valueByStaff.set(staffId, (valueByStaff.get(staffId) || 0) + value);
        byDay.set(day, (byDay.get(day) || 0) + cnt);
      }

      const { rows: kpiRows } = await query(
        `SELECT a.staff_user_id, t.metric, COALESCE(t.measure, 'count') AS measure, t.target_value
         FROM kpi_targets t
         JOIN kpi_target_assignees a ON a.target_id = t.id
         WHERE a.staff_user_id = ANY($1::int[])
           AND t.metric = 'reservations'
           AND t.starts_on <= $3::date
           AND t.deadline >= $2::date`,
        [teamIds, from, to]
      );
      const kpiByStaff = new Map();
      for (const row of kpiRows) {
        const id = Number(row.staff_user_id);
        if (!kpiByStaff.has(id)) kpiByStaff.set(id, row);
      }

      const daily = [];
      if (from && to && from <= to) {
        for (let d = from; d <= to; d = addDays(d, 1)) {
          daily.push({ date: d, count: byDay.get(d) || 0 });
          if (daily.length > 366) break;
        }
      }

      const leaderboard = team
        .map((member) => {
          const id = Number(member.id);
          const total = totalByStaff.get(id) || 0;
          const value = Math.round((valueByStaff.get(id) || 0) * 100) / 100;
          const kpi = kpiByStaff.get(id);
          const target = Number(kpi?.target_value) || 0;
          const actual = kpi?.measure === 'value' ? value : total;
          const kpiPercent = target > 0 ? Math.round((actual / target) * 1000) / 10 : null;
          return {
            staff_id: member.id,
            full_name: member.full_name,
            role: member.role,
            total,
            value,
            today: todayByStaff.get(id) || 0,
            kpi_percent: kpiPercent,
            kpi_target: target || null,
            kpi_measure: kpi?.measure || null,
          };
        })
        .sort((a, b) => b.total - a.total || String(a.full_name).localeCompare(String(b.full_name)));

      const totals = {
        total: leaderboard.reduce((sum, row) => sum + row.total, 0),
        value: Math.round(leaderboard.reduce((sum, row) => sum + row.value, 0) * 100) / 100,
        today: leaderboard.reduce((sum, row) => sum + row.today, 0),
        team_size: team.length,
      };

      res.json({ from, to, today, totals, daily, leaderboard });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
