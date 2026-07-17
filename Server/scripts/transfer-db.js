/**
 * Copy all public schema data from SOURCE_DATABASE_URL → TARGET_DATABASE_URL.
 * Applies pending migrations on the target first if needed.
 *
 * Usage (from Server/):
 *   set SOURCE_DATABASE_URL=...
 *   set TARGET_DATABASE_URL=...
 *   node scripts/transfer-db.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function sslFor(url) {
  // Always disable cert verification for Supabase / remote Postgres over TLS
  if (/supabase\.co|amazonaws\.com|neon\.tech|sslmode=require/i.test(url || '')) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

function poolFor(url) {
  if (!url) throw new Error('Missing database URL');
  return new Pool({
    connectionString: url,
    ssl: sslFor(url) || { rejectUnauthorized: false },
    max: 2,
    connectionTimeoutMillis: 60000,
  });
}

/** Fix passwords that contain / $ @ etc. if not already encoded. */
function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return s;
  // Strip sslmode from URL — we set SSL via Pool options (rejectUnauthorized: false for Supabase)
  const withoutSsl = s.replace(/[?&]sslmode=[^&]*/gi, '').replace(/\?$/, '');
  if (/%[0-9A-Fa-f]{2}/.test(withoutSsl)) return withoutSsl;
  const m = withoutSsl.match(/^(postgresql:\/\/[^:]+:)([^@]+)(@.+)$/i);
  if (!m) return withoutSsl;
  return m[1] + encodeURIComponent(m[2]) + m[3];
}

async function listPublicTables(client) {
  const { rows } = await client.query(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname NOT LIKE 'pg_%'
    ORDER BY c.relname
  `);
  return rows.map((r) => r.table_name);
}

async function runMigrationsOn(pool) {
  const migrationsDir = path.join(__dirname, '../supabase/migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public._schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM public._schema_migrations WHERE id = $1', [file]);
    if (rows.length) {
      console.log('[migrate] skip', file);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO public._schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log('[migrate] applied', file);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[migrate] FAILED', file, err.message);
      throw err;
    } finally {
      client.release();
    }
  }
}

async function copyTable(src, dest, table) {
  const { rows } = await src.query(`SELECT * FROM public."${table}"`);
  if (!rows.length) {
    console.log(`[copy] ${table}: 0 rows`);
    return 0;
  }
  const cols = Object.keys(rows[0]);
  const colList = cols.map((c) => `"${c}"`).join(', ');
  const batchSize = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values = [];
    const params = [];
    let p = 1;
    for (const row of batch) {
      const placeholders = cols.map((c) => {
        params.push(row[c]);
        return `$${p++}`;
      });
      values.push(`(${placeholders.join(',')})`);
    }
    await dest.query(
      `INSERT INTO public."${table}" (${colList}) VALUES ${values.join(',')}`,
      params
    );
    inserted += batch.length;
  }
  console.log(`[copy] ${table}: ${inserted} rows`);
  return inserted;
}

async function main() {
  const sourceUrl = normalizeUrl(process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL);
  const targetUrl = normalizeUrl(process.env.TARGET_DATABASE_URL);
  if (!sourceUrl || !targetUrl) {
    throw new Error('Set SOURCE_DATABASE_URL (or DATABASE_URL) and TARGET_DATABASE_URL');
  }
  if (sourceUrl.replace(/\?.*/, '') === targetUrl.replace(/\?.*/, '')) {
    throw new Error('Source and target DATABASE_URL look identical');
  }

  const source = poolFor(sourceUrl);
  const target = poolFor(targetUrl);

  console.log('[transfer] Testing connections…');
  const srcHost = (await source.query('SELECT current_database() AS db, inet_server_addr()::text AS addr')).rows[0];
  const tgtHost = (await target.query('SELECT current_database() AS db, inet_server_addr()::text AS addr')).rows[0];
  console.log('[transfer] source ok', srcHost);
  console.log('[transfer] target ok', tgtHost);

  console.log('[transfer] Ensuring schema on target via migrations…');
  await runMigrationsOn(target);

  const tables = await (async () => {
    const c = await source.connect();
    try {
      return await listPublicTables(c);
    } finally {
      c.release();
    }
  })();

  console.log(`[transfer] ${tables.length} public tables`);

  const destClient = await target.connect();
  try {
    await destClient.query('SET session_replication_role = replica');
    // Clear target data (keep schema) in safe order
    for (const table of [...tables].reverse()) {
      await destClient.query(`TRUNCATE TABLE public."${table}" CASCADE`);
    }
    console.log('[transfer] truncated target tables');

    let total = 0;
    for (const table of tables) {
      total += await copyTable(source, destClient, table);
    }
    // Reset sequences so next inserts don't collide with copied IDs
    await destClient.query(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT
            n.nspname || '.' || c.relname AS seq,
            quote_ident(n2.nspname) || '.' || quote_ident(t.relname) AS tbl,
            quote_ident(a.attname) AS col
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'a'
          JOIN pg_class t ON t.oid = d.refobjid
          JOIN pg_namespace n2 ON n2.oid = t.relnamespace
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
          WHERE c.relkind = 'S' AND n.nspname = 'public'
        LOOP
          EXECUTE format(
            'SELECT setval(%L, COALESCE((SELECT MAX(%s)::bigint FROM %s), 1))',
            r.seq, r.col, r.tbl
          );
        END LOOP;
      END $$;
    `);
    await destClient.query('SET session_replication_role = DEFAULT');
    console.log(`[transfer] done — ${total} total rows copied`);
  } finally {
    destClient.release();
  }

  // Verify counts for key tables
  for (const table of ['units', 'staff_users', 'bookings', 'reservations', 'profiles']) {
    if (!tables.includes(table)) continue;
    const a = (await source.query(`SELECT count(*)::int AS c FROM public."${table}"`)).rows[0].c;
    const b = (await target.query(`SELECT count(*)::int AS c FROM public."${table}"`)).rows[0].c;
    console.log(`[verify] ${table}: source=${a} target=${b} ${a === b ? 'OK' : 'MISMATCH'}`);
  }

  await source.end();
  await target.end();
}

main().catch(async (err) => {
  console.error('[transfer] FAILED:', err.message);
  process.exit(1);
});
