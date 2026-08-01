/**
 * Dry-run inventory of old PMS DB (read-only).
 * Usage: node scripts/inventory-old-pms.js
 * Requires Server/.env.old-pms with OLD_PMS_DATABASE_URL=
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.old-pms') });
const { Client } = require('pg');

const url = process.env.OLD_PMS_DATABASE_URL;
if (!url || url.includes('[YOUR-PASSWORD]')) {
  console.error('Set OLD_PMS_DATABASE_URL in Server/.env.old-pms');
  process.exit(1);
}

(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const tables = [
    'reservations',
    'payments',
    'expenses',
    'commissions',
    'sales_commissions',
    'units',
    'users',
    'staff_users',
    'petty_cash',
  ];
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
      `SELECT MIN(check_in)::text AS min_ci, MAX(check_in)::text AS max_ci, COUNT(*)::int AS n FROM reservations`
    );
    console.log('reservation_range:', d.rows[0]);
  } catch (_) {}
  await c.end();
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
