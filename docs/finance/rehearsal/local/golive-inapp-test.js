// Go-live from inside the app, as the owner decided on 2026-11-25: CEOs and financial managers approve, record and
// switch from their own login (routes/pms/financeLedger.js); the nightly job posts new activity; a person syncs
// changes. Also: withholding suspended on a real vendor invoice. REAL local PostgreSQL 17.5, synthetic data.
// Usage: NODE_PATH="<dir with embedded-postgres and pg>;<Server>/node_modules" node golive-inapp-test.js <Server>
const path = require('path');
const fs = require('fs');
const os = require('os');
const { bootReal, applyMigration, provisionIdentity } = require('./harness');
const { seed174 } = require('./seed174');

const S = process.argv[2];
const REPO = path.join(S, '..');
let passed = 0;
let failed = 0;
const evidence = { started: new Date().toISOString(), steps: [] };
const ok = (cond, name, detail) => {
  evidence.steps.push({ name, ok: !!cond });
  if (cond) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};

(async () => {
  const env = await bootReal(S, { until: '174', port: 54390 });
  const { db, query } = env;
  let server;
  try {
    evidence.version = env.version;
    const { staff } = await seed174(query);
    await query(`UPDATE financial_settings SET value_text = '2026-11-12T12:17:42Z' WHERE key = 'books_reset_at'`);
    for (const f of ['175_commission_snapshots.sql', '176_ledger_core.sql', '177_ledger_report_source.sql', '178_ledger_reconciliation_runs.sql', '179_ledger_finance_managers.sql']) await applyMigration(db, S, f);
    await db.exec(fs.readFileSync(path.join(REPO, 'docs/finance/deployment/2026-11-25_accountant_settings.sql'), 'utf8'));
    await provisionIdentity(query);
    await query(`INSERT INTO staff_users (id, username, password_hash, full_name, role, is_active) VALUES
      (901,'ia_ceo','x','IA Owner CEO','admin',1),(904,'ia_fm1','x','IA Finance Manager 1','finance_manager',1),
      (905,'ia_fm2','x','IA Finance Manager 2','finance_manager',1),(906,'ia_res','x','IA Reservations','reservations',1)`);
    // Activity from 25/11.
    const unit = (await query(`SELECT id FROM units WHERE slug = 'seed-b'`)).rows[0].id;
    const stay = (await query(`INSERT INTO reservations (unit_id, guest_name, guest_phone, check_in, check_out, nights, price_per_night, total_amount, status, created_by, sales_person_id, created_at, updated_at)
      VALUES ($1,'In-app Guest','0100','2026-11-25','2026-11-29',4,2500,10000,'checked_in',$2,$2,'2026-11-25T09:00:00Z','2026-11-25T09:00:00Z') RETURNING id`, [unit, staff[0]])).rows[0].id;
    await query(`INSERT INTO payments (reservation_id, amount, payment_date, payment_method, status, kind, created_at) VALUES ($1, 10000, '2026-11-25', 'cash', 'successful', 'collection', '2026-11-25T08:00:00Z')`, [stay]);
    await query(`INSERT INTO expenses (unit_id, paid_by, category, description, amount, expense_date, created_by, created_at)
      VALUES ($1, 'company', 'other', 'Service fee after 25/11 (3% withholding category)', 5000, '2026-11-25', $2, '2026-11-25T08:00:00Z')`, [unit, staff[1]]);
    const vendor = (await query(`INSERT INTO vendors (name, category, payment_terms_days, wht_rate_pct) VALUES ('IA Supplier', 'general', 30, 3) RETURNING id`)).rows[0].id;

    const express = require(path.join(S, 'node_modules/express'));
    const app = express();
    app.use(express.json());
    let user = null;
    app.use((req, _r, next) => { req.user = user; next(); });
    app.use(require(path.join(S, 'src/routes/pms/financeLedger.js')));
    app.use(require(path.join(S, 'src/routes/pms/financialSystem.js')));
    server = app.listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    const as = (id, role) => { user = { id, role }; };
    const post = async (p, body) => { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
    const get = async (p) => (await fetch(base + p)).json();

    // ── Withholding suspended on a real vendor invoice ──
    as(904, 'finance_manager');
    let r = await post('/financial-system/vendor-invoices', { vendor_id: vendor, invoice_date: '2026-11-25', amount: 2000, description: 'From 25/11' });
    ok(r.status === 201 || r.status === 200, 'vendor invoice recorded', r);
    const inv = (await query(`SELECT wht_amount::float w, net_payable::float n FROM vendor_invoices WHERE vendor_id = $1 ORDER BY id DESC LIMIT 1`, [vendor])).rows[0];
    ok(inv && inv.w === 0 && inv.n === 2000, 'withholding suspended: a 2000 invoice from a 3% vendor carries 0 withholding; the vendor is paid 2000', inv);
    r = await post('/financial-system/vendor-invoices', { vendor_id: vendor, invoice_date: '2026-11-20', amount: 2000, description: 'Before 25/11' });
    const inv2 = (await query(`SELECT wht_amount::float w, net_payable::float n FROM vendor_invoices WHERE vendor_id = $1 ORDER BY id DESC LIMIT 1`, [vendor])).rows[0];
    ok(inv2 && inv2.w === 60 && inv2.n === 1940, 'an invoice dated before 25/11 keeps its 3% withholding (60)', inv2);

    // ── Go-live from the app ──
    as(901, 'admin');
    let c = await get('/financial-system/ledger-controls');
    ok(c.golive?.policy?.version === '2026.11' && c.golive.status === null && c.golive.me.can_manage === true && c.golive.policy.settings.vat_base === 'suspended',
      'Ledger controls shows policy 2026.11 (gross, taxes suspended) waiting for approval; the CEO may act', c.golive && { status: c.golive.status, me: c.golive.me });
    as(906, 'reservations');
    r = await post('/financial-system/ledger/approve', { purpose: 'd01' });
    ok(r.status === 403, 'a reservations user cannot approve (403)', r.status);
    as(901, 'admin');
    r = await post('/financial-system/ledger/approve', { purpose: 'd01' });
    const r2 = await post('/financial-system/ledger/approve', { purpose: 'vat' });
    ok(r.status === 200 && r2.status === 200, 'the owner (CEO) approves revenue and taxes from his own login', [r, r2]);
    r = await post('/financial-system/ledger/record', { reference: "Accountant's approval confirmed by the owner, 25 Nov 2026" });
    ok(r.status === 409 && /cannot be the person who recorded/.test(r.body.error || ''), 'the approver cannot also record the policy (database refuses)', r);
    as(904, 'finance_manager');
    r = await post('/financial-system/ledger/record', { reference: 'short' });
    ok(r.status === 400, 'recording needs the basis of the approval (10+ characters)', r.status);
    r = await post('/financial-system/ledger/record', { reference: "Accountant's approval confirmed by the owner, 25 Nov 2026" });
    const pol = (await query(`SELECT status, created_by, approved_by, vat_approved_by, approval_ref FROM ledger_policies WHERE version = '2026.11'`)).rows[0];
    ok(r.status === 200 && pol.status === 'approved' && pol.created_by === 904 && pol.approved_by === 901 && pol.vat_approved_by === 901 && /confirmed by the owner/.test(pol.approval_ref),
      'a financial manager records it: approved, recorder 904, approvals by the owner, basis cited', { r, pol });
    r = await post('/financial-system/ledger/switch', { control: 'posting', value: 'on', reason: "Owner's instruction, 25 Nov 2026" });
    ok(r.status === 200 && (await query(`SELECT value_text FROM financial_settings WHERE key='ledger_posting'`)).rows[0].value_text === 'on', 'a financial manager switches posting on (migration 179)', r);

    // ── Nightly job: posts new activity ──
    const ops = require(path.join(S, 'src/lib/accounting/ledgerOperations.js'));
    const mon = require(path.join(S, 'src/lib/accounting/reconciliationMonitor.js'));
    let s = await ops.autoSync({ to: '2026-12-31' });
    const entries = (await query(`SELECT COUNT(*)::int n, COUNT(*) FILTER (WHERE origin = 'system')::int sys, MIN(transaction_date)::text first FROM ledger_entries`)).rows[0];
    ok(s.posted > 0 && s.failed.length === 0 && entries.n === entries.sys && entries.first >= '2026-11-25', `the nightly job posts the new activity (${s.posted} entries, all 'system', from 25/11)`, { s, entries });
    let run = await mon.runReconciliation({ trigger: 'nightly', to: '2026-12-31' });
    const pf = (await query('SELECT period_from::text AS f FROM ledger_reconciliation_runs WHERE id = $1', [run.id])).rows[0].f;
    ok(run.clean && pf === '2026-11-25', 'the nightly reconciliation starts at the policy date (25/11) and is clean', { from: pf, b: run.buckets });
    const noTax = (await query(`SELECT COALESCE(SUM(base_debit + base_credit), 0)::float n FROM ledger_lines WHERE account_code IN ('205000', '107000', '206000')`)).rows[0].n;
    ok(noTax === 0, 'no VAT and no withholding anywhere in the ledger (the 5000 service fee carries no 3% withholding)', noTax);

    // ── A change: left for a person, then synced by them ──
    await query(`UPDATE reservations SET total_amount = 10400, price_per_night = 2600 WHERE id = $1`, [stay]);
    s = await ops.autoSync({ to: '2026-12-31' });
    ok(s.pendingChanges >= 1 && s.posted === 0 && (await query(`SELECT COUNT(*)::int n FROM ledger_entries WHERE origin = 'reversal'`)).rows[0].n === 0,
      `the job does not replace changed entries by itself (${s.pendingChanges} pending)`, s);
    run = await mon.runReconciliation({ trigger: 'nightly', to: '2026-12-31' });
    ok(!run.clean, 'and the reconciliation flags the difference');
    as(905, 'finance_manager');
    r = await post('/financial-system/ledger/sync', {});
    const repl = (await query(`SELECT COUNT(*)::int n FROM ledger_entries WHERE replaces_id IS NOT NULL AND created_by = 905`)).rows[0].n;
    ok(r.status === 200 && r.body.sync.replaced >= 1 && repl >= 1, `"Sync changes" by a financial manager replaces them under her name (${r.body.sync?.replaced})`, r.body.sync);
    ok(r.body.reconciliation?.clean === true, 'and the reconciliation that follows is clean', r.body.reconciliation?.buckets);

    // ── Reports, control log ──
    r = await post('/financial-system/ledger/switch', { control: 'reports', value: 'ledger', reason: "Owner's instruction, 25 Nov 2026" });
    ok(r.status === 200 && (await query(`SELECT value_text FROM financial_settings WHERE key='ledger_reports'`)).rows[0].value_text === 'ledger', 'reports switched to the ledger from the app');
    c = await get('/financial-system/ledger-controls');
    ok(c.golive.status === 'approved' && c.posting.state === 'on' && c.reports.source === 'ledger' && c.reconciliation.runs[0].clean,
      'Ledger controls shows every go-live step done');
    const log = (await query(`SELECT control, new_value, actor_id FROM ledger_control_log WHERE actor_id IS NOT NULL ORDER BY id`)).rows.map((x) => `${x.control}:${x.new_value}:${x.actor_id}`);
    ok(JSON.stringify(log) === '["ledger_posting:on:904","ledger_reports:ledger:905"]', 'the control log names each person (posting by 904, reports by 905)', log);
  } finally {
    evidence.finished = new Date().toISOString();
    evidence.summary = { steps: evidence.steps.length, failed };
    fs.writeFileSync(path.join(process.env.REHEARSAL_EVIDENCE_DIR || os.tmpdir(), 'golive-inapp-' + evidence.started.replace(/[:.]/g, '-') + '.json'), JSON.stringify(evidence, null, 2));
    server?.close();
    await env.stop();
  }
  console.log(failed ? `\n${failed} FAILED (${passed} passed)` : `\nALL ${passed} PASSED`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.stack); process.exit(1); });
