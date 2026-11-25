// Read-only Financial System endpoints for the stored ledger and commission snapshots (routes/pms/financeLedger.js),
// plus the integrity block on /financial-system/reports. Runs on PGlite at two schema states: before 175/176
// (production today) and after. Usage: NODE_PATH="<Server>/node_modules;<pglite dir>" node ledger-ui-api-test.js <Server>
const path = require('path');
const { boot, applyMigration } = require('./harness');
const { seed174 } = require('./seed174');

const S = process.argv[2];
let passed = 0;
let failed = 0;
const ok = (cond, name, detail) => {
  if (cond) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 400) : ''}`); }
};

(async () => {
  const { db, query } = await boot(S, { until: '174' });
  const { staff } = await seed174(query);
  const express = require(path.join(S, 'node_modules/express'));
  const app = express();
  let role = 'finance';
  app.use((req, _res, next) => { req.user = { id: staff[1], role }; next(); });
  app.use(require(path.join(S, 'src/routes/pms/financeLedger.js')));
  app.use(require(path.join(S, 'src/routes/pms/financialSystem.js')));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };
  const savedKey = [process.env.LEDGER_IDENTITY_KEY_ID, process.env.LEDGER_IDENTITY_KEY];
  delete process.env.LEDGER_IDENTITY_KEY_ID; delete process.env.LEDGER_IDENTITY_KEY;

  try {
    // ── Before 175/176 (the state production is in today) ──
    let r = await get('/financial-system/ledger-controls');
    ok(r.status === 200 && r.body.deployed === false && r.body.identity === 'missing', 'before 176: controls report "not deployed" instead of failing', r);
    r = await get('/financial-system/commission-review');
    ok(r.status === 200 && r.body.deployed === false, 'before 175: commission review reports "not deployed"', r);

    role = 'reservations';
    r = await get('/financial-system/ledger-controls');
    ok(r.status === 403, 'non-finance roles are refused (403)', r.status);
    r = await get('/financial-system/commission-review');
    ok(r.status === 403, 'non-finance roles are refused on the review list (403)', r.status);
    role = 'finance';

    // ── After 175/176 ──
    await applyMigration(db, S, '175_commission_snapshots.sql');
    await applyMigration(db, S, '176_ledger_core.sql');
    process.env.LEDGER_IDENTITY_KEY_ID = 'ui-test';
    process.env.LEDGER_IDENTITY_KEY = 'zz';
    r = await get('/financial-system/ledger-controls');
    ok(r.body.identity === 'invalid', 'a malformed identity key is reported as "invalid" (never echoed)', r.body.identity);
    ok(!JSON.stringify(r.body).includes('ui-test') && !JSON.stringify(r.body).includes('"zz"'), 'the identity key id and value never appear in the response');
    process.env.LEDGER_IDENTITY_KEY = require('crypto').randomBytes(32).toString('hex');
    r = await get('/financial-system/ledger-controls');
    const b = r.body;
    ok(r.status === 200 && b.deployed === true && b.identity === 'configured', 'after 176: deployed, identity configured', { status: r.status, deployed: b.deployed, identity: b.identity });
    ok(b.posting?.state === 'off', 'posting switch reported as off', b.posting);
    ok(b.migrations.length === 2, 'both migrations listed with their apply time', b.migrations);
    ok(b.gates.revenue_presentation === false && b.gates.vat_base === false && b.gates.commission_method === null,
      'no approved policy: both database gates open (false); commission method not tracked in the system (null)', b.gates);
    ok(b.policy_in_force === null && Array.isArray(b.policies), 'no policy in force', b.policy_in_force);
    ok(b.ledger.entries === 0 && b.ledger.lines === 0, 'stored ledger empty', b.ledger);
    ok(Array.isArray(b.periods) && Array.isArray(b.control_log) && Array.isArray(b.approvals), 'periods, control log and approvals are lists');

    // A draft policy (recorded, not approved) shows with both approvals missing.
    await query(`INSERT INTO ledger_policies (version, effective_from, settings, status, created_by) VALUES ('ui-draft', '2026-10-01', '{"revenue_presentation":"gross","vat_base":"full_stay"}', 'draft', $1)`, [staff[1]]);
    r = await get('/financial-system/ledger-controls');
    const draft = r.body.policies.find((p) => p.version === 'ui-draft');
    ok(draft && draft.status === 'draft' && draft.d01_approved === false && draft.vat_approved === false && draft.revenue_presentation === 'gross' && draft.created_by_name,
      'a draft policy is listed with its settings, author and both approvals missing', draft);
    ok(r.body.gates.revenue_presentation === false, 'a draft never counts as an approved gate');

    // Commission review after 175: seeded historical stays have no snapshot and are on the list.
    r = await get('/financial-system/commission-review');
    const c = r.body;
    ok(r.status === 200 && c.deployed === true && c.since, 'commission review deployed, with the capture start date', { deployed: c.deployed, since: c.since });
    ok(c.review_total === 6 && c.rows.every((x) => x.review_reason && x.guest_name !== undefined && 'unit_title' in x), 'the 6 historical stays are listed with reason, guest and unit', { total: c.review_total, first: c.rows[0] });
    ok(c.counts.none === 6 && c.counts.captured === 0, 'status counts: 6 without a snapshot, 0 captured', c.counts);
    await query(`INSERT INTO reservations (unit_id, guest_name, guest_phone, check_in, check_out, nights, price_per_night, total_amount, status, created_by, sales_person_id)
      SELECT unit_id, 'New Guest', '0100', '2027-03-01', '2027-03-03', 2, 1000, 2000, 'confirmed', $1, $1 FROM reservations LIMIT 1`, [staff[0]]);
    r = await get('/financial-system/commission-review');
    ok(r.body.counts.captured === 1 && r.body.review_total === 6, 'a new confirmed stay is captured and is not on the review list', r.body.counts);

    // Reports now carry the integrity block (DEF-ACC-01) instead of dropping it.
    r = await get('/financial-system/reports?from=2026-10-01&to=2026-12-31');
    ok(r.status === 200 && r.body.integrity && Array.isArray(r.body.integrity.unknown_accounts), '/financial-system/reports includes integrity.unknown_accounts', r.body.integrity);

    // Nothing was written by the endpoints: same counts before and after a burst of reads.
    const before = (await query(`SELECT (SELECT COUNT(*) FROM ledger_control_log)::int a, (SELECT COUNT(*) FROM ledger_approvals)::int b, (SELECT value_text FROM financial_settings WHERE key='ledger_posting') c`)).rows[0];
    for (let i = 0; i < 5; i++) { await get('/financial-system/ledger-controls'); await get('/financial-system/commission-review'); }
    const after = (await query(`SELECT (SELECT COUNT(*) FROM ledger_control_log)::int a, (SELECT COUNT(*) FROM ledger_approvals)::int b, (SELECT value_text FROM financial_settings WHERE key='ledger_posting') c`)).rows[0];
    ok(JSON.stringify(before) === JSON.stringify(after), 'the endpoints are read-only (log, approvals and switch unchanged)', { before, after });
  } finally {
    server.close();
    [process.env.LEDGER_IDENTITY_KEY_ID, process.env.LEDGER_IDENTITY_KEY] = savedKey;
    if (savedKey[0] === undefined) delete process.env.LEDGER_IDENTITY_KEY_ID;
    if (savedKey[1] === undefined) delete process.env.LEDGER_IDENTITY_KEY;
  }
  console.log(failed ? `\n${failed} FAILED (${passed} passed)` : `\nALL ${passed} PASSED`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.stack); process.exit(1); });
