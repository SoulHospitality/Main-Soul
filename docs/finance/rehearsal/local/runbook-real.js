// Runbook §1–§3 (rehearsal/README.md) executed the way the DBA runs them, on a REAL local PostgreSQL server:
//  - a synthetic database at migration 174, with a closed month;
//  - compare-books.js run as its own CLI process with the OLD code (a checkout of main) and the NEW code;
//  - migrations 175/176 applied by the APP'S OWN runner (src/config/db.js runMigrations) on MIGRATION_DATABASE_URL;
//  - the same comparisons after the migrations: old-before = old-after and new-before = new-after.
// Every child process gets DATABASE_URL and MIGRATION_DATABASE_URL set to the local server, so Server/.env
// (which dotenv loads but never lets override an existing variable) cannot point anything at production.
//
// Usage: NODE_PATH="<dir with embedded-postgres and pg>;<Server>/node_modules" \
//        node runbook-real.js <new Server dir> <old Server dir (a checkout of main, with node_modules)>
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { bootReal } = require('./harness');
const { seed174 } = require('./seed174');

const NEW = path.resolve(process.argv[2]);
const OLD = path.resolve(process.argv[3]);
const REPO = path.join(NEW, '..');
const COMPARE = path.join(REPO, 'docs/finance/rehearsal/compare-books.js');
const FROM = '2026-10-01';
const TO = '2026-12-31';
const evidence = { started: new Date().toISOString(), steps: [] };
let failed = 0;
const step = (name, ok, detail) => {
  evidence.steps.push({ name, ok: !!ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 500) : ''}`);
};

(async () => {
  const env = await bootReal(NEW, { until: '174', port: 54334 });
  const { query, url } = env;
  console.log(env.version);
  evidence.version = env.version;
  if (!/@127\.0\.0\.1:/.test(url)) throw new Error('refusing: not a local URL');
  const childEnv = { ...process.env, DATABASE_URL: url, MIGRATION_DATABASE_URL: url, REHEARSAL_DATABASE_URL: url, NODE_ENV: 'development' };
  delete childEnv.REHEARSAL_SERVER_DIR;
  const books = (serverDir) => {
    const e = { ...childEnv };
    if (serverDir) e.REHEARSAL_SERVER_DIR = serverDir;
    return JSON.parse(execFileSync(process.execPath, [COMPARE, FROM, TO], { env: e, encoding: 'utf8', maxBuffer: 64 << 20 }));
  };
  const strip = (b) => ({ entries: b.entries, accounts: b.accounts, trialBalanceHash: b.trialBalanceHash, journalHash: b.journalHash, closes: b.closes });

  try {
    const { staff } = await seed174(query);
    // Close October the way the Financial System does (a row in financial_period_closes); the engine then
    // generates the closing entry live, with old or new logic.
    // A migration stamps books_reset_at with the time it ran (today, here); a real database's reset is in the past.
    await query(`UPDATE financial_settings SET value_text = '2026-09-01T00:00:00Z' WHERE key = 'books_reset_at'`);
    // A bad-debt allowance raised in October and released in November puts the expense account 620000 in credit
    // in a closed month: the condition the old month-close mishandled (DEF-CLOSE-01).
    await query(`INSERT INTO ar_bad_debt_provisions (period_month, total_ar, total_provision, created_by) VALUES ('2026-10', 9000, 900, $1), ('2026-11', 4000, 200, $1)`, [staff[1]]);
    await query(`INSERT INTO financial_period_closes (year_month, pnl_amount, closed_by, notes) VALUES ('2026-10', 0, $1, 'rehearsal close'), ('2026-11', 0, $1, 'rehearsal close')`, [staff[1]]);
    const at174 = (await query(`SELECT MAX(id) AS m FROM _schema_migrations`)).rows[0].m;
    step(`synthetic database at migration 174 (${at174}) with stays, payments, expenses, cash, a frozen month, an allowance raised then released, October and November closed`, /^174_/.test(at174));

    // §1 before the migrations
    const oldBefore = books(OLD);
    const newBefore = books(null);
    step(`compare-books (CLI) runs with the old code (${path.basename(path.dirname(OLD))}) and the new code before the migrations`, oldBefore.entries > 0 && newBefore.entries > 0,
      { old: oldBefore.entries, new: newBefore.entries });
    const closeDiff = JSON.stringify(oldBefore.closes) !== JSON.stringify(newBefore.closes);
    const tbDiff = oldBefore.trialBalanceHash !== newBefore.trialBalanceHash;
    const oldUnbalanced = oldBefore.closes.filter((c) => !c.balanced).map((c) => c.id);
    const newUnbalanced = newBefore.closes.filter((c) => !c.balanced).map((c) => c.id);
    step(`engine-fix effect measured: closes ${closeDiff ? 'differ' : 'identical'}, trial balance ${tbDiff ? 'differs' : 'identical'}; every new-code close is balanced and the old close differs`,
      newBefore.closes.length >= 2 && newUnbalanced.length === 0 && closeDiff, { oldCloses: oldBefore.closes, newCloses: newBefore.closes, oldUnbalanced });
    evidence.engineFixEffect = { oldCloses: oldBefore.closes, newCloses: newBefore.closes, oldUnbalanced, trialBalanceDiffers: tbDiff,
      oldRows: oldBefore.rows, newRows: newBefore.rows };

    // §2 the app's own start-up runner applies 175 and 176 on MIGRATION_DATABASE_URL
    const runner = `
      const u = process.env.DATABASE_URL, m = process.env.MIGRATION_DATABASE_URL;
      if (!/@127\\.0\\.0\\.1:/.test(u) || !/@127\\.0\\.0\\.1:/.test(m)) { console.error('not local'); process.exit(3); }
      const db = require(${JSON.stringify(path.join(NEW, 'src/config/db.js'))});
      db.runMigrations().then(() => db.pool.end()).then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });`;
    const log1 = execFileSync(process.execPath, ['-e', runner], { env: childEnv, encoding: 'utf8' });
    const applied1 = (log1.match(/Applied migration[^\n]*/gi) || []).map((s) => s.trim());
    const after = (await query(`SELECT id FROM _schema_migrations WHERE id >= '175' ORDER BY id`)).rows.map((r) => r.id);
    step(`the app's runner (on MIGRATION_DATABASE_URL) applies exactly 175, 176 then 177: ${after.join(', ')}`,
      /MIGRATION_DATABASE_URL/.test(log1) && JSON.stringify(after) === '["175_commission_snapshots.sql","176_ledger_core.sql","177_ledger_report_source.sql"]', { applied1, log: log1.slice(-800) });
    const reportsSource = (await query(`SELECT value_text FROM financial_settings WHERE key = 'ledger_reports'`)).rows[0]?.value_text;
    step(`after deployment the reports stay on the engine (${reportsSource})`, reportsSource === 'engine');
    const log2 = execFileSync(process.execPath, ['-e', runner], { env: childEnv, encoding: 'utf8' });
    step('a second app start applies nothing', !/Applied migration/i.test(log2), log2.slice(-400));
    const posting = (await query(`SELECT value_text FROM financial_settings WHERE key = 'ledger_posting'`)).rows[0]?.value_text;
    step(`posting switch present and off after deployment (${posting})`, posting === 'off');

    // §3 after the migrations: each code version must show exactly what it showed before
    const oldAfter = books(OLD);
    const newAfter = books(null);
    step('old code: books identical before and after the migrations (the migrations change nothing the app shows today)',
      JSON.stringify(strip(oldAfter)) === JSON.stringify(strip(oldBefore)));
    step('new code: books identical before and after the migrations',
      JSON.stringify(strip(newAfter)) === JSON.stringify(strip(newBefore)));
  } finally {
    evidence.finished = new Date().toISOString();
    evidence.summary = { steps: evidence.steps.length, failed };
    const outDir = process.env.REHEARSAL_EVIDENCE_DIR || require('os').tmpdir();
    const outFile = path.join(outDir, 'runbook-real-' + evidence.started.replace(/[:.]/g, '-') + '.json');
    fs.writeFileSync(outFile, JSON.stringify(evidence, null, 2));
    console.log('evidence written to ' + outFile);
    await env.stop();
  }
  console.log(failed ? `\n${failed} FAILED` : `\nALL ${evidence.steps.length} RUNBOOK STEPS PASSED`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.stack); process.exit(1); });
