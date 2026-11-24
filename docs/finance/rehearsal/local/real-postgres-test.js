// GENUINE tests on a real PostgreSQL server (embedded-postgres, local only, synthetic data):
//  - migrations applied as the owner (the app's runner semantics), then docs/finance/db-security scripts;
//  - the posting service and identity module running as the RESTRICTED role soul_app;
//  - verified identity end to end, every forgery / bypass path, multi-session concurrency, normal PMS writes.
// Usage: NODE_PATH="<dir with embedded-postgres and pg>;<Server>/node_modules" node real-postgres-test.js <Server path>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EmbeddedPostgres = require('embedded-postgres').default;
const { Pool, Client } = require('pg');

const S = process.argv[2];
const REPO = path.join(S, '..');
const PORT = 54331;
const OWNER_PW = 'local-only-owner';
const APP_PW = 'local-only-app';
let failed = 0;
let passed = 0;
const evidence = [];
const ok = (cond, name, detail) => {
  evidence.push({ name, ok: !!cond, detail });
  if (cond) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name} :: ${JSON.stringify(detail).slice(0, 400)}`); }
};
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
// psql-style :'var' substitution for the DBA scripts (psql is not available here).
const psqlScript = (file, vars) => {
  let sql = fs.readFileSync(path.join(REPO, 'docs/finance/db-security', file), 'utf8');
  for (const [k, v] of Object.entries(vars)) sql = sql.split(`:'${k}'`).join(lit(v));
  return sql;
};

(async () => {
  const dir = path.join(require('os').tmpdir(), 'rpg-' + Date.now());
  const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: OWNER_PW, port: PORT, persistent: false,
    initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  await server.createDatabase('ledger');
  const cfg = (user, password) => ({ host: '127.0.0.1', port: PORT, user, password, database: 'ledger' });
  try {
    const owner = new Client(cfg('postgres', OWNER_PW));
    await owner.connect();
    console.log((await owner.query('SELECT version()')).rows[0].version);
    await owner.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';`);
    await owner.query(`CREATE TABLE IF NOT EXISTS public._schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const mdir = path.join(S, 'supabase/migrations');
    let applied = 0;
    for (const f of fs.readdirSync(mdir).filter((x) => x.endsWith('.sql')).sort()) {
      try {
        await owner.query('BEGIN');
        await owner.query(fs.readFileSync(path.join(mdir, f), 'utf8'));
        await owner.query('INSERT INTO public._schema_migrations (id) VALUES ($1)', [f]);
        await owner.query('COMMIT');
        applied++;
      } catch (e) { await owner.query('ROLLBACK').catch(() => {}); throw new Error(`${f}: ${e.message}`); }
    }
    ok(applied >= 176, `all ${applied} migrations apply on real PostgreSQL as the owner`);

    // DBA scripts: restricted role, then the identity key.
    await owner.query(psqlScript('ledger_roles.sql', { app_password: APP_PW }));
    const keyHex = crypto.randomBytes(32).toString('hex');
    await owner.query(psqlScript('provision_identity_key.sql', { key_id: 'k-local', key_hex: keyHex }));
    process.env.LEDGER_IDENTITY_KEY_ID = 'k-local';
    process.env.LEDGER_IDENTITY_KEY = keyHex;
    const role = (await owner.query(`SELECT rolsuper, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = 'soul_app'`)).rows[0];
    ok(role && !role.rolsuper && !role.rolcreaterole && !role.rolbypassrls, 'soul_app exists: not superuser, no CREATEROLE, no BYPASSRLS', role);
    await owner.query(`INSERT INTO staff_users (id, username, password_hash, full_name, role, is_active) VALUES
      (900,'r_admin1','x','R Admin 1','admin',1),(901,'r_admin2','x','R Admin 2','admin',1),(902,'r_rec','x','R Recorder','reservations',1)`);

    // The application runs as soul_app.
    const pool = new Pool({ ...cfg('soul_app', APP_PW), max: 20 });
    const p = require.resolve(path.join(S, 'src/config/db.js'));
    require.cache[p] = { id: p, filename: p, loaded: true, exports: { pool, query: (t, v) => pool.query(t, v) } };
    const posting = require(path.join(S, 'src/lib/accounting/posting.js'));
    const identity = require(path.join(S, 'src/lib/accounting/identity.js'));
    const app = new Client(cfg('soul_app', APP_PW));
    await app.connect();
    const attempt = async (sql, params) => { try { await app.query(sql, params); return 'ALLOWED'; } catch (e) { await app.query('ROLLBACK').catch(() => {}); return `refused (${e.message.slice(0, 90)})`; } };

    // ── Normal PMS operations as soul_app ──
    const unit = (await app.query(`INSERT INTO units (slug, title, unit_number, status, listing_type, compound, project, beds, baths, guests, company_commission_pct, commission_mode)
      VALUES ('rp-a','RP A','RP-A','published','rent','M','M',1,1,2,20,'A') RETURNING id`)).rows[0].id;
    const res = (await app.query(`INSERT INTO reservations (unit_id, guest_name, check_in, check_out, nights, total_amount, status, created_by)
      VALUES ($1,'Synthetic Guest','2027-03-01','2027-03-03',2,2000,'pending',902) RETURNING id`, [unit])).rows[0].id;
    await app.query(`UPDATE reservations SET status = 'confirmed' WHERE id = $1`, [res]);
    const snap = (await app.query(`SELECT commission_snapshot_status AS s FROM reservations WHERE id = $1`, [res])).rows[0].s;
    await app.query(`INSERT INTO payments (reservation_id, amount, payment_date, payment_method, status, kind) VALUES ($1, 500, '2027-03-01', 'cash', 'successful', 'collection')`, [res]);
    ok(snap === 'captured', 'normal PMS writes work as soul_app: unit, reservation, confirmation (snapshot captured by the SECURITY DEFINER trigger), payment');

    // ── Restricted role: bypass paths ──
    const b = {
      readKeys: await attempt('SELECT * FROM ledger_identity_keys'),
      truncate: await attempt('TRUNCATE ledger_entries CASCADE'),
      disable: await attempt('ALTER TABLE ledger_entries DISABLE TRIGGER ledger_entries_guard'),
      drop: await attempt('DROP TRIGGER ledger_entries_guard ON ledger_entries'),
      replica: await attempt('SET session_replication_role = replica'),
      setRole: await attempt('SET ROLE postgres'),
      createFn: await attempt(`CREATE FUNCTION public.ledger_verified_actor_x() RETURNS int LANGUAGE sql AS 'SELECT 900'`),
      replaceFn: await attempt(`CREATE OR REPLACE FUNCTION public.ledger_verified_actor() RETURNS int LANGUAGE sql AS 'SELECT 900'`),
      updKeys: await attempt(`UPDATE ledger_identity_keys SET active = true`),
      logInsert: await attempt(`INSERT INTO ledger_control_log (control, new_value, actor_id, reason) VALUES ('ledger_posting','on',900,'forged')`),
      corrInsert: await attempt(`INSERT INTO reservation_commission_corrections (reservation_id, corrected, reason, corrected_by) VALUES (${res}, '{}', 'forged correction', 900)`),
    };
    ok(Object.values(b).every((v) => v.startsWith('refused')), 'soul_app is refused: reading keys, TRUNCATE, DISABLE/DROP TRIGGER, session_replication_role, SET ROLE, creating or replacing functions, editing keys, forging log rows', b);

    // ── Verified identity ──
    const forged = await attempt(`BEGIN; SELECT set_config('app.identity_claim', 'v1.k-local.900.' || txid_current() || '.9999999999.act.' || repeat('cd', 32), true), set_config('app.control_reason', 'forged signature', true); UPDATE financial_settings SET value_text = 'on' WHERE key = 'ledger_posting'; COMMIT;`);
    const claimedId = await attempt(`BEGIN; SELECT set_config('app.actor_id', '900', true), set_config('app.control_reason', 'claimed id only', true); UPDATE financial_settings SET value_text = 'on' WHERE key = 'ledger_posting'; COMMIT;`);
    ok(forged.startsWith('refused') && claimedId.startsWith('refused'), 'soul_app cannot switch posting on with a forged signature or a claimed id (and cannot read the key to sign one)', { forged, claimedId });
    const forgedApproval = await attempt(`BEGIN; SELECT set_config('app.identity_claim', 'v1.k-local.901.' || txid_current() || '.9999999999.act.' || repeat('ef', 32), true); INSERT INTO ledger_approvals (purpose, subject, approver_id) VALUES ('policy_d01', 'RP-1', 901); COMMIT;`);
    ok(forgedApproval.startsWith('refused'), 'soul_app cannot record an approval in someone\'s name without the signing key', forgedApproval);

    // Approved policy: approvals by 900 (D-01) and 901 (VAT), recorded by 902, all signed by the app's key.
    await identity.recordApproval({ purpose: 'policy_d01', subject: 'RP-1', approverId: 900 });
    await identity.recordApproval({ purpose: 'policy_vat', subject: 'RP-1', approverId: 901 });
    const c = await pool.connect();
    await c.query('BEGIN');
    await identity.attestActor(c, 902);
    await c.query(`INSERT INTO ledger_policies (version, effective_from, settings, status, approved_by, approved_at, approval_ref, vat_approved_by, vat_approved_at, vat_approval_ref, created_by)
      VALUES ('RP-1', '2026-01-01', '{"revenue_presentation":"gross","vat_base":"fee_only"}', 'approved', 900, now(), 'SYNTHETIC', 901, now(), 'SYNTHETIC', 902)`);
    await c.query('COMMIT'); c.release();
    ok((await owner.query(`SELECT status FROM ledger_policies WHERE version = 'RP-1'`)).rows[0].status === 'approved', 'a policy is approved through verified approvals and a verified recorder, as soul_app');
    await posting.setPostingSwitch('on', { actorId: 900, reason: 'local real-postgres verification' });
    const log = (await owner.query(`SELECT actor_id, new_value FROM ledger_control_log ORDER BY id DESC LIMIT 1`)).rows[0];
    ok(log.new_value === 'on' && log.actor_id === 900, 'a verified admin switches posting on through the service; the log records the verified actor', log);

    // ── Concurrency (separate connections, truly concurrent, as soul_app) ──
    const entry = (key, amt = '100', extra = {}) => ({ transactionDate: '2026-11-10', description: 'concurrency', sourceType: 'test', sourceId: key, idempotencyKey: key,
      lines: [{ account: '103000', debit: amt }, { account: '105000', credit: amt }], ...extra });
    const r1 = await Promise.allSettled(Array.from({ length: 20 }, () => posting.postEntry(entry('conc:1'))));
    const f1 = r1.filter((x) => x.status === 'fulfilled').map((x) => x.value);
    const n1 = Number((await owner.query(`SELECT COUNT(*)::int n FROM ledger_entries WHERE idempotency_key = 'conc:1'`)).rows[0].n);
    ok(n1 === 1 && f1.length === 20 && f1.filter((x) => !x.duplicate).length === 1, '20 concurrent posts of one key: one entry, 19 duplicates', { n1, ok: f1.length });
    const r2 = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => posting.postEntry(entry('conc:2', String(100 + i)))));
    const n2 = Number((await owner.query(`SELECT COUNT(*)::int n FROM ledger_entries WHERE idempotency_key = 'conc:2'`)).rows[0].n);
    ok(n2 === 1 && r2.filter((x) => x.status === 'rejected' && /IDEMPOTENCY_CONFLICT/.test(x.reason.code || x.reason.message)).length === 19, '20 concurrent posts of one key with different amounts: one entry, 19 conflicts', { n2 });
    const target = f1[0].entry.id;
    const r3 = await Promise.allSettled(Array.from({ length: 10 }, () => posting.reverseEntry(target, { reason: 'concurrent reversal', actorId: 900, date: '2026-11-11' })));
    const n3 = Number((await owner.query(`SELECT COUNT(*)::int n FROM ledger_entries WHERE reverses_id = $1`, [target])).rows[0].n);
    ok(n3 === 1 && r3.filter((x) => x.status === 'fulfilled').length === 1, '10 concurrent reversals (signed actor): exactly one', { n3, errors: [...new Set(r3.filter((x) => x.status === 'rejected').map((x) => x.reason.code || x.reason.message))] });
    const manual = await posting.postEntry(entry('man:1', '55', { origin: 'manual', actorId: 900 }));
    ok(manual.entry.created_by === 900, 'a manual entry posts with its creator verified (signed by the app key)');
    const notCreator = await attempt(`BEGIN; INSERT INTO ledger_entries (number, transaction_date, period, description, source_module, source_type, source_id, origin, idempotency_key, policy_version, created_by)
      VALUES ('JE-RP-X','2026-11-12','2026-11','x','t','t','1','manual','rp:x','RP-1',900); COMMIT;`);
    const editEntry = await attempt(`UPDATE ledger_entries SET description = 'changed' WHERE id = ${manual.entry.id}`);
    const delEntry = await attempt(`DELETE FROM ledger_entries WHERE id = ${manual.entry.id}`);
    ok(notCreator.startsWith('refused') && editEntry.startsWith('refused') && delEntry.startsWith('refused'), 'soul_app cannot post in someone\'s name, edit or delete entries', { notCreator, editEntry, delEntry });

    await app.end();
    await pool.end();
    await owner.end();
  } finally {
    try { await server.stop(); } catch (_) { /* embedded server cleanup can hit a locked folder on Windows */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* briefly locked on Windows */ }
  }
  const out = path.join(process.env.REHEARSAL_EVIDENCE_DIR || require('os').tmpdir(), `real-postgres-evidence-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify({ engine: 'PostgreSQL (embedded, local)', evidence }, null, 2));
  console.log(`evidence written to ${out}`);
  console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL ${passed} PASSED`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.stack); process.exit(1); });
