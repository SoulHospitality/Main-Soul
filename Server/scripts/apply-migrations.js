require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { runMigrations, pool } = require('../src/config/db');

(async () => {
  await runMigrations();
  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles' AND column_name='password_hash'`
  );
  console.log('password_hash column:', r.rows.length ? 'ok' : 'missing');
  await pool.end();
})().catch(async (e) => {
  console.error(e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
