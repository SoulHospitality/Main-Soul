// PGlite stand-in for the server's Postgres pool, with every migration applied.
const fs = require('fs');
const path = require('path');

const fixRows = (rows) => rows.map((r) => {
  for (const k of Object.keys(r)) if (typeof r[k] === 'bigint') r[k] = Number(r[k]);
  return r;
});

/** Same semantics as src/config/db.js runMigrations: one transaction per file, recorded in _schema_migrations. */
async function applyMigration(db, S, file, sqlOverride) {
  const dir = path.join(S, 'supabase/migrations');
  let sql = sqlOverride ?? fs.readFileSync(path.join(dir, file), 'utf8');
  // PGlite loads extensions at start-up; a real server runs CREATE EXTENSION as written.
  if (!db.realPostgres) sql = sql.replace(/CREATE EXTENSION[^;]*;/gi, '');
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
  const { PGlite } = require('@electric-sql/pglite');
  const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
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

/**
 * The same interface as boot(), on a REAL PostgreSQL server (embedded-postgres; local, disposable, synthetic data).
 * `db` mimics PGlite's exec/query result shape so the rehearsal runs unchanged; the app modules get a real pg Pool.
 * Needs `embedded-postgres` and `pg` on NODE_PATH. Call stop() at the end.
 */
async function bootReal(S, { until = null, port = 54332 } = {}) {
  const EmbeddedPostgres = require('embedded-postgres').default;
  const { Pool, Client } = require('pg');
  const password = 'local-only-' + require('crypto').randomBytes(6).toString('hex');
  const dataDir = path.join(require('os').tmpdir(), 'rehearsal-pg-' + Date.now());
  const server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password, port, persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  await server.createDatabase('rehearsal');
  const cfg = { host: '127.0.0.1', port, user: 'postgres', password, database: 'rehearsal' };
  const client = new Client(cfg);
  await client.connect();
  const shape = (r) => ({ fields: r.fields || [], rows: r.rows || [], affectedRows: r.rowCount });
  const db = {
    realPostgres: true,
    exec: async (sql) => { const r = await client.query(sql); return (Array.isArray(r) ? r : [r]).map(shape); },
    query: async (text, values) => shape(await client.query(text, values || [])),
  };
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';`);
  const dir = path.join(S, 'supabase/migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (until && f.slice(0, 3) > until) continue;
    await applyMigration(db, S, f);
  }
  const pool = new Pool({ ...cfg, max: 5 });
  const query = (a, b) => pool.query(a, b);
  const stub = (rel, exports) => {
    const p = require.resolve(path.join(S, rel));
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
  };
  stub('src/config/db.js', { query, pool });
  stub('src/config/socket.js', new Proxy({}, { get: () => () => {} }));
  const version = (await client.query('SELECT version()')).rows[0].version;
  const stop = async () => {
    await pool.end().catch(() => {});
    await client.end().catch(() => {});
    try { await server.stop(); } catch { /* Windows may hold files briefly */ }
  };
  const url = `postgres://postgres:${password}@127.0.0.1:${port}/rehearsal`;
  return { db, pool, stub, query, stop, version, url };
}

/**
 * Verified identity for tests (migration 176, review H3): a fresh random key, set in the environment for
 * lib/accounting/identity.js AND stored in ledger_identity_keys. Never a real key.
 */
async function provisionIdentity(query, keyId = 'test-key') {
  const hex = require('crypto').randomBytes(32).toString('hex');
  process.env.LEDGER_IDENTITY_KEY_ID = keyId;
  process.env.LEDGER_IDENTITY_KEY = hex;
  await query(`INSERT INTO ledger_identity_keys (key_id, secret) VALUES ($1, decode($2, 'hex'))`, [keyId, hex]);
  return { keyId, hex };
}

/**
 * SQL that sets a valid signed claim for `actorId` in the CURRENT transaction, computed in the database
 * from the stored key. Only possible because tests run as superuser and can read ledger_identity_keys;
 * the restricted application role cannot (docs/finance/db-security).
 */
function claimSql(actorId, keyId = 'test-key') {
  const a = Number(actorId);
  return `SELECT set_config('app.identity_claim',
      'v1.' || k.key_id || '.${a}.' || txid_current() || '.' || e.exp || '.act.' ||
      encode(ledger_hmac_sha256(k.secret, convert_to('v1|' || k.key_id || '|${a}|' || txid_current() || '|' || e.exp || '|act', 'UTF8')), 'hex'),
      true)
    FROM ledger_identity_keys k, (SELECT extract(epoch FROM clock_timestamp())::bigint + 300 AS exp) e
    WHERE k.key_id = '${keyId}'`;
}

module.exports = { boot, bootReal, applyMigration, provisionIdentity, claimSql };
