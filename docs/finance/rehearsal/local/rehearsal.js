// Local deployment rehearsal of migrations 175/176 on PGlite (Postgres 16/17 in-process) or, with
// REHEARSAL_ENGINE=real, on a real PostgreSQL server (embedded-postgres; needs it and pg on NODE_PATH), using the
// repository's rehearsal scripts. Evidence is written OUTSIDE the repository: to $REHEARSAL_EVIDENCE_DIR,
// or the OS temp folder. Copy it into docs/finance/rehearsal/evidence/ deliberately if it should be kept.
const fs = require('fs');
const path = require('path');
const { boot, bootReal, applyMigration } = require('./harness');
const { seed174 } = require('./seed174');
const REAL = process.env.REHEARSAL_ENGINE === 'real';

const S = process.argv[2];                     // .../Server
const REPO = path.join(S, '..');
const RH = path.join(REPO, 'docs/finance/rehearsal');
const read = (f) => fs.readFileSync(path.join(RH, f), 'utf8');
const evidence = { started: new Date().toISOString(), engine: REAL ? 'PostgreSQL (embedded, real server)' : 'PGlite', steps: [] };
let failed = 0;
const step = (name, ok, detail) => {
  evidence.steps.push({ name, ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined && !ok ? ' :: ' + JSON.stringify(detail).slice(0, 400) : ''}`);
};

(async () => {
  const env = REAL ? await bootReal(S, { until: '174' }) : await boot(S, { until: '174' });
  const { db, query } = env;
  if (env.version) { evidence.version = env.version; console.log(env.version); }
  const rowsOf = (res) => res.filter((r) => r.fields.length).map((r) => r.rows);
  const sqlFile = async (f, prefix = '') => rowsOf(await db.exec(prefix + read(f)));
  // psql semantics: each statement is its own transaction (needed for r3's "later transaction" checks).
  const { splitSql } = require('./splitsql');
  const psqlFile = async (f, prefix = '') => {
    const out = [];
    for (const s of splitSql(prefix + read(f))) { const r = await db.query(s); if (r.fields && r.fields.length) out.push(r.rows); }
    return out;
  };
  const inventory = async () => Object.fromEntries((await sqlFile('r0_table_inventory.sql'))[0].map((r) => [r.table_name, r.fingerprint]));
  const columnsOf = async () => Object.fromEntries((await query(`SELECT table_name, string_agg(column_name, ',' ORDER BY column_name) AS c FROM information_schema.columns WHERE table_schema = 'public' GROUP BY table_name`)).rows.map((r) => [r.table_name, r.c]));
  const fingerprint = async () => Object.fromEntries((await sqlFile('r1_fingerprint.sql'))[0].map((r) => [r.item, r.fingerprint]));
  const sameData = (a, b) => Object.keys(a).filter((k) => k !== 'migrations >= 170').every((k) => a[k] === b[k]);
  const books = require(path.join(RH, 'compare-books.js'));
  const booksPrint = async () => { const r = await books.fingerprint('2026-10-01', '2026-12-31'); return { entries: r.entries, tb: r.trialBalanceHash, journal: r.journalHash }; };
  const tables = async (like) => Number((await query(`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE $1`, [like])).rows[0].n);
  const migrated = async (id) => (await query('SELECT 1 FROM _schema_migrations WHERE id = $1', [id])).rows.length === 1;

  // ── Seed a realistic pre-deployment database (state after migration 174) ──
  const { staff, res, uA } = await seed174(query);
  step('seeded a pre-deployment database (migration 174 state): 3 units (modes A/B/C), 8 stays incl. USD, owner-booked, pending, cancelled; payments incl. refund; expenses; cash_ledger; a frozen month', true);

  // ── Before ──
  const fpBefore = await fingerprint();
  const booksBefore = await booksPrint();
  step('baseline: data fingerprint and the books the app shows (existing engine) recorded', !!fpBefore.reservations && booksBefore.entries > 0, { fpBefore, booksBefore });
  evidence.baseline = { fingerprint: fpBefore, books: booksBefore };
  const invBefore = await inventory();
  const invAgain = await inventory();
  step(`r0 inventory: read-only, ${Object.keys(invBefore).length} tables, identical on a second run`, Object.keys(invBefore).length > 50 && JSON.stringify(invBefore) === JSON.stringify(invAgain));
  const colsBefore = await columnsOf();
  const settingsRows = async () => Object.fromEntries((await query(`SELECT key, md5(s::text) AS h FROM financial_settings s`)).rows.map((r) => [r.key, r.h]));
  const settingsBefore = await settingsRows();

  // ── Recovery from a failed migration (before the real deployment) ──
  const m175 = fs.readFileSync(path.join(S, 'supabase/migrations/175_commission_snapshots.sql'), 'utf8');
  const m176 = fs.readFileSync(path.join(S, 'supabase/migrations/176_ledger_core.sql'), 'utf8');
  const cut = m175.indexOf('CREATE TABLE IF NOT EXISTS public.reservation_commission_corrections');
  let err = null;
  try { await applyMigration(db, S, '175_commission_snapshots.sql', m175.slice(0, cut) + "\nDO $$ BEGIN RAISE EXCEPTION 'REHEARSAL: injected failure part-way through 175'; END $$;\n"); } catch (e) { err = e.message; }
  const cols = Number((await query(`SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name = 'reservations' AND column_name LIKE 'commission_snapshot%'`)).rows[0].n);
  step('175 failing part-way (after adding columns) leaves nothing behind: no columns, not recorded as applied', /injected failure/.test(err || '') && cols === 0 && !(await migrated('175_commission_snapshots.sql')), { err, cols });

  // ── Apply 175 and 176 the way the app does ──
  step('175 applies (one transaction, recorded)', (await applyMigration(db, S, '175_commission_snapshots.sql')) === 'applied');
  err = null;
  try { await applyMigration(db, S, '176_ledger_core.sql', m176 + "\nDO $$ BEGIN RAISE EXCEPTION 'REHEARSAL: injected failure at the end of 176'; END $$;\n"); } catch (e) { err = e.message; }
  step('176 failing at its last statement leaves nothing behind: no ledger tables, not recorded, 175 unaffected',
    /injected failure/.test(err || '') && (await tables('ledger\\_%')) === 0 && !(await migrated('176_ledger_core.sql')) && (await migrated('175_commission_snapshots.sql')), { err });
  step('after the failure, a normal start applies 176 cleanly', (await applyMigration(db, S, '176_ledger_core.sql')) === 'applied');
  step('177 (report source) applies; reports stay on the engine', (await applyMigration(db, S, '177_ledger_report_source.sql')) === 'applied'
    && (await query(`SELECT value_text FROM financial_settings WHERE key = 'ledger_reports'`)).rows[0]?.value_text === 'engine');
  step('a second app start skips all three (already recorded)', (await applyMigration(db, S, '175_commission_snapshots.sql')) === 'skipped' && (await applyMigration(db, S, '176_ledger_core.sql')) === 'skipped'
    && (await applyMigration(db, S, '177_ledger_report_source.sql')) === 'skipped');
  err = null;
  try { await db.exec(m175.replace(/CREATE EXTENSION[^;]*;/gi, '')); await db.exec(m176); } catch (e) { err = e.message; }
  step('running both files again by hand is harmless (idempotent: IF NOT EXISTS / ON CONFLICT)', err === null, err);

  // ── Verify structure and that nothing existing changed ──
  const r2 = (await sqlFile('r2_verify_structure.sql'))[0];
  step(`r2 structure checks: ${r2.filter((r) => r.passed).length}/${r2.length} passed`, r2.every((r) => r.passed), r2.filter((r) => !r.passed));
  evidence.r2 = r2;
  const invAfter = await inventory();
  const colsNow = await columnsOf();
  const hashChanged = Object.keys(invBefore).filter((k) => invAfter[k] !== invBefore[k]);
  // Expected writes: the runner's migration records, and two settings rows (175's capture start date, 176's
  // posting switch, off). Every pre-existing settings row must be unchanged.
  const settingsNow = await settingsRows();
  const addedKeys = Object.keys(settingsNow).filter((k) => !(k in settingsBefore)).sort();
  const settingsKept = Object.keys(settingsBefore).every((k) => settingsNow[k] === settingsBefore[k]);
  const expected = new Set(['_schema_migrations', 'financial_settings']);
  const unexplained = hashChanged.filter((k) => colsNow[k] === colsBefore[k] && !expected.has(k));
  step(`r0 after the migrations: every pre-existing table present; changed hashes only where columns were added or rows are expected (${hashChanged.join(', ') || 'none'})`,
    Object.keys(invBefore).every((k) => k in invAfter) && unexplained.length === 0 && settingsKept &&
      JSON.stringify(addedKeys) === '["commission_snapshots_since","ledger_posting","ledger_reports"]', { hashChanged, unexplained, addedKeys, settingsKept });
  const fpAfter = await fingerprint();
  step('existing data unchanged by the migrations (fingerprints identical)', sameData(fpBefore, fpAfter), { fpBefore, fpAfter });
  const booksAfter = await booksPrint();
  step('the books the app shows are identical after the migrations (trial balance and every journal line)', JSON.stringify(booksAfter) === JSON.stringify(booksBefore), { booksBefore, booksAfter });
  const review = (await query(`SELECT COUNT(*)::int AS n FROM reservation_commission_review`)).rows[0].n;
  step('historical confirmed / checked-in / checked-out stays: no snapshot, all on the review list (6 of 8 seeded)', review === 6 && (await query(`SELECT COUNT(*)::int AS n FROM reservations WHERE commission_snapshot IS NOT NULL`)).rows[0].n === 0, { review });

  // ── Existing application behaviour on the migrated database ──
  const pend = res[6];
  await query(`UPDATE reservations SET notes = 'edited after deploy', total_amount = 10900 WHERE id = $1`, [res[4]]);
  await query(`UPDATE reservations SET status = 'checked_out' WHERE id = $1`, [res[5]]);
  await query(`UPDATE reservations SET status = 'confirmed' WHERE id = $1`, [pend]);
  const pendSnap = (await query(`SELECT commission_snapshot_status AS st, commission_review_reason AS why FROM reservations WHERE id = $1`, [pend])).rows[0];
  step('ordinary edits and status changes on existing stays still save; a pre-deployment pending stay confirmed now is captured and flagged for review',
    pendSnap.st === 'needs_review' && /before rate snapshots/.test(pendSnap.why), pendSnap);
  const newRes = (await query(`INSERT INTO reservations (unit_id, guest_name, guest_phone, check_in, check_out, nights, price_per_night, total_amount, status, created_by, sales_person_id)
    VALUES ($1,'Seed Guest','0100','2027-01-10','2027-01-12',2,2500,5000,'confirmed',$2,$2) RETURNING id, commission_snapshot_status AS st`, [uA, staff[0]])).rows[0];
  step('a new booking created as confirmed (website/channel path) saves and is captured', newRes.st === 'captured', newRes);
  const booksAfterUse = await books.fingerprint('2026-10-01', '2027-01-31');
  const tbOk = booksAfterUse.rows.reduce((s, r) => s + Number(r[1]) - Number(r[2]), 0);
  step('the existing engine still builds balanced books with the new columns and rows present', booksAfterUse.entries >= booksBefore.entries && Math.abs(tbOk) < 0.005, { entries: booksAfterUse.entries, imbalance: tbOk });

  // ── Behaviour (r3) ──
  const r3 = await psqlFile('r3_behaviour.sql', "SET app.rehearsal_copy = 'restored-copy-not-production';\n");
  const results = r3[r3.length - 2];
  step(`r3 behaviour checks: ${results.filter((r) => r.passed).length}/${results.length} passed`, results.every((r) => r.passed), results.filter((r) => !r.passed));
  evidence.r3 = results;
  err = null;
  try { await db.exec("RESET app.rehearsal_copy;\n" + read('r3_behaviour.sql')); } catch (e) { err = e.message; }
  step('r3 refuses to run without the restored-copy declaration', /Refusing to run/.test(err || ''), err);

  // ── Rollback with test entries present ──
  const entries = (await query(`SELECT COUNT(*)::int AS n FROM ledger_entries`)).rows[0].n;
  err = null;
  try { await db.exec("SET app.confirm_rollback_176 = 'drop-ledger-with-entries';\n" + read('rollback_176.sql')); } catch (e) { err = e.message; await db.exec('ROLLBACK').catch(() => {}); }
  await db.exec('RESET app.confirm_rollback_176');
  step('rollback_176 refuses while 177 is installed (rollback order: 177 first)', /migration 177 is still installed/.test(err || '') && (await tables('ledger\\_%')) === 9, err);
  await db.exec(read('rollback_177.sql'));
  step('rollback_177 removes the report-source switch (reports were on the engine)', !(await query(`SELECT 1 FROM financial_settings WHERE key='ledger_reports'`)).rows.length && !(await migrated('177_ledger_report_source.sql')));
  err = null;
  try { await db.exec(read('rollback_176.sql')); } catch (e) { err = e.message; await db.exec('ROLLBACK').catch(() => {}); }
  step(`rollback_176 refuses while the ledger holds entries (${entries}) unless confirmed`, /Refusing/.test(err || '') && (await tables('ledger\\_%')) === 9, err);
  await db.exec("SET app.confirm_rollback_176 = 'drop-ledger-with-entries';\n" + read('rollback_176.sql'));
  await db.exec('RESET app.confirm_rollback_176');
  step('rollback_176 with confirmation removes the ledger (despite immutability triggers) and its migration record',
    (await tables('ledger\\_%')) === 0 && !(await migrated('176_ledger_core.sql')) && !(await query(`SELECT 1 FROM financial_settings WHERE key='ledger_posting'`)).rows.length);
  await db.exec(read('rollback_175_soft.sql'));
  const trig = (await query(`SELECT COUNT(*)::int AS n FROM pg_trigger WHERE tgname = 'reservations_commission_snapshot'`)).rows[0].n;
  const keptSnaps = (await query(`SELECT COUNT(*)::int AS n FROM reservations WHERE commission_snapshot IS NOT NULL`)).rows[0].n;
  const plain = (await query(`INSERT INTO reservations (unit_id, guest_name, guest_phone, check_in, check_out, nights, total_amount, status, created_by) VALUES ($1,'Seed Guest','0100','2027-02-01','2027-02-02',1,900,'confirmed',$2) RETURNING commission_snapshot`, [uA, staff[0]])).rows[0];
  step('rollback_175_soft stops capture, keeps saved snapshots, and reservations keep saving', trig === 0 && keptSnaps > 0 && plain.commission_snapshot === null, { trig, keptSnaps });
  err = null;
  try { await db.exec(read('rollback_175_full.sql')); } catch (e) { err = e.message; await db.exec('ROLLBACK').catch(() => {}); }
  step('rollback_175_full refuses without confirmation', /Refusing/.test(err || ''), err);
  // The correction log references rehearsal reservations; on a copy the full rollback drops it first.
  await db.exec("SET app.confirm_rollback_175 = 'drop-commission-snapshots';\n" + read('rollback_175_full.sql'));
  await db.exec('RESET app.confirm_rollback_175');
  const colsAfter = Number((await query(`SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name = 'reservations' AND column_name LIKE 'commission_%' AND column_name <> 'commission_mode'`)).rows[0].n);
  step('rollback_175_full removes columns, log, view, trigger and migration record', colsAfter === 0 && !(await migrated('175_commission_snapshots.sql')), { colsAfter });
  const fpRolled = await fingerprint();
  const booksRolled = await booksPrint();
  // Rows added after deployment (one edit, status changes and new bookings in this rehearsal) are real use, so
  // compare only what the app shows for the original window against a clean replay below.
  step('after both rollbacks the schema is back to 174 and the app builds its books', booksRolled.entries > 0 && fpRolled.reservations, { fpRolled, booksRolled });

  // ── Re-deploy after rollback, then rollback with NO entries (the normal pre-cutover case) ──
  step('after rollback, 175, 176 and 177 re-apply cleanly', (await applyMigration(db, S, '175_commission_snapshots.sql')) === 'applied' && (await applyMigration(db, S, '176_ledger_core.sql')) === 'applied'
    && (await applyMigration(db, S, '177_ledger_report_source.sql')) === 'applied');
  const r2b = (await sqlFile('r2_verify_structure.sql'))[0];
  step(`r2 after re-apply: ${r2b.filter((r) => r.passed).length}/${r2b.length} passed`, r2b.every((r) => r.passed), r2b.filter((r) => !r.passed));
  const fpRe = await fingerprint();
  await db.exec(read('rollback_177.sql'));
  await db.exec(read('rollback_176.sql'));
  step('rollback_177 then rollback_176 with an empty ledger need no confirmation and leave existing data identical', (await tables('ledger\\_%')) === 0 && sameData(fpRe, await fingerprint()));

  evidence.finished = new Date().toISOString();
  evidence.summary = { steps: evidence.steps.length, failed };
  const outDir = process.env.REHEARSAL_EVIDENCE_DIR || require('os').tmpdir();
  const outFile = path.join(outDir, 'rehearsal-evidence-' + evidence.started.replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(outFile, JSON.stringify(evidence, null, 2));
  console.log('evidence written to ' + outFile);
  console.log(failed ? `\n${failed} FAILED` : `\nALL ${evidence.steps.length} REHEARSAL STEPS PASSED`);
  if (env.stop) await env.stop();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.stack); process.exit(1); });
