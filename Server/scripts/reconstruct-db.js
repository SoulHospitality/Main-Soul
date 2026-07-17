/**
 * Reconstruct the unified Main Soul schema on DATABASE_URL.
 * Drops project tables (via migration 000) and reapplies 001–003.
 *
 * Usage (from Server/):
 *   node scripts/reconstruct-db.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool, runMigrations } = require('../src/config/db');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set in Server/.env');
  }

  console.log('[reconstruct] Clearing migration ledger…');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public._schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`DELETE FROM public._schema_migrations`);

  console.log('[reconstruct] Applying migrations (000 drop → 001 guest → 002 ops → 003 links)…');
  await runMigrations();

  const tables = await pool.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE 'pg_%'
    ORDER BY tablename
  `);
  console.log('[reconstruct] public tables:');
  console.log(tables.rows.map((r) => `  - ${r.tablename}`).join('\n'));

  const migs = await pool.query(`SELECT id FROM _schema_migrations ORDER BY id`);
  console.log('[reconstruct] migrations applied:', migs.rows.map((r) => r.id).join(', '));
  console.log('[reconstruct] done.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('[reconstruct] failed:', err.message);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
