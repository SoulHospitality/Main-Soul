// GENUINE multi-session tests on a real PostgreSQL server (embedded-postgres, local only).
// Separate connections run truly concurrently; nothing here is simulated.
const fs = require('fs');
const path = require('path');
const EmbeddedPostgres = require('embedded-postgres').default;
const { Pool, Client } = require('pg');

const S = process.argv[2]; // .../Server
const PORT = 54330;
let failed = 0;
let passed = 0;
const evidence = [];
const ok = (cond, name, detail) => {
  evidence.push({ name, ok: !!cond, detail });
  if (cond) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name} :: ${JSON.stringify(detail).slice(0, 400)}`); }
};

(async () => {
  const dir = path.join(__dirname, 'data-' + Date.now());
  const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'local-only', port: PORT, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: (m) => { if (/ERROR|FATAL|PANIC|terminated|crash/.test(String(m))) console.log('[pg]', String(m).trim().slice(0, 300)); }, onError: (m) => console.log('[pg-err]', String(m).trim().slice(0, 300)) });
  await server.initialise();
  await server.start();
  await server.createDatabase('ledger');
  const cfg = (user = 'postgres', password = 'local-only') => ({ host: '127.0.0.1', port: PORT, user, password, database: 'ledger' });
  try {
    const admin = new Client(cfg());
    await admin.connect();
    console.log((await admin.query('SELECT version()')).rows[0].version);
    await admin.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';`);
    // Migrations exactly as src/config/db.js runs them: one transaction per file, recorded.
    await admin.query(`CREATE TABLE IF NOT EXISTS public._schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const mdir = path.join(S, 'supabase/migrations');
    let applied = 0;
    for (const f of fs.readdirSync(mdir).filter((x) => x.endsWith('.sql')).sort()) {
      const sql = fs.readFileSync(path.join(mdir, f), 'utf8'); process.stdout.write(f.slice(0, 4));
      try {
        await admin.query('BEGIN');
        await admin.query(sql);
        await admin.query('INSERT INTO public._schema_migrations (id) VALUES ($1)', [f]);
        await admin.query('COMMIT');
        applied++;
      } catch (e) {
        await admin.query('ROLLBACK').catch(() => {});
        throw new Error(`${f}: ${e.message}`);
      }
    }
    ok(applied >= 176, `all ${applied} migrations apply on real PostgreSQL with the app's runner semantics`);

    // Wire the posting service to a real connection pool.
    const pool = new Pool({ ...cfg(), max: 20 });
    const p = require.resolve(path.join(S, 'src/config/db.js'));
    require.cache[p] = { id: p, filename: p, loaded: true, exports: { pool, query: (t, v) => pool.query(t, v) } };
    const posting = require(path.join(S, 'src/lib/accounting/posting.js'));

    await admin.query(`INSERT INTO staff_users (id, username, password_hash, full_name, role, is_active) VALUES
      (900,'c_admin1','x','C Admin 1','admin',1),(901,'c_admin2','x','C Admin 2','admin',1),(902,'c_rec','x','C Recorder','reservations',1)`);
    await admin.query(`INSERT INTO ledger_policies (version, effective_from, settings, status, approved_by, approved_at, approval_ref, vat_approved_by, vat_approved_at, vat_approval_ref, created_by)
      VALUES ('CONC-TEST', '2026-01-01', '{"revenue_presentation":"gross","vat_base":"fee_only"}', 'approved', 900, now(), 'SYNTHETIC', 901, now(), 'SYNTHETIC', 902)`);
    await admin.query(`BEGIN; SELECT set_config('app.actor_id','900',true), set_config('app.control_reason','local concurrency test only',true);
      UPDATE financial_settings SET value_text = 'on' WHERE key = 'ledger_posting'; COMMIT;`);
    const entry = (key, amt = '100') => ({ transactionDate: '2026-11-10', description: 'concurrency', sourceType: 'test', sourceId: key, idempotencyKey: key,
      lines: [{ account: '103000', debit: amt }, { account: '105000', credit: amt }] });

    // 1. 20 concurrent posts of the same idempotency key, each on its own connection.
    const r1 = await Promise.allSettled(Array.from({ length: 20 }, () => posting.postEntry(entry('conc:1'))));
    const fulfilled = r1.filter((x) => x.status === 'fulfilled').map((x) => x.value);
    const ids = new Set(fulfilled.map((x) => String(x.entry.id)));
    const count1 = Number((await admin.query(`SELECT COUNT(*)::int n FROM ledger_entries WHERE idempotency_key = 'conc:1'`)).rows[0].n);
    ok(count1 === 1 && ids.size === 1 && fulfilled.filter((x) => !x.duplicate).length === 1 && fulfilled.length === 20,
      '20 concurrent posts of one key: exactly one entry; one creator, 19 duplicates returning the same entry',
      { count1, fulfilled: fulfilled.length, creators: fulfilled.filter((x) => !x.duplicate).length, rejected: r1.filter((x) => x.status === 'rejected').map((x) => x.reason.message) });

    // 2. 20 concurrent posts of the same key with DIFFERENT content: one wins, the rest conflict.
    const r2 = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => posting.postEntry(entry('conc:2', String(100 + i)))));
    const wins = r2.filter((x) => x.status === 'fulfilled' && !x.value.duplicate).length;
    const conflicts = r2.filter((x) => x.status === 'rejected' && /IDEMPOTENCY_CONFLICT|already used/.test(x.reason.message)).length;
    const count2 = Number((await admin.query(`SELECT COUNT(*)::int n FROM ledger_entries WHERE idempotency_key = 'conc:2'`)).rows[0].n);
    ok(count2 === 1 && wins === 1 && wins + conflicts + r2.filter((x) => x.status === 'fulfilled' && x.value.duplicate).length === 20,
      '20 concurrent posts of one key with different amounts: one entry, the others refused as conflicts', { count2, wins, conflicts });

    // 3. 10 concurrent reversals of one entry.
    const target = fulfilled[0].entry.id;
    const r3 = await Promise.allSettled(Array.from({ length: 10 }, () => posting.reverseEntry(target, { reason: 'concurrent reversal test', actorId: 900, date: '2026-11-11' })));
    const revOk = r3.filter((x) => x.status === 'fulfilled').length;
    const revCount = Number((await admin.query(`SELECT COUNT(*)::int n FROM ledger_entries WHERE reverses_id = $1`, [target])).rows[0].n);
    ok(revOk === 1 && revCount === 1, '10 concurrent reversals of one entry: exactly one reversal; the others refused',
      { revOk, revCount, errors: [...new Set(r3.filter((x) => x.status === 'rejected').map((x) => x.reason.code || x.reason.message))] });

    // 4. Two raw sessions inserting reversals of the same entry, interleaved (bypassing the service).
    const e4 = (await posting.postEntry(entry('conc:4', '70'))).entry;
    const a = new Client(cfg()); const b = new Client(cfg());
    await a.connect(); await b.connect();
    const rawRev = (n) => `INSERT INTO ledger_entries (number, transaction_date, period, description, source_module, source_type, source_id, origin, reverses_id, idempotency_key, policy_version, created_by)
        VALUES ('${n}','2026-11-12','2026-11','raw','t','t','4','reversal',${e4.id},'raw:${n}','CONC-TEST',900);
      INSERT INTO ledger_lines (entry_id, line_no, account_code, debit, credit, base_debit, base_credit)
        SELECT (SELECT id FROM ledger_entries WHERE number='${n}'), line_no, account_code, credit, debit, base_credit, base_debit FROM ledger_lines WHERE entry_id=${e4.id};`;
    await a.query('BEGIN'); await a.query(rawRev('RAW-A'));
    await b.query('BEGIN');
    const bTry = b.query(rawRev('RAW-B')).then(() => 'inserted', (e) => `refused: ${e.message}`);
    await new Promise((r) => setTimeout(r, 300));
    await a.query('COMMIT');
    const bResult = await bTry;
    await b.query('ROLLBACK').catch(() => {});
    const raw4 = Number((await admin.query(`SELECT COUNT(*)::int n FROM ledger_entries WHERE reverses_id = $1`, [e4.id])).rows[0].n);
    ok(/refused/.test(bResult) && raw4 === 1, 'two sessions inserting reversals of one entry: the second blocks, then fails on the uniqueness index', { bResult, raw4 });
    await a.end(); await b.end();

    // 5. Bypass paths for an ordinary (non-owner, non-superuser) application role.
    await admin.query(`CREATE ROLE app_rw LOGIN PASSWORD 'local-only' NOSUPERUSER NOCREATEDB NOCREATEROLE;
      GRANT USAGE ON SCHEMA public TO app_rw; GRANT ALL ON ALL TABLES IN SCHEMA public TO app_rw; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_rw;`);
    const app = new Client(cfg('app_rw'));
    await app.connect();
    const attempt = async (sql) => { try { await app.query(sql); return 'ALLOWED'; } catch (e) { return `refused (${e.message.slice(0, 70)})`; } };
    const t1 = await attempt('TRUNCATE public.ledger_entries CASCADE');
    const t2 = await attempt('ALTER TABLE public.ledger_entries DISABLE TRIGGER ledger_entries_guard');
    const t3 = await attempt('SET session_replication_role = replica');
    const t4 = await attempt('DROP TRIGGER ledger_entries_guard ON public.ledger_entries');
    const t5 = await attempt(`UPDATE ledger_entries SET description = 'x' WHERE id = ${e4.id}`);
    ok(/refused/.test(t1) && /refused/.test(t2) && /refused/.test(t3) && /refused/.test(t4) && /refused/.test(t5),
      'non-owner app role: TRUNCATE, DISABLE TRIGGER, session_replication_role, DROP TRIGGER and UPDATE are all refused', { t1, t2, t3, t4, t5 });
    await app.end();
    const o1 = await (async () => { try { await admin.query('ALTER TABLE public.ledger_entries DISABLE TRIGGER ledger_entries_guard'); await admin.query('ALTER TABLE public.ledger_entries ENABLE TRIGGER ledger_entries_guard'); return 'ALLOWED'; } catch (e) { return 'refused'; } })();
    ok(o1 === 'ALLOWED', 'the owner / superuser role CAN still disable triggers (why a restricted posting role is required)', { o1 });

    await pool.end();
    await admin.end();
  } finally {
    await server.stop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* data folder briefly locked on Windows */ }
  }
  const out = path.join(require('os').tmpdir(), `concurrency-evidence-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify({ engine: 'PostgreSQL 17.5 (embedded, local)', evidence }, null, 2));
  console.log(`evidence written to ${out}`);
  console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL ${passed} PASSED`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.stack); process.exit(1); });
