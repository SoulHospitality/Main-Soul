/**
 * Inventory new Main Soul DB (read-only).
 * Usage: node scripts/inventory-new-pms.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Client } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing in Server/.env');
  process.exit(1);
}

(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const tables = ['reservations', 'payments', 'expenses', 'commissions', 'units', 'staff_users', 'petty_cash'];
  for (const t of tables) {
    try {
      const r = await c.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
      console.log(`${t}: ${r.rows[0].n}`);
    } catch (e) {
      console.log(`${t}: MISSING (${e.code})`);
    }
  }
  try {
    const d = await c.query(
      `SELECT MIN(check_in)::text AS min_ci, MAX(check_in)::text AS max_ci FROM reservations WHERE status <> 'cancelled'`
    );
    console.log('reservation_range:', d.rows[0]);
  } catch (_) {}
  try {
    const u = await c.query(
      `SELECT COUNT(*)::int AS n FROM units WHERE LOWER(COALESCE(project,'')) LIKE '%galala%' OR LOWER(COALESCE(compound,'')) LIKE '%galala%'`
    );
    console.log('galala_units:', u.rows[0].n);
  } catch (_) {}
  await c.end();
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
