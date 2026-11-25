// Finance go-live with the accountant's decisions of 2026-11-25, end to end on a REAL local PostgreSQL 17.5 and only
// through the operator tools (docs/finance/FINANCE_GO_LIVE.md). Synthetic data; the approval references are labelled
// SYNTHETIC TEST. Usage: NODE_PATH="<dir with embedded-postgres and pg>;<Server>/node_modules" node golive-real-test.js <Server>
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { bootReal, provisionIdentity } = require('./harness');
const { seed174 } = require('./seed174');

const S = process.argv[2];
const REPO = path.join(S, '..');
const DEP = path.join(REPO, 'docs/finance/deployment');
let passed = 0;
let failed = 0;
const evidence = { started: new Date().toISOString(), steps: [] };
const ok = (cond, name, detail) => {
  evidence.steps.push({ name, ok: !!cond });
  if (cond) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};

(async () => {
  const env = await bootReal(S, { until: '174', port: 54380 });
  const { db, query, url } = env;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'golive-'));
  try {
    console.log(env.version);
    evidence.version = env.version;
    // ── Production-like state at 174: history, the 12 November restart, then activity from 25 November ──
    const { staff } = await seed174(query);
    await query(`UPDATE financial_settings SET value_text = '2026-11-12T12:17:42Z' WHERE key = 'books_reset_at'`);
    const unit = (await query(`SELECT id FROM units WHERE slug = 'seed-b'`)).rows[0].id; // 25% company
    const mk = async (ci, nights, ppn, status, created) => (await query(
      `INSERT INTO reservations (unit_id, guest_name, guest_phone, check_in, check_out, nights, price_per_night, total_amount, status, created_by, sales_person_id, created_at, updated_at)
       VALUES ($1,'Go-live Guest','0100',$2::date,$2::date + $3::int,$3,$4,$4::numeric * $3::int,$5,$6,$6,$7::timestamptz,$7::timestamptz) RETURNING id`, [unit, ci, nights, ppn, status, staff[0], created])).rows[0].id;
    const stay = await mk('2026-11-26', 4, 2500, 'checked_out', '2026-11-25T09:00:00Z');
    const cxl = await mk('2026-12-10', 2, 3000, 'cancelled', '2026-11-25T10:00:00Z');
    await query(`INSERT INTO payments (reservation_id, amount, payment_date, payment_method, status, kind, created_at) VALUES
      ($1, 10000, '2026-11-26', 'cash', 'successful', 'collection', '2026-11-26T08:00:00Z'),
      ($1, -1000, '2026-11-29', 'cash', 'successful', 'refund', '2026-11-29T08:00:00Z'),
      ($2, 1200, '2026-11-25', 'cash', 'successful', 'collection', '2026-11-25T11:00:00Z')`, [stay, cxl]);
    await query(`INSERT INTO expenses (unit_id, paid_by, category, description, amount, expense_date, created_by, created_at)
      VALUES ($1, 'company', 'utilities_cost', 'Go-live utility bill', 1140, '2026-11-27', $2, '2026-11-27T08:00:00Z')`, [unit, staff[1]]);

    // ── Deploy: the app's own runner applies 175–178 ──
    const runner = `const db = require(${JSON.stringify(path.join(S, 'src/config/db.js'))}); db.runMigrations().then(() => db.pool.end()).then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });`;
    const childEnv = { ...process.env, DATABASE_URL: url, MIGRATION_DATABASE_URL: url, NODE_ENV: 'development' };
    const dep = spawnSync(process.execPath, ['-e', runner], { env: childEnv, encoding: 'utf8' });
    const applied = (await query(`SELECT id FROM _schema_migrations WHERE id >= '175' ORDER BY id`)).rows.map((r) => r.id);
    ok(dep.status === 0 && applied.length === 5, `deploy: the app applied ${applied.join(', ')}`, dep.stderr);

    // ── The accountant's settings ──
    await db.exec(fs.readFileSync(path.join(DEP, '2026-11-25_accountant_settings.sql'), 'utf8'));
    const st = Object.fromEntries((await query(`SELECT key, value_text FROM financial_settings WHERE key IN ('books_reset_at','vat_suspended_from','commission_history_decision','ledger_posting','ledger_reports')`)).rows.map((r) => [r.key, r.value_text]));
    ok(st.books_reset_at === '2026-11-24T22:00:00Z' && st.vat_suspended_from === '2026-11-25' && /^settled/.test(st.commission_history_decision) && st.ledger_posting === 'off' && st.ledger_reports === 'engine',
      'settings script: books from 25/11 (Cairo), VAT suspended, commissions settled; posting off, reports on engine', st);

    // ── Policy and approvals, each person through the tool ──
    const { keyId, hex } = await provisionIdentity(query);
    await query(`INSERT INTO staff_users (id, username, password_hash, full_name, role, is_active) VALUES (901,'gl_owner','x','GL Owner','admin',1),(902,'gl_admin','x','GL Admin','admin',1),(903,'gl_fin','x','GL Finance','finance',1)`);
    const tool = (script, ...argv) => {
      const r = spawnSync(process.execPath, [path.join(S, 'scripts', script), ...argv], {
        cwd: S, encoding: 'utf8', env: { ...process.env, DATABASE_URL: url, LEDGER_IDENTITY_KEY_ID: keyId, LEDGER_IDENTITY_KEY: hex, NODE_ENV: 'development' },
      });
      return { code: r.status, out: r.stdout, err: r.stderr };
    };
    const host = ['--confirm-host', '127.0.0.1', '--execute'];
    let r = tool('ledger-policy.js', 'record', '--version', '2026.11', '--effective', '2026-11-25', '--settings', path.join(S, 'src/lib/accounting/policies/2026.11.json'), '--actor', '903',
      '--d01-approver', '901', '--d01-ref', 'SYNTHETIC TEST REF', '--vat-approver', '902', '--vat-ref', 'SYNTHETIC TEST REF', ...host);
    ok(r.code === 1 && /has not recorded/.test(r.err), 'recording the policy before the approvals is refused by the database', r.err.slice(-200));
    r = tool('ledger-policy.js', 'approve', '--purpose', 'd01', '--version', '2026.11', '--actor', '903', ...host);
    ok(r.code === 1, 'a non-admin cannot approve', r.err.slice(-200));
    r = tool('ledger-policy.js', 'approve', '--purpose', 'd01', '--version', '2026.11', '--actor', '901', ...host);
    ok(r.code === 0, 'admin A records the revenue (EAS 48) approval', r.err.slice(-200));
    r = tool('ledger-policy.js', 'approve', '--purpose', 'vat', '--version', '2026.11', '--actor', '902', ...host);
    ok(r.code === 0, 'admin B records the VAT-base approval', r.err.slice(-200));
    r = tool('ledger-policy.js', 'record', '--version', '2026.11', '--effective', '2026-11-25', '--settings', path.join(S, 'src/lib/accounting/policies/2026.11.json'), '--actor', '901',
      '--d01-approver', '901', '--d01-ref', 'SYNTHETIC TEST REF', '--vat-approver', '902', '--vat-ref', 'SYNTHETIC TEST REF', ...host);
    ok(r.code === 1 && /cannot be the person who recorded/.test(r.err), 'an approver cannot record the policy', r.err.slice(-200));
    r = tool('ledger-policy.js', 'record', '--version', '2026.11', '--effective', '2026-11-25', '--settings', path.join(S, 'src/lib/accounting/policies/2026.11.json'), '--actor', '903',
      '--d01-approver', '901', '--d01-ref', 'SYNTHETIC TEST REF', '--vat-approver', '902', '--vat-ref', 'SYNTHETIC TEST REF', ...host);
    const pol = (await query(`SELECT status, settings->>'revenue_presentation' AS rev, settings->>'vat_base' AS vat, effective_from::text AS eff FROM ledger_policies WHERE version = '2026.11'`)).rows[0];
    ok(r.code === 0 && pol?.status === 'approved' && pol.rev === 'gross' && pol.vat === 'suspended' && pol.eff === '2026-11-25', 'the finance recorder records policy 2026.11 (gross, VAT suspended, from 25/11) as approved', { pol, err: r.err.slice(-200) });

    // ── Posting on, books synced from 25/11 ──
    r = tool('ledger-policy.js', 'posting', 'on', '--actor', '903', '--reason', 'synthetic go-live test', ...host);
    ok(r.code === 1, 'a non-admin cannot switch posting on');
    r = tool('ledger-policy.js', 'posting', 'on', '--actor', '901', '--reason', 'synthetic go-live test', ...host);
    ok(r.code === 0 && (await query(`SELECT value_text FROM financial_settings WHERE key='ledger_posting'`)).rows[0].value_text === 'on', 'admin switches posting on (verified, logged)', r.err.slice(-200));
    const range = ['--from', '2026-11-25', '--to', '2026-12-31'];
    r = tool('ledger-migration.js', 'plan', '--from', '2026-11-01', '--to', '2026-12-31', '--policy', '2026.11', '--out', out);
    r = tool('ledger-migration.js', 'sync', '--from', '2026-11-01', '--to', '2026-12-31', '--policy', '2026.11', '--actor', '901', '--out', out, ...host);
    ok(r.code === 1 && /RANGE_SPANS_VAT_CHANGE/.test(r.err), 'syncing a range that starts before 25/11 is refused (straddles the VAT suspension)', r.err.slice(-200));
    r = tool('ledger-migration.js', 'sync', ...range, '--policy', '2026.11', '--actor', '901', '--out', out, ...host);
    ok(r.code === 0 && /"clean": true/.test(r.out), 'sync from 25/11 posts the books and reconciles clean', { out: r.out.slice(-500), err: r.err.slice(-300) });

    // ── The books follow the decisions ──
    const lines = async (acct) => Number((await query(`SELECT COALESCE(SUM(base_debit - base_credit), 0)::numeric(19,2)::text AS n FROM ledger_lines WHERE account_code = $1`, [acct])).rows[0].n);
    const n = Number((await query(`SELECT COUNT(*)::int n FROM ledger_entries`)).rows[0].n);
    const early = Number((await query(`SELECT COUNT(*)::int n FROM ledger_entries WHERE transaction_date < '2026-11-25'`)).rows[0].n);
    ok(n > 0 && early === 0, `${n} entries posted, none dated before 25/11 (books start 25/11; no history, no opening balances)`);
    ok((await lines('205000')) === 0 && (await lines('107000')) === 0, 'no output or input VAT anywhere in the books (taxes postponed)');
    const refund = (await query(`SELECT e.id FROM ledger_entries e WHERE e.source_type = 'refund'`)).rows[0];
    const refLines = refund ? (await query(`SELECT account_code, base_debit::float d, base_credit::float c FROM ledger_lines WHERE entry_id = $1`, [refund.id])).rows : [];
    ok(refund && !refLines.some((l) => l.account_code === '105000') && refLines.some((l) => ['401000', '404000'].includes(l.account_code) && l.d > 0),
      'the refund reduced revenue (R-1), not the guest receivable', refLines);
    const forfeit = (await query(`SELECT e.id FROM ledger_entries e WHERE e.source_type = 'cancellation'`)).rows[0];
    const fl = forfeit ? Object.fromEntries((await query(`SELECT account_code, (base_debit + base_credit)::float a FROM ledger_lines WHERE entry_id = $1`, [forfeit.id])).rows.map((x) => [x.account_code, x.a])) : {};
    ok(fl['409000'] === 1200 && fl['202000'] === 900 && fl['506000'] === 900, 'the forfeited 1200 deposit: revenue 1200, owner gets 900 (100% − company 25%) (R-5)', fl);

    // ── Reports from the ledger, then monitoring ──
    r = tool('ledger-policy.js', 'reports', 'ledger', '--actor', '901', '--reason', 'synthetic go-live test', ...host);
    ok(r.code === 0 && (await query(`SELECT value_text FROM financial_settings WHERE key='ledger_reports'`)).rows[0].value_text === 'ledger', 'admin switches reports to the ledger (verified, logged)', r.err.slice(-200));
    const rs = require(path.join(S, 'src/lib/accounting/reportSource.js'));
    const engine = require(path.join(S, 'src/lib/finance/ledgerEngine.js'));
    const a = await engine.buildYtdStatements('2026-12-31', '2026-11-25');
    const b = await rs.ledgerYtdStatements('2026-12-31', '2026-11-25');
    const bal = (tb) => JSON.stringify((tb?.rows || []).map((x) => [x.code, Number(x.balance).toFixed(2)]).filter((x) => x[1] !== '0.00'));
    ok(bal(a.trial_balance) === bal(b.trial_balance) && JSON.stringify(a.profit_and_loss?.totals) === JSON.stringify(b.profit_and_loss?.totals),
      'statements from the stored ledger equal the live calculation (trial balance, P&L)', { a: a.profit_and_loss?.totals, b: b.profit_and_loss?.totals });
    const mon = require(path.join(S, 'src/lib/accounting/reconciliationMonitor.js'));
    const run = await mon.runReconciliation({ trigger: 'manual', runBy: 903, from: '2026-11-25', to: '2026-12-31' });
    ok(run.clean === true && (await mon.healthCheck()).count === 0, 'the reconciliation monitor records a clean run; Data health is clear');
    const log = (await query(`SELECT control, new_value, actor_id FROM ledger_control_log ORDER BY id`)).rows.map((x) => `${x.control}:${x.new_value}:${x.actor_id ?? '-'}`);
    ok(log.includes('ledger_posting:on:901') && log.includes('ledger_reports:ledger:901'), 'the control log names who switched posting and reports on', log);
  } finally {
    evidence.finished = new Date().toISOString();
    evidence.summary = { steps: evidence.steps.length, failed };
    const dir = process.env.REHEARSAL_EVIDENCE_DIR || os.tmpdir();
    fs.writeFileSync(path.join(dir, 'golive-real-' + evidence.started.replace(/[:.]/g, '-') + '.json'), JSON.stringify(evidence, null, 2));
    await env.stop();
    fs.rmSync(out, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} FAILED (${passed} passed)` : `\nALL ${passed} PASSED`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.stack); process.exit(1); });
