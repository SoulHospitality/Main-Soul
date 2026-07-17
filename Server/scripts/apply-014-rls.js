/**
 * Apply 014_enable_rls.sql immediately (also runs on next server boot via runMigrations).
 * Usage from Server/: node scripts/apply-014-rls.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: url.replace(/[?&]sslmode=[^&]*/gi, '').replace(/\?$/, ''),
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const file = '014_enable_rls.sql';
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations', file), 'utf8');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public._schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query('SELECT 1 FROM public._schema_migrations WHERE id = $1', [file]);
  if (rows.length) {
    console.log('Already applied:', file);
  } else {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO public._schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log('Applied', file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  const { rows: status } = await pool.query(`
    SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `);
  const off = status.filter((r) => !r.rls_enabled);
  console.log(`RLS enabled on ${status.filter((r) => r.rls_enabled).length}/${status.length} tables`);
  if (off.length) {
    console.log('Still unrestricted:', off.map((r) => r.table_name).join(', '));
    process.exitCode = 1;
  } else {
    console.log('All public tables have RLS enabled.');
  }
}

main()
  .catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
