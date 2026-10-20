const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');

const router = express.Router();
const TEAM_ROLES = ['unit_acquisition_agent', 'unit_acquisition_manager'];

function isoDate(value) {
  return String(value || '').slice(0, 10);
}

router.get('/acquisition-performance', requireRoles('admin', 'unit_acquisition_manager'), async (req, res, next) => {
  try {
    const to = isoDate(req.query.to_date) || new Date().toISOString().slice(0, 10);
    const fromDate = new Date(`${to}T12:00:00Z`);
    fromDate.setUTCDate(fromDate.getUTCDate() - 29);
    const from = isoDate(req.query.from_date) || fromDate.toISOString().slice(0, 10);
    const { rows: team } = await query(
      `SELECT id, full_name, role FROM staff_users
       WHERE COALESCE(is_active, 1)::int = 1 AND role = ANY($1::text[])
       ORDER BY full_name`,
      [TEAM_ROLES]
    );
    if (!team.length) {
      return res.json({ from, to, totals: { units: 0, team_size: 0 }, leaderboard: [] });
    }
    const ids = team.map((row) => row.id);
    const { rows } = await query(
      `SELECT u.created_by_staff AS staff_id, COUNT(*)::int AS units
       FROM units u
       WHERE u.created_by_staff = ANY($3::int[])
         AND (u.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1::date AND $2::date
       GROUP BY 1`,
      [from, to, ids]
    );
    const counts = new Map(rows.map((row) => [Number(row.staff_id), Number(row.units) || 0]));
    const { rows: kpiRows } = await query(
      `SELECT a.staff_user_id, t.target_value
       FROM kpi_targets t
       JOIN kpi_target_assignees a ON a.target_id = t.id
       WHERE a.staff_user_id = ANY($1::int[])
         AND t.metric = 'unit_acquisitions'
         AND t.starts_on <= $3::date
         AND t.deadline >= $2::date`,
      [ids, from, to]
    );
    const kpiByStaff = new Map(kpiRows.map((row) => [Number(row.staff_user_id), Number(row.target_value) || 0]));
    const leaderboard = team
      .map((member) => {
        const units = counts.get(Number(member.id)) || 0;
        const target = kpiByStaff.get(Number(member.id)) || 0;
        return {
          staff_id: member.id,
          full_name: member.full_name,
          role: member.role,
          units,
          kpi_target: target || null,
          kpi_percent: target > 0 ? Math.round((units / target) * 1000) / 10 : null,
        };
      })
      .sort((a, b) => b.units - a.units || String(a.full_name).localeCompare(String(b.full_name)));
    res.json({
      from,
      to,
      totals: {
        units: leaderboard.reduce((sum, row) => sum + row.units, 0),
        team_size: team.length,
      },
      leaderboard,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
