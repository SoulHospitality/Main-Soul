/**
 * Backfill utilities:
 * 1) Units missing utilities_cost → project peer average (fallback 500)
 * 2) Reservations → nights * unit.utilities_cost
 */
require('dotenv').config();
const { query, pool } = require('../src/config/db');

const DRY = process.argv.includes('--dry-run');
const DEFAULT_RATE = 500;

(async () => {
  // Most common utilities_cost per project (fallback DEFAULT_RATE)
  const { rows: projects } = await query(`
    SELECT
      COALESCE(project, compound, '') AS project_key,
      mode() WITHIN GROUP (ORDER BY utilities_cost) FILTER (WHERE COALESCE(utilities_cost, 0) > 0) AS mode_rate
    FROM units
    GROUP BY 1
  `);
  const rateByProject = new Map(
    projects.map((p) => [
      String(p.project_key || '').toLowerCase(),
      p.mode_rate && Number(p.mode_rate) > 0 ? Math.round(Number(p.mode_rate)) : DEFAULT_RATE,
    ])
  );

  const { rows: missingUnits } = await query(`
    SELECT id, unit_number, COALESCE(project, compound, '') AS project
    FROM units
    WHERE COALESCE(utilities_cost, 0) = 0
  `);

  console.log(`[units] missing rate=${missingUnits.length} dry=${DRY}`);
  let unitsUpdated = 0;
  for (const u of missingUnits) {
    const rate = rateByProject.get(String(u.project || '').toLowerCase()) || DEFAULT_RATE;
    if (DRY) {
      console.log(`  would set ${u.unit_number || u.id} → ${rate}`);
    } else {
      await query(`UPDATE units SET utilities_cost = $2, updated_at = now() WHERE id = $1`, [
        u.id,
        rate,
      ]);
    }
    unitsUpdated += 1;
  }

  const preview = (
    await query(`
      SELECT count(*)::int AS n,
             sum(COALESCE(r.nights, 0) * COALESCE(u.utilities_cost, 0))::float AS total_util
      FROM reservations r
      JOIN units u ON u.id = r.unit_id
      WHERE r.status IS DISTINCT FROM 'cancelled'
        AND COALESCE(r.nights, 0) > 0
        AND COALESCE(u.utilities_cost, 0) > 0
        AND abs(
          COALESCE(r.utilities_amount, 0)
          - (COALESCE(r.nights, 0) * COALESCE(u.utilities_cost, 0))
        ) > 0.009
    `)
  ).rows[0];

  console.log(`[reservations] to_fix=${preview.n} expected_util_sum=${preview.total_util}`);

  if (!DRY) {
    const { rows: updated } = await query(`
      UPDATE reservations r
      SET utilities_amount = ROUND((COALESCE(r.nights, 0) * COALESCE(u.utilities_cost, 0))::numeric, 2),
          updated_at = now()
      FROM units u
      WHERE r.unit_id = u.id
        AND r.status IS DISTINCT FROM 'cancelled'
        AND COALESCE(r.nights, 0) > 0
        AND COALESCE(u.utilities_cost, 0) > 0
        AND abs(
          COALESCE(r.utilities_amount, 0)
          - (COALESCE(r.nights, 0) * COALESCE(u.utilities_cost, 0))
        ) > 0.009
      RETURNING r.id
    `);

    const after = (
      await query(`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE COALESCE(utilities_amount, 0) = 0)::int AS still_zero,
          count(*) FILTER (WHERE COALESCE(utilities_amount, 0) > 0)::int AS has_util,
          avg(utilities_amount) FILTER (WHERE utilities_amount > 0)::float AS avg_util
        FROM reservations
        WHERE status IS DISTINCT FROM 'cancelled'
      `)
    ).rows[0];

    console.log(
      JSON.stringify(
        { unitsUpdated, reservationsUpdated: updated.length, after },
        null,
        2
      )
    );
  } else {
    console.log(JSON.stringify({ unitsWouldUpdate: unitsUpdated, dry: true }, null, 2));
  }

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
