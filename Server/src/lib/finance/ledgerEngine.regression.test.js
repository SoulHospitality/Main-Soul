// Regression tests for defects found in Phase 5 (pure: no database).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const e = require('./ledgerEngine');
const m = require('../accounting/money');

const line = (account, debit, credit) => ({ account, debit, credit });
const entry = (id, date, type, lines) => ({ id, date, type, lines, debit: 0, credit: 0, balanced: true, meta: {} });
const balanced = (x) => m.eq(m.sum(x.lines.map((l) => l.debit || 0)), m.sum(x.lines.map((l) => l.credit || 0)));

describe('DEF-CLOSE-01: month close with opposite-signed P&L balances', () => {
  const month = [
    entry('CN', '2026-12-10', 'credit_note', [line('401000', 300, 0), line('105000', 0, 300)]),
    entry('ECL', '2026-12-31', 'credit_loss_provision', [line('105900', 120, 0), line('620000', 0, 120)]),
    entry('BK', '2026-12-12', 'booking', [line('105000', 1000, 0), line('402000', 0, 1000)]),
  ];
  const close = e.closeMonthEntry('2026-12', month);
  it('keeps every account line (none dropped) and balances', () => {
    assert.deepEqual(close.lines.map((l) => l.account).sort(), ['302000', '401000', '402000', '620000']);
    assert.ok(balanced(close));
    assert.equal(close.balanced, true);
  });
  it('zeroes every revenue and expense account', () => {
    const after = e.balancesFromJournal([...month, close]).filter((a) => a.type === 'revenue' || a.type === 'expense');
    assert.ok(after.every((a) => Math.abs(a.balance) < 0.005), JSON.stringify(after.filter((a) => a.balance)));
  });
  it('moves the true profit (700 revenue + 120 release = 820) to retained earnings', () => {
    const re = close.lines.find((l) => l.account === '302000');
    assert.equal(re.credit, 820);
  });
  it('never writes a negative amount', () => {
    assert.ok(close.lines.every((l) => (l.debit || 0) >= 0 && (l.credit || 0) >= 0));
  });
});

describe('DEF-BS-01: balance sheet after a closed month', () => {
  const oct = [entry('BK1', '2026-10-05', 'booking', [line('103000', 1000, 0), line('401000', 0, 1000)])];
  const close = e.closeMonthEntry('2026-10', oct);
  const nov = [entry('BK2', '2026-11-05', 'booking', [line('103000', 500, 0), line('401000', 0, 500)])];
  const st = e.buildStatements([...oct, close, ...nov], [], '2026-10-01', '2026-11-30');
  it('balances: assets = liabilities + equity', () => {
    assert.equal(st.balance_sheet.totals.assets, st.balance_sheet.totals.liabilities_and_equity);
  });
  it('shows the open months\' profit as current-year earnings and closed months in retained earnings', () => {
    const eq = Object.fromEntries(st.balance_sheet.equity.map((a) => [a.code, a.balance]));
    assert.equal(eq['303000'], 500);
    assert.equal(eq['302000'], 1000);
  });
  it('unchanged when nothing is closed', () => {
    const open = e.buildStatements([...oct, ...nov], [], '2026-10-01', '2026-11-30');
    assert.equal(open.balance_sheet.totals.assets, open.balance_sheet.totals.liabilities_and_equity);
    assert.equal(Object.fromEntries(open.balance_sheet.equity.map((a) => [a.code, a.balance]))['303000'], 1500);
  });
});

describe('DEF-PL-01 (review H4): P&L over a range containing closed and open months', () => {
  // October: revenue 1,000, expense 200, closed. November: revenue 500, expense 50, open.
  const oct = [
    entry('BK1', '2026-10-05', 'booking', [line('103000', 1000, 0), line('401000', 0, 1000)]),
    entry('EX1', '2026-10-06', 'expense', [line('608000', 200, 0), line('103000', 0, 200)]),
  ];
  const close = e.closeMonthEntry('2026-10', oct);
  const nov = [
    entry('BK2', '2026-11-05', 'booking', [line('103000', 500, 0), line('401000', 0, 500)]),
    entry('EX2', '2026-11-06', 'expense', [line('608000', 50, 0), line('103000', 0, 50)]),
  ];
  const withClose = e.buildStatements([...oct, close, ...nov], [], '2026-10-01', '2026-11-30');
  const noClose = e.buildStatements([...oct, ...nov], [], '2026-10-01', '2026-11-30');
  const pnlSum = (st, key) => m.toFixed(m.sum(st.profit_and_loss[key].map((a) => a.balance)));
  it('includes the closed month in revenue and expenses (1,500 / 250)', () => {
    assert.equal(pnlSum(withClose, 'revenue'), '1500.00');
    assert.equal(pnlSum(withClose, 'expenses'), '250.00');
  });
  it('is identical whether or not October has been closed', () => {
    assert.equal(pnlSum(withClose, 'revenue'), pnlSum(noClose, 'revenue'));
    assert.equal(pnlSum(withClose, 'expenses'), pnlSum(noClose, 'expenses'));
  });
  it('period profit (1,250) = retained earnings from the closed month (800) + current-year earnings (450): no double count', () => {
    const eq = Object.fromEntries(withClose.balance_sheet.equity.map((a) => [a.code, a.balance]));
    assert.equal(eq['302000'], 800);
    assert.equal(eq['303000'], 450);
    assert.equal(m.toFixed(m.sub(pnlSum(withClose, 'revenue'), pnlSum(withClose, 'expenses'))), m.toFixed(m.add(eq['302000'], eq['303000'])));
  });
  it('trial balance and balance sheet both balance', () => {
    assert.equal(withClose.trial_balance.debit, withClose.trial_balance.credit);
    assert.equal(withClose.balance_sheet.totals.assets, withClose.balance_sheet.totals.liabilities_and_equity);
    assert.equal(withClose.balance_sheet.totals.assets, 1250);
  });
});
