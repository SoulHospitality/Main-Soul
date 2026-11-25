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

describe('review L4: month close is independent of the contra flag', () => {
  it('a contra P&L account is zeroed by the close and its effect follows its raw debits and credits', () => {
    const { CHART_OF_ACCOUNTS } = require('./chartOfAccounts');
    const rev = CHART_OF_ACCOUNTS.find((a) => a.code === '409000');
    const saved = rev.contra;
    rev.contra = true; // simulate a contra-revenue account (none exist today)
    try {
      const month = [
        entry('S', '2026-12-05', 'x', [line('105000', 1000, 0), line('402000', 0, 1000)]),
        entry('D', '2026-12-06', 'x', [line('409000', 150, 0), line('105000', 0, 150)]), // contra-revenue debit (discount)
      ];
      const close = e.closeMonthEntry('2026-12', month);
      assert.ok(balanced(close));
      const after = e.balancesFromJournal([...month, close]).filter((a) => ['402000', '409000'].includes(a.code));
      assert.ok(after.every((a) => Math.abs(a.debit - a.credit) < 0.005));
      assert.equal(close.lines.find((l) => l.account === '302000').credit, 850);
    } finally {
      rev.contra = saved;
    }
  });
});

describe('review L5: entries posted directly to 303000 are not lost', () => {
  it('balance sheet keeps a manual 303000 posting on top of the open P&L and still balances', () => {
    const j = [
      entry('B', '2026-11-05', 'booking', [line('103000', 500, 0), line('401000', 0, 500)]),
      entry('M', '2026-11-06', 'manual_journal', [line('103000', 70, 0), line('303000', 0, 70)]),
    ];
    const st = e.buildStatements(j, [], '2026-11-01', '2026-11-30');
    assert.equal(Object.fromEntries(st.balance_sheet.equity.map((a) => [a.code, a.balance]))['303000'], 570);
    assert.equal(st.balance_sheet.totals.assets, st.balance_sheet.totals.liabilities_and_equity);
  });
});

describe('engine error handling (Phase 7)', () => {
  it('optionalSource: a missing table or column falls back; any other error is raised with the source named', () => {
    assert.deepEqual(e.optionalSource({ code: '42P01', message: 'relation does not exist' }, [], 'writeOffs'), []);
    assert.equal(e.optionalSource({ code: '42703', message: 'column does not exist' }, false, 'period closes'), false);
    const err = new Error('connection terminated');
    err.code = '57P01';
    assert.throws(() => e.optionalSource(err, [], 'writeOffs'), /could not load writeOffs: connection terminated/);
  });
  it('lines on an account outside the chart are reported, not silently dropped', () => {
    const j = [entry('REC-1', '2026-11-05', 'recurring_accrual', [line('604000', 3508.77, 0), line('107000', 491.23, 0), line('201000', 0, 4000)])];
    const st = e.buildStatements(j, [], '2026-11-01', '2026-11-30');
    assert.deepEqual(st.integrity.unknown_accounts, [{ account: '604000', debit: 3508.77, credit: 0, entries: ['REC-1'] }]);
    const clean = e.buildStatements([entry('B', '2026-11-05', 'booking', [line('103000', 10, 0), line('401000', 0, 10)])], [], '2026-11-01', '2026-11-30');
    assert.deepEqual(clean.integrity.unknown_accounts, []);
  });
});
