// Historical migration, reconciliation and parallel-run sync (lib/accounting/historicalMigration.js) on PGlite with
// synthetic data. The policy below is labelled SYNTHETIC TEST; it is not an accounting approval.
// Usage: NODE_PATH="<Server>/node_modules;<pglite dir>" node migration-test.js <Server>
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
  await applyMigration(db, S, '175_commission_snapshots.sql');
  await applyMigration(db, S, '176_ledger_core.sql');
  await query(`UPDATE financial_settings SET value_text = '2026-09-01T00:00:00Z' WHERE key = 'books_reset_at'`);
  await provisionIdentity(query);
  const identity = require(path.join(S, 'src/lib/accounting/identity.js'));
  const mig = require(path.join(S, 'src/lib/accounting/historicalMigration.js'));
  const posting = require(path.join(S, 'src/lib/accounting/posting.js'));
  const { pool } = require(path.join(S, 'src/config/db.js'));
  const count = async (sql) => Number((await query(sql)).rows[0].n);

  await query(`INSERT INTO staff_users (id, username, password_hash, full_name, role, is_active) VALUES (995,'mg_admin','x','MG Admin','admin',1),(996,'mg_admin2','x','MG Admin 2','admin',1),(997,'mg_rec','x','MG Recorder','reservations',1)`);
  const approve = async (version, settings, from) => {
    await identity.recordApproval({ purpose: 'policy_d01', subject: version, approverId: 995 });
    await identity.recordApproval({ purpose: 'policy_vat', subject: version, approverId: 996 });
    await db.exec(`BEGIN; ${claimSql(997)}; INSERT INTO ledger_policies (version, effective_from, settings, status, approved_by, approved_at, approval_ref, vat_approved_by, vat_approved_at, vat_approval_ref, created_by)
      VALUES ('${version}', '${from}', '${JSON.stringify(settings)}', 'approved', 995, now(), 'SYNTHETIC TEST - NOT AN APPROVAL', 996, now(), 'SYNTHETIC TEST - NOT AN APPROVAL', 997); COMMIT;`);
  };
  await approve('MIG-TEST', { revenue_presentation: 'gross', vat_base: 'fee_plus_cleaning' }, '2026-01-01');
  await approve('MIG-NET', { revenue_presentation: 'net', vat_base: 'fee_only' }, '2027-06-01');

  // ── Unit: treatment check ──
  ok(mig.methodCompatible({ revenue_presentation: 'gross', vat_base: 'fee_plus_cleaning' }).compatible, 'treatment check: the engine treatment is compatible');
  ok(!mig.methodCompatible({ revenue_presentation: 'net', vat_base: 'fee_plus_cleaning' }).compatible, 'treatment check: net revenue is not');
  ok(!mig.methodCompatible({ revenue_presentation: { A: 'gross', B: 'net' }, vat_base: 'fee_plus_cleaning' }).compatible, 'treatment check: any contract type that differs is not');
  ok(!mig.methodCompatible({ revenue_presentation: 'gross' }).compatible, 'treatment check: a missing setting is not');

  // ── Dry run ──
  const p = await mig.plan({ from: FROM, to: TO, policyVersion: 'MIG-TEST' });
  ok(p.counts.reference > 10 && p.counts.planned === p.counts.reference && p.errors.length === 0, `plan converts all ${p.counts.reference} reference entries with no errors`, p.counts);
  ok(p.balanced && p.accountDiffs.length === 0, 'plan reproduces the reference account by account (balanced)', p.accountDiffs);
  ok((await count(`SELECT COUNT(*)::int n FROM ledger_entries`)) === 0, 'plan writes nothing');
  const frozen = p.entries.find((x) => x.sourceId === 'B-seed-1');
  ok(frozen && frozen.idempotencyKey === 'frozen:2026-10:B-seed-1', 'a frozen month entry is keyed frozen:{month}:{id} (plan Step 2.1)', frozen?.idempotencyKey);
  ok(p.entries.filter((x) => x.idempotencyKey.startsWith('engine:')).length > 0, 'open-month entries are keyed engine:{id} (Step 2.2)');

  // ── Refusals ──
  let r = await mig.execute(p, { actorId: 995 });
  ok(r.ok === false && /switched off/.test(r.months[0]?.error || ''), 'execute while posting is off: refused by the database, nothing posted', r.months[0]);
  ok((await count(`SELECT COUNT(*)::int n FROM ledger_entries`)) === 0, 'still nothing posted');
  let err = null;
  try { await mig.execute({ ...p, policyVersion: 'MIG-NET' }, { actorId: 995 }); } catch (e) { err = e; }
  ok(err?.code === 'METHOD_MISMATCH' && err.detail?.length === 2, 'an approved policy with a different treatment (net, fee only) is refused: METHOD_MISMATCH', err && { code: err.code, detail: err.detail });
  err = null;
  await db.exec(`BEGIN; ${claimSql(997)}; INSERT INTO ledger_policies (version, effective_from, settings, status, created_by) VALUES ('MIG-DRAFT', '2028-01-01', '{"revenue_presentation":"gross","vat_base":"fee_plus_cleaning"}', 'draft', 997); COMMIT;`);
  try { await mig.execute({ ...p, policyVersion: 'MIG-DRAFT' }, { actorId: 995 }); } catch (e) { err = e; }
  ok(err?.code === 'POLICY_NOT_APPROVED', 'a draft policy is refused: POLICY_NOT_APPROVED', err?.code);
  err = null;
  try { await mig.execute({ ...p, errors: [{ id: 'X' }] }, {}); } catch (e) { err = e; }
  ok(err?.code === 'PLAN_ERRORS', 'a plan with errors is refused', err?.code);
  err = null;
  try { await mig.execute({ ...p, balanced: false, accountDiffs: [{ account: '1' }] }, {}); } catch (e) { err = e; }
  ok(err?.code === 'PLAN_UNBALANCED', 'an unbalanced plan is refused', err?.code);

  // ── Import ──
  await db.exec(`BEGIN; ${claimSql(995)}; SELECT set_config('app.control_reason','synthetic migration test',true); UPDATE financial_settings SET value_text='on' WHERE key='ledger_posting'; COMMIT;`);
  r = await mig.execute(p, { actorId: 995, runBy: 'test' });
  ok(r.ok && r.totals.posted === p.counts.planned && r.totals.skipped === 0, `execute posts all ${p.counts.planned} entries, one transaction per month (${r.months.length} months)`, r);
  ok((await count(`SELECT COUNT(*)::int n FROM ledger_entries WHERE origin = 'migrated' AND policy_version = 'MIG-TEST'`)) === p.counts.planned, 'every entry is origin=migrated under the approved policy');
  r = await mig.execute(p, { actorId: 995 });
  ok(r.ok && r.totals.posted === 0 && r.totals.skipped === p.counts.planned, 're-running skips everything (no duplicates)', r.totals);

  // ── Reconciliation ──
  let rec = await mig.reconcile({ from: FROM, to: TO });
  ok(rec.clean && rec.buckets.matched === p.counts.reference && rec.accountsWithDifferences.length === 0,
    `reconciliation: ${rec.buckets.matched} entries matched, no account differences`, { buckets: rec.buckets, acct: rec.accountsWithDifferences });
  ok(mig.reconciliationCsv(rec).startsWith('source_id,bucket,'), 'reconciliation CSV is produced');

  // ── Parallel run: the reference changes after import ──
  await query(`UPDATE reservations SET total_amount = total_amount + 300, price_per_night = price_per_night + 100 WHERE id = $1`, [res[5]]);
  rec = await mig.reconcile({ from: FROM, to: TO });
  ok(!rec.clean && rec.buckets.amount_break >= 1, `after a booking edit, reconciliation reports amount breaks (${rec.buckets.amount_break})`, rec.buckets);
  const p2 = await mig.plan({ from: FROM, to: TO, policyVersion: 'MIG-TEST' });
  err = null;
  try { await mig.sync(p2, {}); } catch (e) { err = e; }
  ok(err?.code === 'NO_ACTOR', 'sync refuses without a verified person', err?.code);
  const s = await mig.sync(p2, { actorId: 995 });
  ok(s.failed.length === 0 && s.replaced === rec.buckets.amount_break && s.unchanged + s.replaced + s.posted === p2.counts.planned,
    `sync replaces exactly the changed entries (${s.replaced}) and leaves the rest (${s.unchanged})`, s);
  ok((await count(`SELECT COUNT(*)::int n FROM ledger_entries WHERE origin = 'reversal'`)) === s.replaced
    && (await count(`SELECT COUNT(*)::int n FROM ledger_entries WHERE replaces_id IS NOT NULL`)) === s.replaced,
    'each replacement is a linked reversal plus a replacement entry (history kept)');
  rec = await mig.reconcile({ from: FROM, to: TO });
  ok(rec.clean && rec.accountsWithDifferences.length === 0, 'after sync, reconciliation is clean again', { buckets: rec.buckets, acct: rec.accountsWithDifferences });
  const s2 = await mig.sync(p2, { actorId: 995 });
  ok(s2.replaced === 0 && s2.posted === 0 && s2.failed.length === 0, 'a second sync changes nothing', s2);

  // ── A ledger entry with no reference is caught ──
  const stray = await posting.postEntry({ transactionDate: '2026-11-15', description: 'stray', sourceModule: 'engine', sourceType: 'manual', sourceId: 'NOT-IN-ENGINE', origin: 'manual', actorId: 995, idempotencyKey: 'stray-1', policyVersion: 'MIG-TEST',
    lines: [{ account: '105000', debit: '50', credit: '0' }, { account: '401000', debit: '0', credit: '50' }] });
  rec = await mig.reconcile({ from: FROM, to: TO });
  ok(!rec.clean && rec.buckets.ledger_only === 1 && rec.accountsWithDifferences.length === 2, 'a ledger entry the engine does not have is flagged (ledger_only, 2 accounts off)', { b: rec.buckets, a: rec.accountsWithDifferences });
  await posting.reverseEntry(stray.entry.id, { reason: 'test stray', actorId: 995 });
  rec = await mig.reconcile({ from: FROM, to: TO });
  ok(rec.clean, 'after reversing it, reconciliation is clean');

  // ── Opening balances (only when supplied; never invented) ──
  const pNo = await mig.plan({ from: FROM, to: TO, policyVersion: 'MIG-TEST' });
  ok(!pNo.entries.some((x) => x.sourceType === 'opening_balance'), 'no opening entry unless balances are supplied');
  const pBad = await mig.plan({ from: FROM, to: TO, policyVersion: 'MIG-TEST', openingBalances: [{ account: '101000', debit: 100 }, { account: '301000', credit: 90 }] });
  ok(pBad.errors.some((x) => x.code === 'OPENING_UNBALANCED'), 'unbalanced opening balances are an error');
  const pOpen = await mig.plan({ from: FROM, to: TO, policyVersion: 'MIG-TEST', openingBalances: [{ account: '101000', debit: 1000 }, { account: '301000', credit: 1000 }] });
  ok(pOpen.entries[0].sourceType === 'opening_balance' && pOpen.entries[0].idempotencyKey === `opening:${FROM}` && pOpen.balanced, 'balanced opening balances become one opening entry at the start date');

  // ── VAT suspended (accountant, 2026-11-25): the treatment check follows the engine ──
  await query(`INSERT INTO financial_settings (key, value_text) VALUES ('vat_suspended_from', '2026-11-01')`);
  const db0 = { query };
  err = null;
  try { await mig.engineTreatmentFor(db0, '2026-10-01', '2026-12-31'); } catch (x) { err = x; }
  ok(err?.code === 'RANGE_SPANS_VAT_CHANGE', 'a range straddling the VAT suspension date is refused (split it at the date)', err?.code);
  ok(JSON.stringify(await mig.engineTreatmentFor(db0, '2026-11-01', '2026-12-31')) === JSON.stringify(mig.ENGINE_TREATMENT_VAT_SUSPENDED)
    && JSON.stringify(await mig.engineTreatmentFor(db0, '2026-10-01', '2026-10-31')) === JSON.stringify(mig.ENGINE_TREATMENT),
    'after the date the engine treatment is gross + VAT suspended; before it, gross + standard VAT');
  ok(mig.methodCompatible({ revenue_presentation: 'gross', vat_base: 'suspended' }, mig.ENGINE_TREATMENT_VAT_SUSPENDED).compatible
    && !mig.methodCompatible({ revenue_presentation: 'gross', vat_base: 'fee_plus_cleaning' }, mig.ENGINE_TREATMENT_VAT_SUSPENDED).compatible,
    'the accountant\'s policy (gross, VAT suspended) matches the suspended engine; the old treatment does not');

  await pool.end?.();
  console.log(failed ? `\n${failed} FAILED (${passed} passed)` : `\nALL ${passed} PASSED`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.stack); process.exit(1); });
