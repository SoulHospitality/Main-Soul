// Accounting engine, report and stored-ledger parity validation on synthetic fixtures (PGlite).
// Expected figures are computed independently with lib/accounting/money.js (Decimal), never with floats.
const path = require('path');
const { boot, provisionIdentity, claimSql } = require('./harness');
const { seedFixtures } = require('./engine-fixtures');

const S = process.argv[2];
let failed = 0;
let passed = 0;
const ok = (cond, name, detail) => {
  if (cond) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 500) : ''}`); }
};

(async () => {
  const { query, db } = await boot(S);
  await provisionIdentity(query);
  const identity = require(path.join(S, 'src/lib/accounting/identity.js'));
  const fx = await seedFixtures(query);
  await query("UPDATE financial_settings SET value_text = '2026-09-01T00:00:00Z' WHERE key = 'books_reset_at'");
  const m = require(path.join(S, 'src/lib/accounting/money.js'));
  const e = require(path.join(S, 'src/lib/finance/ledgerEngine.js'));
  const { splitFromSnapshot } = require(path.join(S, 'src/lib/accounting/commissionCalc.js'));
  const { toLedgerEntry } = require(path.join(S, 'src/lib/accounting/engineAdapter.js'));
  const { reconcile } = require(path.join(S, 'src/lib/accounting/reconcile.js'));

  const FROM = '2026-10-01';
  const TO = '2026-12-31';
  const data = await e.loadPortalData(FROM, TO);
  const journal = e.buildJournal(data, FROM, TO);
  const forRes = (key, type) => journal.filter((x) => x.meta?.reservation_id === fx.res[key] && (!type || x.type === type));
  const sumLines = (entries, account, side) => entries.reduce((s, x) => s.plus((x.lines || []).filter((l) => l.account === account).reduce((t, l) => t.plus(m.money(l[side] || 0)), m.money(0))), m.money(0));
  const eq = (a, b) => m.eq(a, b);

  // ── 1. Double entry ──
  const unbalanced = journal.filter((x) => !m.eq(m.sum((x.lines || []).map((l) => l.debit || 0)), m.sum((x.lines || []).map((l) => l.credit || 0))));
  ok(unbalanced.length === 0, `every engine entry balances exactly (${journal.length} entries)`, unbalanced.map((x) => x.id));
  const badPrecision = journal.flatMap((x) => (x.lines || []).filter((l) => !m.eq(m.round(l.debit || 0), l.debit || 0) || !m.eq(m.round(l.credit || 0), l.credit || 0)).map((l) => [x.id, l.account]));
  ok(badPrecision.length === 0, 'every engine amount is at currency precision (2 decimals)', badPrecision);
  const negatives = journal.flatMap((x) => (x.lines || []).filter((l) => (l.debit || 0) < 0 || (l.credit || 0) < 0).map((l) => [x.id, l.account]));
  ok(negatives.length === 0, 'no negative line amounts in this fixture journal', negatives);

  // ── 2. Stay economics against independent figures ──
  const vat = (base) => m.percentOf(base, 14);
  // S1: mode A, 20%, 4 × 1000, cleaning 500.
  const s1 = splitFromSnapshot('4000', { applied: { company_pct: 20, tenant_deduction_pct: 0, sales_pct: 10 } });
  const bk1 = forRes('s1', 'booking');
  ok(eq(sumLines(bk1, '401000', 'credit'), s1.company) && eq(sumLines(bk1, '404000', 'credit'), s1.owner) && eq(sumLines(bk1, '402000', 'credit'), '500'),
    'S1 booking: commission 800, owner slice 3200, cleaning 500 (matches snapshot calculation)');
  ok(eq(sumLines(bk1, '205000', 'credit'), vat(s1.company.plus(500))), 'S1 output VAT = 14% × (commission + cleaning) = 182');
  ok(eq(sumLines(forRes('s1', 'agent_commission'), '209000', 'credit'), s1.agent), 'S1 salesperson commission = 10% of company commission = 80');
  ok(eq(sumLines(bk1, '202000', 'credit'), s1.owner), 'S1 owner payable credited with the owner share');
  // Revenue across nights: 2 of 4 nights in November are deferred, then recognised on 1 Nov.
  const def1 = forRes('s1', 'revenue_deferral');
  const rec1 = forRes('s1', 'revenue_recognition');
  ok(eq(sumLines(def1, '210000', 'credit'), '2000') && eq(sumLines(def1, '401000', 'debit'), m.mul(s1.company, '0.5')) && def1[0]?.date === '2026-10-30',
    'S1 deferral: November nights (2 of 4) moved to deferred revenue 210000 at check-in');
  ok(eq(sumLines(rec1, '210000', 'debit'), '2000') && rec1[0]?.date === '2026-11-01', 'S1 recognition: deferred nights released on 1 November');
  const oct = e.buildJournal(data, FROM, '2026-10-31', { includeCloses: false });
  const octBals = Object.fromEntries(e.balancesFromJournal(oct).map((a) => [a.code, a]));
  ok(eq(octBals['210000'].credit - octBals['210000'].debit, 2000), 'deferred revenue at 31 October equals the unstayed November nights');
  // S2: mode B, 25%, tenant 5%, 3 × 3000 (EGP equivalent of a USD stay).
  const s2 = splitFromSnapshot('9000', { applied: { company_pct: 25, tenant_deduction_pct: 5, sales_pct: 10 } });
  const bk2 = forRes('s2', 'booking');
  ok(eq(sumLines(bk2, '401000', 'credit'), s2.company) && eq(sumLines(bk2, '404000', 'credit'), s2.owner) && eq(sumLines(bk2, '403000', 'credit'), s2.tenant),
    'S2 mode B: tenant deduction 450, commission 2137.50, owner 6412.50');
  // S3: mode C owner-booked: owner % 12, no tenant deduction.
  const s3 = splitFromSnapshot('4000', { applied: { company_pct: 12, tenant_deduction_pct: 0 } });
  ok(eq(sumLines(forRes('s3', 'booking'), '401000', 'credit'), s3.company) && eq(sumLines(forRes('s3', 'booking'), '205000', 'credit'), vat(s3.company)),
    'S3 mode C owner-booked: 12% commission (480) and VAT on it');
  // S4: mode C guest: 22%, tenant 10%.
  const s4 = splitFromSnapshot('4500', { applied: { company_pct: 22, tenant_deduction_pct: 10 } });
  ok(eq(sumLines(forRes('s4', 'booking'), '401000', 'credit'), s4.company) && eq(sumLines(forRes('s4', 'booking'), '404000', 'credit'), s4.owner),
    'S4 mode C guest stay: commission 891, owner 3159');
  ok(eq(sumLines(forRes('s4', 'booking'), '205000', 'credit'), vat(s4.company)), 'S4 VAT is charged on the commission only; the tenant markup (403000) carries no VAT (VAT-base question, D-11)');
  // S5: paid before the stay → guest deposit; S6 cancelled → nothing booked.
  const nov = e.buildJournal(data, FROM, '2026-11-30', { includeCloses: false });
  const novBals = Object.fromEntries(e.balancesFromJournal(nov).map((a) => [a.code, a]));
  ok(eq(sumLines(forRes('s5', 'collection'), '203000', 'credit'), '2400') && eq(novBals['203000'].credit - novBals['203000'].debit, 2400),
    'S5 advance payment sits in guest deposits (203000) until the stay');
  ok(forRes('s6').length === 0, 'S6 cancelled stay with no payment produces no entries');

  // ── 3. Payments, gateway, refunds ──
  const gw = journal.find((x) => x.type === 'gateway_settle' && x.meta?.reservation_id === fx.res.s4);
  ok(gw && eq(sumLines([gw], '504000', 'debit'), m.percentOf('4500', '1.5')) && eq(sumLines([gw], '106000', 'credit'), '4500'), 'Paymob settlement: 1.5% gateway fee expensed, clearing account emptied');
  const ref = forRes('s4', 'refund');
  // R-1 (accountant, 2026-11-25): a refund reverses revenue and tax "like it never happened", in proportion to the
  // stay's invoice; nothing goes back on the guest receivable.
  const bk4 = forRes('s4', 'booking');
  const inv4 = sumLines(bk4, '105000', 'debit');
  const f4 = m.div(500, inv4);
  const expect4 = (acct) => m.round(m.mul(sumLines(bk4, acct, 'credit'), f4));
  const refNet = m.sub(m.sum(ref.flatMap((x) => x.lines).map((l) => l.debit || 0)), m.sum(ref.flatMap((x) => x.lines).filter((l) => l.account !== '106000').map((l) => l.credit || 0)));
  ok(eq(sumLines(ref, '106000', 'credit'), '500') && eq(sumLines(ref, '105000', 'debit'), '0') && ref.every((x) => x.balanced),
    'refund (R-1): 500 paid out through the gateway; nothing put back on the guest receivable; entry balanced');
  ok(eq(sumLines(ref, '205000', 'debit'), expect4('205000')) && eq(sumLines(ref, '401000', 'debit'), expect4('401000'))
    && m.abs(m.sub(sumLines(ref, '404000', 'debit'), expect4('404000'))).lte('0.02') && eq(sumLines(ref, '202000', 'debit'), m.round(m.mul(sumLines(bk4, '202000', 'credit'), f4))),
    `refund (R-1): revenue, VAT and the owner's share are reversed in proportion (500 / ${m.toFixed(inv4)} of the stay)`, { vat: sumLines(ref, '205000', 'debit'), want: expect4('205000') });
  ok(eq(refNet, '500'), 'refund (R-1): the reversed lines add up to exactly the refund', m.toFixed(refNet));
  // ── 4. FX: USD cash carries its dollar figure ──
  const usdLines = journal.flatMap((x) => (x.lines || []).filter((l) => l.account === '104000'));
  ok(usdLines.length > 0 && usdLines.every((l) => Number(l.usd) > 0) && eq(m.round(m.div(usdLines[0].debit, 48.5)), usdLines[0].usd),
    'USD cash lines (104000) carry dollars = EGP ÷ the stay rate (48.5)', usdLines.map((l) => [l.debit, l.usd]));

  // ── 5. Bad debt ──
  const wo = journal.find((x) => x.type === 'write_off');
  ok(wo && eq(sumLines([wo], '620000', 'debit'), '100') && eq(sumLines([wo], '105000', 'credit'), '100'), 'approved write-off: bad debt expense against the receivable');
  const ecl = journal.filter((x) => x.type === 'credit_loss_provision').sort((a, b) => a.date.localeCompare(b.date));
  ok(ecl.length === 2 && eq(sumLines([ecl[0]], '105900', 'credit'), '200') && eq(sumLines([ecl[1]], '105900', 'debit'), '50'),
    'allowance moves to each month\'s target: +200 in October, −50 release in November');

  // ── 6. Month close ──
  const close = journal.find((x) => x.type === 'period_close');
  const octOpen = e.buildJournal(data, FROM, '2026-10-31', { includeCloses: false });
  const octPnl = e.balancesFromJournal(octOpen).filter((a) => a.type === 'revenue' || a.type === 'expense')
    .reduce((s, a) => s.plus(a.type === 'revenue' ? a.balance : -a.balance), m.money(0));
  ok(close && eq(sumLines([close], '302000', 'credit').minus(sumLines([close], '302000', 'debit')), octPnl),
    'October close moves exactly October\'s profit to retained earnings (302000)', { octPnl: m.toFixed(octPnl) });
  // Regression DEF-CLOSE-01: a month where revenue ends in debit (credit note) and an expense ends in credit
  // (allowance release). The close used to drop those lines and come out unbalanced.
  const synthetic = [
    { id: 'X1', type: 'credit_note', date: '2026-12-10', lines: [{ account: '401000', debit: 300, credit: 0 }, { account: '105000', debit: 0, credit: 300 }] },
    { id: 'X2', type: 'credit_loss_provision', date: '2026-12-31', lines: [{ account: '105900', debit: 120, credit: 0 }, { account: '620000', debit: 0, credit: 120 }] },
    { id: 'X3', type: 'booking', date: '2026-12-12', lines: [{ account: '105000', debit: 1000, credit: 0 }, { account: '402000', debit: 0, credit: 1000 }] },
  ];
  const dec = e.closeMonthEntry('2026-12', synthetic);
  const decBals = e.balancesFromJournal([...synthetic, dec]).filter((a) => a.type === 'revenue' || a.type === 'expense');
  ok(dec.balanced && eq(dec.debit, dec.credit) && decBals.every((a) => eq(a.balance, 0)) && eq(sumLines([dec], '302000', 'credit'), '820'),
    'month close with opposite-signed revenue/expense balances is balanced, zeroes every P&L account and moves 820 (= 700 revenue + 120 release) (regression DEF-CLOSE-01)',
    dec.lines.map((l) => [l.account, l.debit, l.credit]));
  // Adapter: any negative line from the engine is moved to the other side, balance unchanged, and reported.
  const adapted = toLedgerEntry({ id: 'NEG', type: 'x', date: '2026-12-01', lines: [{ account: '401000', debit: -300, credit: 0 }, { account: '105000', debit: 0, credit: -300 }] }, { policyVersion: 'P' });
  ok(adapted.entry.lines.find((l) => l.account === '401000').credit === '300.00' && adapted.entry.lines.find((l) => l.account === '105000').debit === '300.00' && adapted.notes.length === 2,
    'adapter moves negative engine lines to the other side with the same balance and reports each', adapted.notes);

  // ── 7. Statements ──
  const st = e.buildStatements(journal, data.reservations, FROM, TO, data.reservationTotals);
  ok(eq(st.trial_balance.debit, st.trial_balance.credit), 'trial balance: total debits = total credits');
  const bs = st.balance_sheet.totals;
  ok(eq(bs.assets, bs.liabilities_and_equity), 'balance sheet balances with a closed month followed by open months (regression: DEF-BS-01)', bs);
  const bals = e.balancesFromJournal(journal);
  const openPnl = bals.filter((a) => a.type === 'revenue' || a.type === 'expense').reduce((s, a) => s.plus(a.type === 'revenue' ? a.balance : -a.balance), m.money(0));
  ok(eq(st.balance_sheet.equity.find((a) => a.code === '303000').balance, openPnl), 'current-year earnings (303000) = profit of the months after the last close');
  const stNoClose = e.buildStatements(e.buildJournal(data, FROM, TO, { includeCloses: false }), data.reservations, FROM, TO, data.reservationTotals);
  ok(eq(stNoClose.balance_sheet.totals.assets, stNoClose.balance_sheet.totals.liabilities_and_equity), 'balance sheet balances without any close');
  const cf = st.cash_flow;
  const treasuryCodes = cf.by_account.map((a) => a.code);
  const cashBal = bals.filter((a) => treasuryCodes.includes(a.code) || (a.custom && treasuryCodes.includes(a.parent_code))).reduce((s, a) => s.plus(a.balance), m.money(0));
  ok(cf.reconciliation.balanced && eq(cf.net_change, cf.ending_cash - cf.opening_cash) && eq(cf.ending_cash, cashBal),
    'cash flow: opening + net change = closing = treasury balances in the ledger', { cf: cf.reconciliation, cashBal: m.toFixed(cashBal) });
  ok(eq(cf.operating.total + cf.investing.total + cf.financing.total, cf.net_change), 'cash flow sections add up to the net change');
  const byCode = Object.fromEntries(bals.map((a) => [a.code, a]));
  const ot = e.ownerTrustSubledger(journal, data);
  ok(ot.tied && eq(ot.control_202000, byCode['202000'].balance), 'owner balances: subledger ties to the owner payable control account (202000)');
  ok(eq(byCode['201000'].balance, '1200'), 'accounts payable: only the owner-paid repair (1200) is still open; the paid utility bill is cleared');
  const vr = e.vatReturn(journal);
  const expectedOut = m.sub(m.sum([vat(s1.company.plus(500)), vat(s2.company), vat(s3.company), vat(s4.company)]), sumLines(ref, '205000', 'debit'));
  ok(eq(vr.output_vat, expectedOut) && eq(vr.output_vat, byCode['205000'].balance), 'tax: output VAT return = sum of stay VAT less the VAT reversed by the S4 refund (R-1) = control account 205000', vr);
  ok(eq(vr.input_vat, byCode['107000'].balance) && eq(vr.input_vat, '104.39'), 'tax: input VAT = 107000 (utility bill treated as VAT-inclusive at 14%: 850 → 104.39)');
  const commissions = m.sum([s1.company, s2.company, s3.company, s4.company]);
  ok(eq(byCode['401000'].balance + 0, byCode['401000'].balance) && eq(sumLines(journal.filter((x) => x.type === 'booking'), '401000', 'credit'), commissions),
    'commission report: booked commission = sum of the four stays\' company shares');
  ok(eq(sumLines(journal, '209000', 'credit'), m.sum([s1.company, s2.company, s3.company, s4.company].map((c) => m.percentOf(c, 10)))),
    'commission report: salesperson commission payable = 10% of each company share (430.85)');
  // Receivable composition: everything the ledger says guests still owe, rebuilt independently.
  const expectedAr = m.sum([vat(s1.company.plus(500)), vat(s2.company), m.add(4000, vat(s3.company)), vat(s4.company), -100]);
  ok(eq(byCode['105000'].balance, expectedAr),
    'receivables (105000) = unpaid VAT added on top of S1, S2, S4 + unpaid owner-booked S3 − write-off; the S4 refund no longer sits on the receivable (R-1) (4573.19)', { ledger: byCode['105000'].balance, expected: m.toFixed(expectedAr) });
  // AR: ledger receivable vs the reservation-based outstanding list.
  const aging = e.agingFromReservations(data.reservations);
  ok(true, `INFO receivables: ledger 105000 = ${byCode['105000'].balance}, reservation outstanding list = ${aging.total} (different definitions; see report doc)`);
  // Per-unit profitability from journal lines (unit dimension via reservation).
  const unitOf = Object.fromEntries((data.reservations || []).map((r) => [r.id, r.unit_id]));
  const unitRev = {};
  for (const x of journal.filter((y) => y.type === 'booking' || y.type === 'revenue_deferral' || y.type === 'revenue_recognition')) {
    const u = unitOf[x.meta?.reservation_id];
    for (const l of x.lines) if (['401000', '402000', '403000'].includes(l.account)) unitRev[u] = m.add(unitRev[u] || 0, m.sub(l.credit || 0, l.debit || 0));
  }
  ok(eq(unitRev[fx.units.a], s1.company.plus(500)) && eq(unitRev[fx.units.c], s3.company.plus(s4.company).plus(s4.tenant)),
    'unit profitability: company revenue per unit reconstructs from the journal (unit A 1300; unit C 1821)', Object.fromEntries(Object.entries(unitRev).map(([k, v]) => [k, m.toFixed(v)])));

  // ── 8. Stored-ledger parity: post the whole engine journal and compare the trial balance ──
  const posting = require(path.join(S, 'src/lib/accounting/posting.js'));
  await query(`INSERT INTO staff_users (id, username, password_hash, full_name, role, is_active) VALUES (995,'ev_admin','x','EV Admin','admin',1),(996,'ev_admin2','x','EV Admin 2','admin',1),(997,'ev_rec','x','EV Recorder','reservations',1)`);
  await identity.recordApproval({ purpose: 'policy_d01', subject: 'VALIDATION-ONLY', approverId: 995 });
  await identity.recordApproval({ purpose: 'policy_vat', subject: 'VALIDATION-ONLY', approverId: 996 });
  await db.exec(`BEGIN; ${claimSql(997)}; INSERT INTO ledger_policies (version, effective_from, settings, status, approved_by, approved_at, approval_ref, vat_approved_by, vat_approved_at, vat_approval_ref, created_by)
    VALUES ('VALIDATION-ONLY', '2026-01-01', '{"revenue_presentation":"gross","vat_base":"fee_only"}', 'approved', 995, now(), 'SYNTHETIC TEST - NOT AN APPROVAL', 996, now(), 'SYNTHETIC TEST - NOT AN APPROVAL', 997); COMMIT;`);
  await db.exec(`BEGIN; ${claimSql(995)}; SELECT set_config('app.control_reason','synthetic parity validation',true); UPDATE financial_settings SET value_text='on' WHERE key='ledger_posting'; COMMIT;`);
  const notes = [];
  for (const x of journal) {
    const { entry, notes: n } = toLedgerEntry(x, { policyVersion: 'VALIDATION-ONLY' });
    notes.push(...n.map((t) => `${x.id}: ${t}`));
    await posting.postEntry(entry);
  }
  const again = await posting.postEntry(toLedgerEntry(journal[0], { policyVersion: 'VALIDATION-ONLY' }).entry);
  ok(again.duplicate, 're-running the import posts nothing twice (idempotent)');
  const stored = await posting.trialBalance();
  const engineRows = bals.filter((a) => !a.virtual && (a.debit || a.credit)).map((a) => ({ key: a.code, amount: m.toFixed(m.sub(a.debit, a.credit)) }));
  const storedRows = stored.map((r) => ({ key: r.account, amount: r.balance }));
  const rec = reconcile(storedRows, engineRows);
  ok(rec.summary.breaks === 0, `stored ledger trial balance = engine trial balance for every account (${rec.summary.keys} accounts, ${journal.length} entries)`, { amount: rec.amount_break, l: rec.ledger_only, s: rec.subledger_only });
  ok(Number((await query(`SELECT COUNT(*)::int n FROM ledger_entries`)).rows[0].n) === journal.length, 'one stored entry per engine entry');
  const usdStored = (await query(`SELECT SUM(base_debit) - SUM(base_credit) AS egp, SUM(debit) - SUM(credit) AS usd FROM ledger_lines WHERE account_code = '104000'`)).rows[0];
  ok(eq(usdStored.egp, byCode['104000'].balance), 'USD cash: stored EGP base equals the engine\'s EGP exactly', usdStored);
  console.log(`  adapter notes: ${notes.length ? notes.join(' | ') : 'none'}`);

  console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL ${passed} PASSED`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('CRASH', err.stack); process.exit(1); });
