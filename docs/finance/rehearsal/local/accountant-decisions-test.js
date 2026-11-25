// The accountant's decisions of 2026-11-25 in the engine (reference calculation): VAT suspended from a date
// (financial_settings.vat_suspended_from), refunds reverse revenue and tax (R-1), forfeits give the owner their
// share (R-5). PGlite, synthetic data.
// Usage: NODE_PATH="<Server>/node_modules;<pglite dir>" node accountant-decisions-test.js <Server>
const path = require('path');
const { boot } = require('./harness');
const { seed174 } = require('./seed174');

const S = process.argv[2];
let passed = 0;
let failed = 0;
const ok = (cond, name, detail) => {
  if (cond) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 500) : ''}`); }
};
const FROM = '2026-10-01';
const TO = '2026-12-31';
// October is a frozen (closed) month in the seed, shown from its saved copy; the date splits the open November stays.
const SUSPEND = '2026-11-16';

(async () => {
  const { query } = await boot(S, { until: '174' });
  const { res, staff } = await seed174(query);
  await query(`UPDATE financial_settings SET value_text = '2026-09-01T00:00:00Z' WHERE key = 'books_reset_at'`);
  // A deposit paid on the cancelled stay (res[7], unit B at 25%) before its check-in: forfeited on cancellation.
  await query(`INSERT INTO payments (reservation_id, amount, payment_date, payment_method, status, kind) VALUES ($1, 1000, '2026-11-20', 'cash', 'successful', 'collection')`, [res[7]]);
  // Company-paid utility expenses before and after the suspension date, and a refund in the suspended period.
  await query(`INSERT INTO expenses (unit_id, paid_by, category, description, amount, expense_date, created_by)
    SELECT unit_id, 'company', 'utilities_cost', 'Utility after suspension', 1140, '2026-11-25'::date, $1::int FROM reservations WHERE id = $2
    UNION ALL SELECT unit_id, 'company', 'utilities_cost', 'Utility before suspension', 570, '2026-11-05'::date, $1::int FROM reservations WHERE id = $2`, [staff[1], res[0]]);
  await query(`INSERT INTO payments (reservation_id, amount, payment_date, payment_method, status, kind) VALUES ($1, 3100, '2026-11-21', 'cash', 'successful', 'collection'), ($1, -200, '2026-11-24', 'cash', 'successful', 'refund')`, [res[5]]);

  const e = require(path.join(S, 'src/lib/finance/ledgerEngine.js'));
  const vatPolicy = require(path.join(S, 'src/lib/finance/vatPolicy.js'));
  const sum = (entries, acct, side) => Math.round(entries.flatMap((x) => x.lines).filter((l) => l.account === acct).reduce((s, l) => s + (l[side] || 0), 0) * 100) / 100;
  const forRes = (id, type) => (j) => j.filter((x) => x.meta?.reservation_id === id && (!type || x.type === type));

  // ── Before the decision: VAT everywhere (the old behaviour) ──
  let data = await e.loadPortalData(FROM, TO);
  let j = e.buildJournal(data, FROM, TO, { includeCloses: false });
  const vatBefore = sum(j, '205000', 'credit');
  ok(vatBefore > 0 && sum(j, '107000', 'debit') > 0, `without the setting, output VAT (${vatBefore}) and input VAT are booked as before`);

  // ── The setting, read from the database ──
  await query(`INSERT INTO financial_settings (key, value_text) VALUES ('vat_suspended_from', $1)`, [SUSPEND]);
  vatPolicy._setForTests(undefined);
  await new Promise((r) => setTimeout(r, 15100)); // let the 15-second policy cache expire, so the engine reads the database
  data = await e.loadPortalData(FROM, TO);
  ok(vatPolicy.vatSuspendedFrom() === SUSPEND, 'the engine reads vat_suspended_from from financial_settings', vatPolicy.vatSuspendedFrom());
  j = e.buildJournal(data, FROM, TO, { includeCloses: false });
  const bookings = j.filter((x) => x.type === 'booking');
  const before = bookings.filter((x) => x.date < SUSPEND);
  const after = bookings.filter((x) => x.date >= SUSPEND);
  ok(before.length > 0 && after.length > 0, `stays on both sides of the date (${before.length} before, ${after.length} on or after)`);
  ok(sum(after, '205000', 'credit') === 0, 'stays booked on or after the suspension date carry no output VAT');
  ok(sum(before, '205000', 'credit') > 0, 'stays booked before the date keep their VAT (no restating)');
  ok(after.every((x) => sum([x], '105000', 'debit') === sum([x], '105000', 'debit') && !x.lines.some((l) => /Output VAT/.test(l.memo || ''))), 'no VAT line is added to what guests owe after the date');
  const exp = j.filter((x) => x.type === 'expense' || x.type === 'vendor_bill' || /expense/.test(x.type || ''));
  const expAfter = exp.filter((x) => x.date >= SUSPEND);
  ok(expAfter.length > 0 && sum(expAfter, '107000', 'debit') === 0, 'company-paid utility bills on or after the date: no input VAT split (full amount expensed)', expAfter.map((x) => x.id));
  ok(sum(exp.filter((x) => x.date < SUSPEND), '107000', 'debit') > 0, 'earlier utility bills keep their input VAT');
  const vr = e.vatReturn(j.filter((x) => x.date >= SUSPEND));
  ok(Number(vr.output_vat) === 0 && Number(vr.input_vat) === 0, 'the VAT return for the suspended period is zero', vr);
  const lineBal = (x) => Math.abs(x.lines.reduce((s, l) => s + (l.debit || 0) - (l.credit || 0), 0)) < 0.01;
  ok(j.every(lineBal), 'every entry still balances (debits = credits, line by line)', j.filter((x) => !lineBal(x)).map((x) => x.id));

  // ── R-1 refund in the suspended period ──
  const ref = forRes(res[5], 'refund')(j);
  ok(ref.length === 1 && sum(ref, '105000', 'debit') === 0 && sum(ref, '205000', 'debit') === 0 && ref[0].lines.some((l) => /^10[1-4]000$/.test(l.account) && l.credit === 200),
    'a refund after the date reverses revenue only (no VAT existed) and pays 200 out of cash', ref[0]?.lines);

  // ── R-5 forfeit ──
  const cxl = forRes(res[7], 'cancellation')(j);
  const pct = Number(cxl[0]?.meta?.company_pct);
  const ownerShare = Math.round((1000 - Math.round(1000 * pct) / 100) * 100) / 100;
  ok(cxl.length === 1 && sum(cxl, '409000', 'credit') === 1000 && pct === 25, 'the forfeited deposit (1000) is revenue in full (gross), at the unit\'s company % (25)', cxl[0]?.meta);
  ok(sum(cxl, '506000', 'debit') === ownerShare && sum(cxl, '202000', 'credit') === ownerShare && ownerShare === 750,
    'the owner gets the forfeit less the company % (750): owner share expense and payable', { owner: sum(cxl, '202000', 'credit') });
  const bals = Object.fromEntries(e.balancesFromJournal(j).map((a) => [a.code, a]));
  const ot = e.ownerTrustSubledger(j, data);
  ok(ot.tied && Math.abs(ot.control_202000 - bals['202000'].balance) < 0.01, 'the owner subledger ties to 202000 with refunds and forfeits included', { control: ot.control_202000, rows: ot.rows.length });

  // ── Resuming VAT later needs no code change ──
  vatPolicy._setForTests(null);
  const resumed = e.buildJournal(data, FROM, TO, { includeCloses: false });
  ok(sum(resumed.filter((x) => x.type === 'booking' && x.date >= SUSPEND), '205000', 'credit') > 0, 'without the setting, VAT applies again to the same stays (resumable without code)');

  console.log(failed ? `\n${failed} FAILED (${passed} passed)` : `\nALL ${passed} PASSED`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error('CRASH', err.stack); process.exit(1); });
