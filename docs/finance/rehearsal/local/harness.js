// PGlite stand-in for the server's Postgres pool, with every migration applied.
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');

const fixRows = (rows) => rows.map((r) => {
  for (const k of Object.keys(r)) if (typeof r[k] === 'bigint') r[k] = Number(r[k]);
  return r;
});

/** Same semantics as src/config/db.js runMigrations: one transaction per file, recorded in _schema_migrations. */
async function applyMigration(db, S, file, sqlOverride) {
  const dir = path.join(S, 'supabase/migrations');
  const sql = (sqlOverride ?? fs.readFileSync(path.join(dir, file), 'utf8')).replace(/CREATE EXTENSION[^;]*;/gi, '');
  await db.exec(`CREATE TABLE IF NOT EXISTS public._schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = await db.query('SELECT 1 FROM public._schema_migrations WHERE id = $1', [file]);
  if (done.rows.length) return 'skipped';
  try {
    await db.exec('BEGIN');
    await db.exec(sql);
    await db.query('INSERT INTO public._schema_migrations (id) VALUES ($1)', [file]);
    await db.exec('COMMIT');
    return 'applied';
  } catch (e) {
    await db.exec('ROLLBACK').catch(() => {});
    throw new Error(`${file}: ${e.message}`);
  }
}

async function boot(S, { until = null } = {}) {
  const db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';`);
  const dir = path.join(S, 'supabase/migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (until && f.slice(0, 3) > until) continue;
    if (until) { await applyMigration(db, S, f); continue; }
    try {
      await db.exec(fs.readFileSync(path.join(dir, f), 'utf8').replace(/CREATE EXTENSION[^;]*;/gi, ''));
    } catch (e) {
      throw new Error(`${f}: ${e.message}`);
    }
  }
  // One connection: serialise every call so transactions don't interleave.
  let chain = Promise.resolve();
  let inTx = false;
  const raw = async (a, b) => {
    const text = typeof a === 'object' ? a.text : a;
    const values = typeof a === 'object' ? a.values : b;
    const r = await db.query(text, values || []);
    return { rows: fixRows(r.rows), rowCount: r.affectedRows ?? r.rows.length };
  };
  const queued = (a, b) => {
    if (inTx) return raw(a, b);
    const run = chain.then(() => raw(a, b));
    chain = run.catch(() => {});
    return run;
  };
  const pool = {
    query: queued,
    connect: async () => {
      let release;
      const gate = new Promise((r) => { release = r; });
      const prev = chain;
      chain = prev.then(() => gate);
      await prev;
      inTx = true;
      return {
        query: raw,
        release: () => { inTx = false; release(); },
      };
    },
  };
  const stub = (rel, exports) => {
    const p = require.resolve(path.join(S, rel));
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  };
  stub('src/config/db.js', { query: queued, pool });
  stub('src/config/socket.js', new Proxy({}, { get: () => () => {} }));
  return { db, pool, stub, query: queued };
}

module.exports = { boot, applyMigration };
