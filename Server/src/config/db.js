require('dotenv').config({ path: require('path').join(__dirname, '../../.env') }); 
require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') }); 
const { Pool, types } = require('pg');
const fs = require('fs');
const path = require('path');

const useSsl =
  /supabase\.co|sslmode=require/i.test(process.env.DATABASE_URL || '') ||
  process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

types.setTypeParser(1082, (val) => val);

async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Migrations run on MIGRATION_DATABASE_URL when it is set (an owner/admin connection), so the app itself
 * can connect with DATABASE_URL as a restricted role that cannot change the schema, disable triggers or
 * read the ledger identity keys (docs/finance/db-security). Without it, the app's own connection is used,
 * as before.
 */
function migrationPool() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) return { db: pool, end: async () => {} };
  const ssl = /supabase\.co|sslmode=require/i.test(url) || process.env.NODE_ENV === 'production';
  const p = new Pool({ connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : false, max: 2 });
  return { db: p, end: () => p.end() };
}

async function runMigrations() {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  console.log(`[db] Migrations dir: ${migrationsDir}`);
  if (!fs.existsSync(migrationsDir)) {
    console.warn('[db] No migrations directory found, skipping auto-migrate');
    return;
  }
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  console.log(`[db] Found ${files.length} migration file(s)`);
  const { db: mpool, end } = migrationPool();
  if (mpool !== pool) console.log('[db] Running migrations on MIGRATION_DATABASE_URL');
  try {
    await runMigrationFiles(mpool, migrationsDir, files);
  } finally {
    await end();
  }
}

async function runMigrationFiles(pool, migrationsDir, files) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public._schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM public._schema_migrations WHERE id = $1', [file]);
    if (rows.length) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO public._schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[db] Applied migration ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[db] Migration ${file} failed:`, err.message);
      if (/wp_post_id|slug/i.test(err.message)) {
        console.error(
          '[db] Hint: your DATABASE_URL may point at the old PMS schema. Migration 000 archives legacy tables, then 001 creates the unified schema. Restart the server after pulling the latest migrations.'
        );
      }
      
      
      console.error(`[db] Continuing boot without ${file}; will retry next restart`);
    } finally {
      client.release();
    }
  }
}

async function listAppliedMigrations() {
  try {
    const { rows } = await query(
      `SELECT id, applied_at FROM public._schema_migrations ORDER BY id`
    );
    return rows;
  } catch {
    return [];
  }
}

module.exports = { pool, query, runMigrations, listAppliedMigrations };
