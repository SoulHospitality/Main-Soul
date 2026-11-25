// Phase 6: ledger activation and reporting migration (migration 177, lib/accounting/reportSource.js), on PGlite with
// synthetic data. The policy is labelled SYNTHETIC TEST; it is not an accounting approval.
// Usage: NODE_PATH="<Server>/node_modules;<pglite dir>" node activation-test.js <Server>
const path = require('path');
const { boot, applyMigration, provisionIdentity, claimSql } = require('./harness');
const { seed174 } = require('./seed174');

const S = process.argv[2];
let passed = 0;
let failed = 0;
const ok = (cond, name, detail) => {
  if (cond) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};
const FROM = '2026-10-01';
const TO = '2026-12-31';

(async () => {
  const { db, query } = await boot(S, { until: '174' });
  await seed174(query);
  for (const f of ['175_commission_snapshots.sql', '176_ledger_core.sql', '177_ledger_report_source.sql']) await applyMigration(db, S, f);
  await query(`UPDATE financial_settings SET value_text = '2026-09-01T00:00:00Z' WHERE key = 'books_reset_at'`);
  await provisionIdentity(query);
  const identity = require(path.join(S, 'src/lib/accounting/identity.js'));
  const mig = require(path.join(S, 'src/lib/accounting/historicalMigration.js'));
  const posting = require(path.join(S, 'src/lib/accounting/posting.js'));
  const rs = require(path.join(S, 'src/lib/accounting/reportSource.js'));
  const engine = require(path.join(S, 'src/lib/finance/ledgerEngine.js'));
  const expectErr = async (fn) => { try { await fn(); return null; } catch (e) { return e.message; } };

  // ── Migration 177 ──
  ok((await rs.reportSource()) === 'engine', 'after 177 the report source is engine (default)');
  const firstLog = (await query(`SELECT old_value, new_value, actor_id FROM ledger_control_log WHERE control = 'ledger_reports'`)).rows;
  ok(firstLog.length === 1 && firstLog[0].new_value === 'engine' && firstLog[0].actor_id === null, 'its installation is in the control log (no actor)', firstLog);
  let e = await expectErr(() => query(`DELETE FROM financial_settings WHERE key = 'ledger_reports'`));
  ok(/cannot be deleted/.test(e || ''), 'the setting cannot be deleted', e);
  e = await expectErr(() => query(`UPDATE financial_settings SET key = 'x_reports' WHERE key = 'ledger_reports'`));
  ok(/cannot be renamed/.test(e || ''), 'the setting cannot be renamed', e);

  await query(`INSERT INTO staff_users (id, username, password_hash, full_name, role, is_active) VALUES (995,'ac_admin','x','AC Admin','admin',1),(996,'ac_admin2','x','AC Admin 2','admin',1),(997,'ac_rec','x','AC Recorder','reservations',1)`);
  e = await expectErr(() => rs.setReportSource('ledger', { actorId: 995, reason: 'synthetic activation test' }));
  ok(/posting is off/.test(e || ''), 'switching reports to the ledger while posting is off is refused', e);
  e = await expectErr(() => query(`UPDATE financial_settings SET value_text = 'ledger' WHERE key = 'ledger_reports'`));
  ok(/verified active admin/.test(e || ''), 'an unverified change (plain SQL as the app) is refused', e);

  // Approved synthetic policy, posting on, history imported and reconciled.
  await identity.recordApproval({ purpose: 'policy_d01', subject: 'ACT-TEST', approverId: 995 });
  await identity.recordApproval({ purpose: 'policy_vat', subject: 'ACT-TEST', approverId: 996 });
  await db.exec(`BEGIN; ${claimSql(997)}; INSERT INTO ledger_policies (version, effective_from, settings, status, approved_by, approved_at, approval_ref, vat_approved_by, vat_approved_at, vat_approval_ref, created_by)
    VALUES ('ACT-TEST', '2026-01-01', '{"revenue_presentation":"gross","vat_base":"fee_plus_cleaning"}', 'approved', 995, now(), 'SYNTHETIC TEST - NOT AN APPROVAL', 996, now(), 'SYNTHETIC TEST - NOT AN APPROVAL', 997); COMMIT;`);
  await db.exec(`BEGIN; ${claimSql(995)}; SELECT set_config('app.control_reason','synthetic activation test',true); UPDATE financial_settings SET value_text='on' WHERE key='ledger_posting'; COMMIT;`);
  const p = await mig.plan({ from: FROM, to: TO, policyVersion: 'ACT-TEST' });
  const run = await mig.execute(p, { actorId: 995 });
  let rec = await mig.reconcile({ from: FROM, to: TO });
  ok(run.ok && rec.clean, `history imported (${run.totals?.posted}) and reconciled clean before activation`, rec.buckets);

  e = await expectErr(() => rs.setReportSource('ledger', { actorId: 997, reason: 'synthetic activation test' }));
  ok(/verified active admin/.test(e || ''), 'a non-admin cannot switch the report source', e);
  e = await expectErr(() => rs.setReportSource('ledger', { actorId: 995, reason: 'short' }));
  ok(/control_reason/.test(e || ''), 'a reason of 10+ characters is required', e);
  await rs.setReportSource('ledger', { actorId: 995, reason: 'synthetic activation test' });
  ok((await rs.reportSource()) === 'ledger', 'a verified admin with a reason switches reports to the stored ledger');
  const logged = (await query(`SELECT old_value, new_value, actor_id, reason FROM ledger_control_log WHERE control = 'ledger_reports' ORDER BY id DESC LIMIT 1`)).rows[0];
  ok(logged && logged.old_value === 'engine' && logged.new_value === 'ledger' && logged.actor_id === 995 && /synthetic/.test(logged.reason), 'the switch is logged with the verified person and reason', logged);

  // ── Report parity: same statements from both sources ──
  const norm = (tb) => (tb?.rows || tb?.accounts || tb || []).map((r) => [r.code || r.account, Number(r.debit || 0).toFixed(2), Number(r.credit || 0).toFixed(2)]).filter((r) => r[1] !== '0.00' || r[2] !== '0.00');
  // Account BALANCES must always agree. Debit/credit TURNOVER agrees until a correction: the stored ledger keeps
  // the reversal and the re-post as entries (audit trail), so turnover then exceeds the engine's by exactly those.
  const balances = (tb) => (tb?.rows || []).map((r) => [r.code, Number(r.balance || 0).toFixed(2)]).filter((r) => r[1] !== '0.00');
  const compare = async (label, { turnover = true } = {}) => {
    const a = await engine.buildYtdStatements(TO, FROM);
    const b = await rs.ledgerYtdStatements(TO, FROM);
    const tbSame = JSON.stringify(balances(a.trial_balance)) === JSON.stringify(balances(b.trial_balance)) && (!turnover || JSON.stringify(norm(a.trial_balance)) === JSON.stringify(norm(b.trial_balance)));
    const pnlSame = JSON.stringify(a.profit_and_loss?.totals) === JSON.stringify(b.profit_and_loss?.totals);
    const bsSame = JSON.stringify(a.balance_sheet?.totals) === JSON.stringify(b.balance_sheet?.totals);
    ok(tbSame && pnlSame && bsSame, `${label}: trial balance${turnover ? ' (balances and turnover)' : ' balances'}, P&L and balance sheet identical from engine and stored ledger`,
      { tbSame, pnlSame, bsSame, pnlA: a.profit_and_loss?.totals, pnlB: b.profit_and_loss?.totals, bsA: a.balance_sheet?.totals, bsB: b.balance_sheet?.totals });
    return { a, b };
  };
  let { a, b } = await compare('after import');
  ok(norm(a.trial_balance).length > 5, `the comparison covers ${norm(a.trial_balance).length} accounts with activity`);
  ok(b.balance_sheet?.totals && Math.abs(Number(b.balance_sheet.totals.assets ?? 0) - Number(b.balance_sheet.totals.liabilities_and_equity ?? b.balance_sheet.totals.assets ?? 0)) < 0.01, 'the ledger-sourced balance sheet balances', b.balance_sheet?.totals);

  // ── Month-end close: same closing entry and retained earnings from both sources ──
  await query(`INSERT INTO financial_period_closes (year_month, pnl_amount, closed_by, notes) VALUES ('2026-11', 0, 995, 'synthetic close')`);
  ({ a, b } = await compare('after closing November'));
  const closeA = a.journal.find((x) => x.type === 'period_close' && x.id.includes('2026-11'));
  const closeB = b.journal.find((x) => x.type === 'period_close' && x.id.includes('2026-11'));
  ok(closeA && closeB && JSON.stringify(closeA.lines) === JSON.stringify(closeB.lines) && closeB.balanced !== false, 'the November closing entry is identical from both sources and balanced', { closeA: closeA?.lines, closeB: closeB?.lines });

  // ── Reversal procedure in activated operation ──
  const victim = (await query(`SELECT id, source_id FROM ledger_entries WHERE origin = 'migrated' AND transaction_date >= '2026-12-01' ORDER BY id LIMIT 1`)).rows[0]
    || (await query(`SELECT id, source_id FROM ledger_entries WHERE origin = 'migrated' ORDER BY id DESC LIMIT 1`)).rows[0];
  await posting.reverseEntry(victim.id, { reason: 'synthetic reversal procedure test', actorId: 995 });
  rec = await mig.reconcile({ from: FROM, to: TO });
  ok(!rec.clean && rec.buckets.reference_only === 1, 'reversing an entry shows in reconciliation as reference_only (stored books now differ)', rec.buckets);
  const s = await mig.sync(await mig.plan({ from: FROM, to: TO, policyVersion: 'ACT-TEST' }), { actorId: 995 });
  rec = await mig.reconcile({ from: FROM, to: TO });
  ok(s.posted === 1 && s.failed.length === 0 && rec.clean, 'sync re-posts the reversed entry under the next version key, and the books reconcile again', { s, b: rec.buckets });
  ({ a, b } = await compare('after reversal and re-post', { turnover: false }));
  {
    const victimLines = (await query(`SELECT SUM(base_debit)::numeric(19,2)::text AS d FROM ledger_lines WHERE entry_id = $1`, [victim.id])).rows[0].d;
    const sumTb = (tb, k) => (tb?.rows || []).reduce((s, r) => s + Number(r[k] || 0), 0);
    const extraDebit = (sumTb(b.trial_balance, 'debit') - sumTb(a.trial_balance, 'debit')).toFixed(2);
    const extraCredit = (sumTb(b.trial_balance, 'credit') - sumTb(a.trial_balance, 'credit')).toFixed(2);
    const want = (2 * Number(victimLines)).toFixed(2);
    ok(extraDebit === want && extraCredit === want, `turnover exceeds the engine's by exactly the reversal and re-post (2 × ${victimLines} = ${want}) on each side`, { extraDebit, extraCredit, want });
  }

  // ── Guards while reports read the ledger ──
  e = await expectErr(() => db.exec(`BEGIN; ${claimSql(995)}; SELECT set_config('app.control_reason','synthetic activation test',true); UPDATE financial_settings SET value_text='off' WHERE key='ledger_posting'; COMMIT;`));
  await db.exec('ROLLBACK').catch(() => {});
  ok(/Switch reports back to engine/.test(e || ''), 'posting cannot be switched off while reports read the ledger', e);

  // ── Reports endpoint names its source ──
  const express = require(path.join(S, 'node_modules/express'));
  const app = express();
  app.use((req, _r, next) => { req.user = { id: 995, role: 'admin' }; next(); });
  app.use(require(path.join(S, 'src/routes/pms/financialSystem.js')));
  app.use(require(path.join(S, 'src/routes/pms/financeLedger.js')));
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  let r = await (await fetch(`${base}/financial-system/reports?from=${FROM}&to=${TO}`)).json();
  ok(r.source === 'ledger' && r.trial_balance, '/financial-system/reports reports source=ledger', r.source);
  const ctl = await (await fetch(`${base}/financial-system/ledger-controls`)).json();
  ok(ctl.reports?.source === 'ledger' && ctl.reports.last_change?.actor_name === 'AC Admin', 'the Ledger controls page shows the report source and who switched it', ctl.reports);

  const fs = require('fs');
  const rb = (name) => fs.readFileSync(path.join(path.join(S, '..', 'docs/finance/rehearsal'), name), 'utf8');
  e = await expectErr(() => db.exec(rb('rollback_177.sql')));
  await db.exec('ROLLBACK').catch(() => {});
  ok(/still read the stored ledger/.test(e || ''), 'rollback_177 refuses while reports read the stored ledger', e);

  // ── Rollback: back to the engine ──
  await rs.setReportSource('engine', { actorId: 995, reason: 'synthetic rollback test' });
  r = await (await fetch(`${base}/financial-system/reports?from=${FROM}&to=${TO}`)).json();
  ok((await rs.reportSource()) === 'engine' && r.source === 'engine', 'rollback: reports switch back to the engine (verified, logged)');
  e = await expectErr(() => db.exec(`BEGIN; ${claimSql(995)}; SELECT set_config('app.control_reason','synthetic activation test',true); UPDATE financial_settings SET value_text='off' WHERE key='ledger_posting'; COMMIT;`));
  ok(e === null, 'after rollback, posting can be switched off again', e);
  const history = (await query(`SELECT new_value FROM ledger_control_log WHERE control = 'ledger_reports' ORDER BY id`)).rows.map((x) => x.new_value);
  ok(JSON.stringify(history) === '["engine","ledger","engine"]', 'the full report-source history is kept', history);
  srv.close();

  // ── Rollback scripts, in order ──
  const confirm176 = "SET app.confirm_rollback_176 = 'drop-ledger-with-entries';\n";
  e = await expectErr(() => db.exec(confirm176 + rb('rollback_176.sql')));
  await db.exec('ROLLBACK').catch(() => {});
  ok(/migration 177 is still installed/.test(e || ''), 'rollback_176 refuses while 177 is installed', e);
  e = await expectErr(() => db.exec(rb('rollback_177.sql')));
  ok(e === null && (await query("SELECT COUNT(*)::int n FROM financial_settings WHERE key = 'ledger_reports'")).rows[0].n === 0, 'rollback_177 (reports on engine) removes the switch and its triggers', e);
  e = await expectErr(() => db.exec(confirm176 + rb('rollback_176.sql')));
  await db.exec('RESET app.confirm_rollback_176').catch(() => {});
  ok(e === null, 'then rollback_176 succeeds', e);
  e = await expectErr(() => query("UPDATE financial_settings SET value_text = value_text WHERE key = 'books_reset_at'"));
  ok(e === null && (await rs.reportSource()) === 'engine', 'after both rollbacks, settings still update and reports read the engine', e);

  console.log(failed ? `\n${failed} FAILED (${passed} passed)` : `\nALL ${passed} PASSED`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('CRASH', err.stack); process.exit(1); });
