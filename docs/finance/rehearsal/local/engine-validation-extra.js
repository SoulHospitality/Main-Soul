// Integration scenarios not covered by engine-validation.js (T-2): insurance, cancellation forfeit, vendor
// invoice with WHT, recurring charge, petty cash, housekeeping order, owner holdback, owner payout.
// Plus the statement invariants and stored-ledger parity with every fixture together. Synthetic data only.
const path = require('path');
const { boot, provisionIdentity, claimSql } = require('./harness');
const { seedFixtures } = require('./engine-fixtures');
const { seedExtraFixtures } = require('./engine-fixtures-extra');

const S = process.argv[2];
let failed = 0;
let passed = 0;
const ok = (cond, name, detail) => {
  if (cond) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 500) : ''}`); }
};

(async () => {
  const { query, db } = await boot(S);
  await provisionIdentity(query);
  const fx = await seedFixtures(query);
  const ex = await seedExtraFixtures(query, fx);
  await query("UPDATE financial_settings SET value_text = '2026-09-01T00:00:00Z' WHERE key = 'books_reset_at'");
  const m = require(path.join(S, 'src/lib/accounting/money.js'));
  const e = require(path.join(S, 'src/lib/finance/ledgerEngine.js'));
  const { toLedgerEntry } = require(path.join(S, 'src/lib/accounting/engineAdapter.js'));
  const { reconcile } = require(path.join(S, 'src/lib/accounting/reconcile.js'));
  const identity = require(path.join(S, 'src/lib/accounting/identity.js'));
  const posting = require(path.join(S, 'src/lib/accounting/posting.js'));

  const FROM = '2026-10-01';
  const TO = '2026-12-31';
  const data = await e.loadPortalData(FROM, TO);
  const journal = e.buildJournal(data, FROM, TO);
  const byId = (id) => journal.find((x) => x.id === id);
  const amt = (entry, account, side) => m.sum((entry?.lines || []).filter((l) => l.account === account).map((l) => l[side] || 0));
  const eq = (a, b) => m.eq(a, b);

  // Insurance (escrow 204000): booking collects it, the refund releases it: 700 back, 300 retained.
  const bk7 = byId(`BK-${ex.s7}`);
  const ins = byId(`INS-${ex.s7}`);
  ok(eq(amt(bk7, '204000', 'credit'), 1000), 'insurance: the booking holds the 1,000 deposit as a liability (204000), not revenue');
  ok(ins && eq(amt(ins, '204000', 'debit'), 1000) && eq(amt(ins, '103000', 'credit'), 700) && eq(amt(ins, '410000', 'credit'), 300),
    'insurance refund: escrow released, 700 refunded in cash, 300 damage retained as revenue 410000', ins?.lines);
  ok(eq(amt(bk7, '205000', 'credit'), m.percentOf(400, 14)), 'insurance is outside the VAT base (VAT only on the 400 commission)');

  // Cancellation forfeit: the deposit leaves guest deposits and becomes revenue (whole forfeit to the company, D-04).
  const cxl = byId(`CXL-${ex.s8}`);
  ok(cxl && eq(amt(cxl, '203000', 'debit'), 900) && eq(amt(cxl, '409000', 'credit'), 900), 'cancellation forfeit: 900 deposit moves from 203000 to revenue 409000');
  ok(!byId(`BK-${ex.s8}`), 'a cancelled stay produces no booking');

  // Vendor invoice: expense and payable, paid net of 1% WHT, WHT owed to the tax authority.
  const viAcc = byId(`VI-${ex.vi}-ACC`);
  const viPay = byId(`VI-${ex.vi}-PAY`);
  ok(viAcc && eq(amt(viAcc, '201000', 'credit'), 1000), 'vendor invoice accrued as a 1,000 payable');
  ok(viPay && eq(amt(viPay, '201000', 'debit'), 1000) && eq(amt(viPay, '101000', 'credit'), 990) && eq(amt(viPay, '206000', 'credit'), 10),
    'vendor payment: 990 paid, 10 withheld to WHT payable 206000, payable cleared');

  // Recurring charge: one accrual and one payment per month, input VAT split at 14% (VAT-inclusive assumption, R-4).
  const rec = journal.filter((x) => x.type === 'recurring_accrual');
  ok(rec.length === 3 && rec.every((x) => eq(m.add(amt(x, '608000', 'debit'), amt(x, '107000', 'debit')), 4000) && eq(amt(x, '107000', 'debit'), '491.23')),
    'recurring utilities: one 4,000 accrual per month, 491.23 input VAT (4,000 / 1.14 split)', rec.length);
  ok(journal.filter((x) => x.type === 'recurring_payment').length === 3, 'recurring utilities: one payment per month');

  // Petty cash: spending from the float is an expense; an "in" without a stated source is booked as revenue (R-7).
  const pcOut = journal.find((x) => x.type === 'petty_cash' && amt(x, '605000', 'debit') > 0);
  const pcIn = journal.find((x) => x.type === 'petty_cash' && amt(x, '108000', 'debit') > 0);
  ok(pcOut && eq(amt(pcOut, '108000', 'credit'), 150), 'petty cash spend: expense 605000 against the drawer 108000');
  ok(pcIn && eq(amt(pcIn, '409000', 'credit'), 1000), 'CHARACTERISED (R-7): a petty-cash "in" with no funding source is credited to revenue 409000, not to a cash or bank account');

  // Housekeeping order for an outside client.
  const hk = byId(`HK-${ex.hk}`);
  ok(hk && eq(amt(hk, '105000', 'debit'), 600) && eq(amt(hk, '402000', 'credit'), 600), 'housekeeping order: 600 receivable and cleaning revenue');

  // Owner holdback and payout.
  const hb = journal.find((x) => x.type === 'owner_holdback');
  const po = byId(`PO-${ex.po}`);
  ok(hb && eq(amt(hb, '202000', 'debit'), 300) && eq(amt(hb, '110000', 'credit'), 300), 'owner holdback: 300 moved from the owner payable to the recoverables reserve');
  ok(po && eq(amt(po, '202000', 'debit'), 1000) && eq(amt(po, '101000', 'credit'), 1000), 'owner payout: 1,000 paid out of the owner payable');

  // Every entry balances; statements hold with all scenarios together.
  ok(journal.every((x) => eq(m.sum(x.lines.map((l) => l.debit || 0)), m.sum(x.lines.map((l) => l.credit || 0)))), `every entry balances (${journal.length} entries)`);
  const st = e.buildStatements(journal, data.reservations, FROM, TO, data.reservationTotals);
  ok(eq(st.trial_balance.debit, st.trial_balance.credit) && eq(st.balance_sheet.totals.assets, st.balance_sheet.totals.liabilities_and_equity),
    'trial balance and balance sheet balance with every scenario', st.balance_sheet.totals);
  const ot = e.ownerTrustSubledger(journal, data);
  ok(ot.tied, 'owner subledger still ties to 202000 after the holdback and payout');
  const cf = st.cash_flow;
  ok(cf.reconciliation.balanced, 'cash flow reconciles with every scenario');
  const vr = e.vatReturn(journal);
  const bals = Object.fromEntries(e.balancesFromJournal(journal).map((a) => [a.code, a]));
  ok(eq(vr.output_vat, bals['205000'].balance) && eq(vr.input_vat, bals['107000'].balance), 'VAT return ties to 205000 and 107000');
  ok(eq(bals['206000'].balance, 10), 'WHT payable holds the withheld 10');

  // Stored-ledger parity with every scenario.
  await query(`INSERT INTO staff_users (id, username, password_hash, full_name, role, is_active) VALUES (995,'xv_a1','x','XV A1','admin',1),(996,'xv_a2','x','XV A2','admin',1),(997,'xv_rec','x','XV Rec','reservations',1)`);
  await identity.recordApproval({ purpose: 'policy_d01', subject: 'XV', approverId: 995 });
  await identity.recordApproval({ purpose: 'policy_vat', subject: 'XV', approverId: 996 });
  await db.exec(`BEGIN; ${claimSql(997)}; INSERT INTO ledger_policies (version, effective_from, settings, status, approved_by, approved_at, approval_ref, vat_approved_by, vat_approved_at, vat_approval_ref, created_by)
    VALUES ('XV', '2026-01-01', '{"revenue_presentation":"gross","vat_base":"fee_only"}', 'approved', 995, now(), 'SYNTHETIC', 996, now(), 'SYNTHETIC', 997); COMMIT;`);
  await posting.setPostingSwitch('on', { actorId: 995, reason: 'synthetic parity, all scenarios' });
  for (const x of journal) await posting.postEntry(toLedgerEntry(x, { policyVersion: 'XV' }).entry);
  const stored = await posting.trialBalance();
  const rec2 = reconcile(stored.map((r) => ({ key: r.account, amount: r.balance })),
    e.balancesFromJournal(journal).filter((a) => !a.virtual && (a.debit || a.credit)).map((a) => ({ key: a.code, amount: m.toFixed(m.sub(a.debit, a.credit)) })));
  ok(rec2.summary.breaks === 0, `stored ledger = engine for every account with every scenario (${rec2.summary.keys} accounts, ${journal.length} entries)`, { a: rec2.amount_break, l: rec2.ledger_only, s: rec2.subledger_only });

  // Engine error handling: a genuine query failure is raised; a missing optional table falls back.
  await query(`ALTER TABLE ar_write_offs RENAME TO ar_write_offs_saved`);
  const missing = await e.loadPortalData(FROM, TO).then((d) => d.writeOffs, (err) => err);
  ok(Array.isArray(missing) && missing.length === 0, 'a missing optional table (older schema) still falls back to an empty list');
  await query(`CREATE FUNCTION pg_temp_fail() RETURNS numeric LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'synthetic storage failure'; END $f$`);
  await query(`CREATE VIEW ar_write_offs AS SELECT w.*, pg_temp_fail() AS boom FROM ar_write_offs_saved w`);
  const broken = await e.loadPortalData(FROM, TO).then(() => null, (err) => err);
  ok(broken && /could not load writeOffs: synthetic storage failure/.test(broken.message), 'a real query error surfaces with the data source named (it used to drop write-offs silently)', broken && broken.message);
  await query(`DROP VIEW ar_write_offs`); await query(`ALTER TABLE ar_write_offs_saved RENAME TO ar_write_offs`);
  console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL ${passed} PASSED`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('CRASH', err.stack); process.exit(1); });
