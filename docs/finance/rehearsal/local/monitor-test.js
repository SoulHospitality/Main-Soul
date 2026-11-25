// Phase 7: recurring reconciliation and exception monitoring (migration 178, lib/accounting/reconciliationMonitor.js,
// jobs/ledgerReconciliation.js, Data health, Close month). PGlite, synthetic data; the policy is SYNTHETIC TEST.
// Usage: NODE_PATH="<Server>/node_modules;<pglite dir>" node monitor-test.js <Server>
const path = require('path');
const { boot, applyMigration, provisionIdentity, claimSql } = require('./harness');
const { seed174 } = require('./seed174');

const S = process.argv[2];
let passed = 0;
let failed = 0;
const ok = (cond, name, detail) => {
  if (cond) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 500) : ''}`); }
};
const FROM = '2026-10-01';
const TO = '2026-12-31';

(async () => {
  const { db, query } = await boot(S, { until: '174' });
  const { res } = await seed174(query);
  for (const f of ['175_commission_snapshots.sql', '176_ledger_core.sql', '177_ledger_report_source.sql', '178_ledger_reconciliation_runs.sql']) await applyMigration(db, S, f);
  await query(`UPDATE financial_settings SET value_text = '2026-09-01T00:00:00Z' WHERE key = 'books_reset_at'`);
  await provisionIdentity(query);
  const identity = require(path.join(S, 'src/lib/accounting/identity.js'));
  const mig = require(path.join(S, 'src/lib/accounting/historicalMigration.js'));
  const mon = require(path.join(S, 'src/lib/accounting/reconciliationMonitor.js'));
  const expectErr = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };
  const range = { from: FROM, to: TO };

  // ── Not live: nothing runs, nothing is flagged ──
  let r = await mon.runReconciliation({ trigger: 'nightly', ...range });
  ok(r.skipped === 'ledger posting is off', 'while posting is off the job does nothing', r);
  ok((await mon.healthCheck()) === null, 'while posting is off Data health has no ledger check');
  ok(Number((await query(`SELECT COUNT(*)::int n FROM ledger_reconciliation_runs`)).rows[0].n) === 0, 'and nothing is recorded');

  // ── Live, before any run ──
  await query(`INSERT INTO staff_users (id, username, password_hash, full_name, role, is_active) VALUES (995,'mn_admin','x','MN Admin','admin',1),(996,'mn_admin2','x','MN Admin 2','admin',1),(997,'mn_rec','x','MN Recorder','reservations',1),(998,'mn_fin','x','MN Finance','finance',1)`);
  await identity.recordApproval({ purpose: 'policy_d01', subject: 'MON-TEST', approverId: 995 });
  await identity.recordApproval({ purpose: 'policy_vat', subject: 'MON-TEST', approverId: 996 });
  await db.exec(`BEGIN; ${claimSql(997)}; INSERT INTO ledger_policies (version, effective_from, settings, status, approved_by, approved_at, approval_ref, vat_approved_by, vat_approved_at, vat_approval_ref, created_by)
    VALUES ('MON-TEST', '2026-01-01', '{"revenue_presentation":"gross","vat_base":"fee_plus_cleaning"}', 'approved', 995, now(), 'SYNTHETIC TEST - NOT AN APPROVAL', 996, now(), 'SYNTHETIC TEST - NOT AN APPROVAL', 997); COMMIT;`);
  await db.exec(`BEGIN; ${claimSql(995)}; SELECT set_config('app.control_reason','synthetic monitoring test',true); UPDATE financial_settings SET value_text='on' WHERE key='ledger_posting'; COMMIT;`);
  let h = await mon.healthCheck();
  ok(h && h.id === 'ledger_not_reconciled' && h.count === 1 && h.rows[0].ref === 'never' && h.severity === 'high', 'once live with no run yet, Data health flags it (never)', h);
  await mig.execute(await mig.plan({ ...range, policyVersion: 'MON-TEST' }), { actorId: 995 });

  // ── Clean run ──
  r = await mon.runReconciliation({ trigger: 'nightly', ...range });
  ok(r.id && r.clean === true && r.buckets.matched > 10 && r.trigger === 'nightly', `a nightly run is recorded clean (${r.buckets?.matched} matched)`, r);
  h = await mon.healthCheck();
  ok(h && h.count === 0, 'after a clean recent run, Data health is clear', h);

  // ── Differences ──
  await query(`UPDATE reservations SET total_amount = total_amount + 300, price_per_night = price_per_night + 100 WHERE id = $1`, [res[5]]);
  r = await mon.runReconciliation({ trigger: 'nightly', ...range });
  ok(r.clean === false && r.buckets.amount_break >= 1 && Array.isArray(r.account_differences) && r.account_differences.length > 0 && r.sample.length > 0,
    'after an open-month edit the run records the differences, accounts and sample rows', { buckets: r.buckets, acct: r.account_differences?.length });
  h = await mon.healthCheck();
  ok(h.count === 1 && h.rows[0].ref === 'differences', 'Data health flags the differences', h);

  // ── Append-only history ──
  let e = await expectErr(() => query(`UPDATE ledger_reconciliation_runs SET clean = true`));
  ok(/permanent/.test(e || ''), 'a recorded run cannot be changed', e);
  e = await expectErr(() => query(`DELETE FROM ledger_reconciliation_runs`));
  ok(/permanent/.test(e || ''), 'a recorded run cannot be deleted', e);
  e = await expectErr(() => query(`TRUNCATE ledger_reconciliation_runs`));
  ok(/cannot be truncated/.test(e || ''), 'the history cannot be truncated', e);

  // ── Stale ──
  const stale = await mon.healthCheck({ query: async (sql, p) => (/to_regclass/.test(sql) ? { rows: [{ installed: true, posting: 'on' }] } : { rows: [{ id: 9, ran_at: '2026-11-20T04:30:00Z', clean: true, buckets: {}, period_from: '2026-10-01', period_to: '2026-11-20', hours: 48 }] }) });
  ok(stale.count === 1 && stale.rows[0].ref === 'stale' && mon.STALE_HOURS === 36, 'a clean run older than 36 hours is flagged as stale', stale);

  // ── API, roles and Data health ──
  const express = require(path.join(S, 'node_modules/express'));
  const app = express();
  let user = { id: 998, role: 'finance' };
  app.use((req, _r, next) => { req.user = user; next(); });
  app.use(require(path.join(S, 'src/routes/pms/financeLedger.js')));
  app.use(require(path.join(S, 'src/routes/pms/financeWorkspace.js')));
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  user = { id: 997, role: 'reservations' };
  let resp = await fetch(`${base}/financial-system/ledger-reconcile`, { method: 'POST' });
  ok(resp.status === 403, 'Reconcile now is refused for non-finance roles (403)', resp.status);
  user = { id: 998, role: 'finance' };
  resp = await fetch(`${base}/financial-system/ledger-reconcile`, { method: 'POST' });
  let body = await resp.json();
  ok(resp.status === 200 && body.trigger === 'manual' && body.run_by === 998 && body.clean === false, 'Reconcile now records a manual run with the person who ran it', { status: resp.status, trigger: body.trigger, run_by: body.run_by });
  body = await (await fetch(`${base}/financial-system/ledger-controls`)).json();
  ok(body.reconciliation?.installed && body.reconciliation.runs.length === 3 && body.reconciliation.runs[0].run_by_name === 'MN Finance' && body.reconciliation.runs[0].accounts_off > 0,
    'Ledger controls lists the runs, newest first, with who ran them and accounts off', body.reconciliation?.runs?.[0]);
  body = await (await fetch(`${base}/financial-system/health`)).json();
  const hc = (body.checks || []).find((c) => c.id === 'ledger_not_reconciled');
  ok(hc && hc.count === 1 && hc.tool === 'ledger', 'the Data health endpoint includes the ledger check (pointing to Ledger controls)', hc);

  // ── Fix, then clean again ──
  await mig.sync(await mig.plan({ ...range, policyVersion: 'MON-TEST' }), { actorId: 995 });
  resp = await fetch(`${base}/financial-system/ledger-reconcile`, { method: 'POST' });
  body = await resp.json();
  ok(body.clean === true, 'after the sync, Reconcile now is clean');
  body = await (await fetch(`${base}/financial-system/health`)).json();
  ok((body.checks || []).find((c) => c.id === 'ledger_not_reconciled')?.count === 0, 'and Data health is clear again');
  srv.close();

  // ── Job wiring ──
  const job = require(path.join(S, 'src/jobs/ledgerReconciliation.js'));
  ok(typeof job.startLedgerReconciliationJob === 'function' && /startLedgerReconciliationJob\(\)/.test(require('fs').readFileSync(path.join(S, 'src/server.js'), 'utf8')), 'the nightly job exists and is started with the server');

  console.log(failed ? `\n${failed} FAILED (${passed} passed)` : `\nALL ${passed} PASSED`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('CRASH', err.stack); process.exit(1); });
