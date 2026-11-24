// Route-level security tests for finance and owner routes: the real routers on PGlite, behind a test
// sign-in that sets req.user (the JWT layer itself is out of scope here). Synthetic data only.
const path = require('path');
const http = require('http');
const { boot } = require('./harness');

const S = process.argv[2];
let failed = 0;
let passed = 0;
const ok = (cond, name, detail) => {
  if (cond) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 400) : ''}`); }
};

(async () => {
  const { query } = await boot(S);
  const express = require(path.join(S, 'node_modules/express'));
  const users = {};
  for (const [key, role, access] of [
    ['admin', 'admin'], ['finance', 'finance'], ['res', 'reservations'], ['ownerA', 'owner'], ['ownerB', 'owner'],
    ['resRead', 'reservations', { financial_system: { level: 'read' } }],
  ]) {
    users[key] = (await query(`INSERT INTO staff_users (username, password_hash, full_name, role, is_active, page_access)
      VALUES ($1, 'x', $1, $2, 1, $3) RETURNING id, role, page_access`, [`sec_${key}`, role, access ? JSON.stringify(access) : null])).rows[0];
  }
  const unit = async (slug) => (await query(`INSERT INTO units (slug, title, unit_number, status, listing_type, compound, project, beds, baths, guests)
    VALUES ($1,$1,$1,'published','rent','M','M',1,1,2) RETURNING id`, [slug])).rows[0].id;
  const uA = await unit('sec-a');
  const uB = await unit('sec-b');
  await query(`INSERT INTO owner_units (owner_id, unit_id) VALUES ($1,$2),($3,$4)`, [users.ownerA.id, uA, users.ownerB.id, uB]);
  await query(`INSERT INTO owner_settlements (owner_id, period_start, period_end, net_amount) VALUES ($1,'2026-10-01','2026-10-31',1000),($2,'2026-10-01','2026-10-31',2000)`, [users.ownerA.id, users.ownerB.id]);
  const payB = (await query(`INSERT INTO owner_payout_requests (owner_id, amount) VALUES ($1, 500) RETURNING id`, [users.ownerB.id])).rows[0].id;

  // The PMS routers as mounted in production, behind a test sign-in.
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { const who = req.headers['x-test-user']; if (who) req.user = { ...users[who], full_name: who }; next(); });
  const { pageAccessGuard } = require(path.join(S, 'src/lib/pageAccess.js'));
  app.use('/api/pms', pageAccessGuard, require(path.join(S, 'src/routes/pms/financialSystem.js')));
  app.use('/api/pms', require(path.join(S, 'src/routes/pms/ownerPortal.js')));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: String(err.message || err) }));
  const server = http.createServer(app).listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/pms`;
  const call = async (who, method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(who ? { 'x-test-user': who } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await r.json(); } catch (_) {}
    return { status: r.status, json };
  };

  // ── Authentication and roles ──
  ok((await call(null, 'GET', '/financial-system/settings')).status === 401, 'no sign-in → 401 on finance routes');
  ok((await call('res', 'GET', '/financial-system/settings')).status === 403, 'reservations role → 403 on finance settings');
  ok((await call('res', 'POST', '/financial-system/manual-entries', { date: '2026-11-01', lines: [] })).status === 403, 'reservations role cannot post manual journal entries');
  ok((await call('ownerA', 'GET', '/financial-system/settings')).status === 403, 'owner role → 403 on the company finance system');
  ok((await call('finance', 'GET', '/financial-system/settings')).status === 200, 'finance role reads finance settings');
  // Posting switch cannot be flipped through the app.
  const flip = await call('admin', 'PUT', '/financial-system/settings/ledger_posting', { value_num: 1 });
  ok(flip.status === 400, 'even an admin cannot change ledger_posting through the settings API (only gateway_mdr_pct is accepted)', flip);
  // Injection through the key / ids.
  ok((await call('admin', 'PUT', `/financial-system/settings/${encodeURIComponent("gateway_mdr_pct'; DROP TABLE payments;--")}`, { value_num: 1 })).status === 400, 'SQL-like setting key is rejected (whitelist)');
  ok(Number((await query(`SELECT COUNT(*)::int n FROM information_schema.tables WHERE table_name = 'payments'`)).rows[0].n) === 1, 'payments table intact after injection attempts');
  // Page grants: read-only grant opens reads, never writes.
  ok((await call('resRead', 'GET', '/financial-system/settings')).status === 200, 'a read-only page grant opens finance reads for a non-finance role');
  ok((await call('resRead', 'PUT', '/financial-system/settings/gateway_mdr_pct', { value_num: 2 })).status === 403, 'a read-only page grant does not open finance writes');

  // ── Owner isolation ──
  ok((await call('ownerA', 'GET', `/reports/owner-statement?unit_id=${uB}`)).status === 403, 'owner A cannot read owner B\'s unit statement');
  ok((await call('ownerA', 'GET', `/reports/export/owner-statement/pdf?unit_id=${uB}`)).status === 403, 'owner A cannot export owner B\'s statement PDF');
  const own = await call('ownerA', 'GET', `/reports/owner-statement?unit_id=${uA}`);
  ok(own.status === 200, 'owner A reads their own unit statement', own.status);
  const st = await call('ownerA', 'GET', `/owner/settlements?owner_id=${users.ownerB.id}`);
  ok(st.status === 200 && st.json.length === 1 && st.json.every((r) => r.owner_id === users.ownerA.id), 'owner A asking for owner B\'s settlements gets only their own', st.json);
  ok((await call('ownerA', 'POST', '/owner/blocks', { unit_id: uB, from_date: '2027-01-10', to_date: '2027-01-12' })).status === 403, 'owner A cannot block dates on owner B\'s unit');
  await call('ownerA', 'POST', `/owner/payout-requests/${payB}/cancel`);
  ok((await query(`SELECT status FROM owner_payout_requests WHERE id = $1`, [payB])).rows[0].status === 'requested', 'owner A cannot cancel owner B\'s payout request');
  ok((await call('ownerA', 'POST', `/owner/payout-requests/${payB}/review`, { decision: 'approve' })).status === 403, 'an owner cannot approve payout requests');
  ok((await call('ownerA', 'POST', '/owner/settlements/generate', { owner_id: users.ownerA.id })).status === 403, 'an owner cannot generate settlements');
  const unitList = await call('ownerA', 'GET', '/owner/units');
  ok(unitList.status === 200 && JSON.stringify(unitList.json).includes(uA) && !JSON.stringify(unitList.json).includes(uB), 'owner A\'s unit list contains only their unit');
  const inj = await call('ownerA', 'GET', `/reports/owner-statement?unit_id=${encodeURIComponent("x' OR '1'='1")}`);
  ok(inj.status === 403, 'SQL-like unit id from an owner is refused before any query', inj.status);

  server.close();
  console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL ${passed} PASSED`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('CRASH', err.stack); process.exit(1); });
