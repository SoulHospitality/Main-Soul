const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const m = require('./money');
const { splitFromSnapshot } = require('./commissionCalc');
const { reconcile } = require('./reconcile');

const s = (d) => d.toFixed(2);

describe('money: exact arithmetic', () => {
  it('0.1 + 0.2 is exactly 0.3 (no float drift)', () => {
    assert.equal(m.add('0.1', '0.2').toString(), '0.3');
    assert.equal(m.add(0.1, 0.2).toString(), '0.3');
  });
  it('reads Postgres numeric strings and rejects junk', () => {
    assert.equal(s(m.money('1234.5600')), '1234.56');
    assert.equal(s(m.money('1,500.25')), '1500.25');
    assert.throws(() => m.money('12abc'));
    assert.throws(() => m.money(NaN));
    assert.throws(() => m.money(null, { allowEmpty: false }));
  });
  it('sums a long list without drift', () => {
    const many = Array.from({ length: 10000 }, () => '0.01');
    assert.equal(s(m.sum(many)), '100.00');
  });
  it('division by zero is an error, not Infinity', () => {
    assert.throws(() => m.div('10', '0'), /Division by zero/);
  });
  it('rounds exact halves up (correct half-up, unlike the float-based round2)', () => {
    assert.equal(s(m.round('2.675')), '2.68');
    assert.equal(s(m.round('2.665')), '2.67');
    // The current books' round2(2.135) returns 2.13 because 2.135 is stored below the half in floats.
    // Decimal gives the true half-up result; parity reports list these as "rounding" differences.
    assert.equal(s(m.round('2.135')), '2.14');
    assert.equal(s(m.round('-2.675')), '-2.68');
    assert.equal(m.toFixed('10'), '10.00');
    assert.equal(m.toDb('10.12345'), '10.1235');
  });
  it('unknown currency is refused', () => {
    assert.throws(() => m.round('1', 'XYZ'));
  });
});

describe('money: allocation', () => {
  it('splits 100 into thirds that add back to exactly 100', () => {
    const parts = m.allocate('100', [1, 1, 1]);
    assert.deepEqual(parts.map(s), ['33.34', '33.33', '33.33']);
    assert.equal(s(m.sum(parts)), '100.00');
  });
  it('spreads a stay over nights per month without losing a piaster', () => {
    const parts = m.allocate('2500', [3, 4]); // 3 nights in one month, 4 in the next
    assert.equal(s(m.sum(parts)), '2500.00');
    assert.deepEqual(parts.map(s), ['1071.43', '1428.57']);
  });
  it('negative totals (refunds) allocate exactly', () => {
    const parts = m.allocate('-100', [1, 2]);
    assert.equal(s(m.sum(parts)), '-100.00');
  });
  it('zero weights are refused', () => {
    assert.throws(() => m.allocate('10', [0, 0]));
  });
});

describe('money: VAT', () => {
  it('exclusive 14%: net + tax = gross', () => {
    const r = m.exclusiveTax('1000', 14);
    assert.deepEqual([s(r.net), s(r.tax), s(r.gross)], ['1000.00', '140.00', '1140.00']);
  });
  it('inclusive 14% split always adds back to the gross', () => {
    for (const g of ['114', '100', '99.99', '1', '12345.67']) {
      const r = m.inclusiveTax(g, 14);
      assert.equal(s(r.net.plus(r.tax)), s(m.round(g)), g);
    }
    assert.deepEqual([s(m.inclusiveTax('114', 14).tax), s(m.inclusiveTax('114', 14).net)], ['14.00', '100.00']);
  });
});

describe('money: commissions from a snapshot', () => {
  const snap = { company_commission_pct: '20', sales_commission_pct: '10' };
  it('company 20% / owner 80% / agent 10% of company', () => {
    const r = splitFromSnapshot('12500', snap);
    assert.deepEqual([s(r.company), s(r.owner), s(r.agent)], ['2500.00', '10000.00', '250.00']);
    assert.equal(s(r.company.plus(r.owner)), '12500.00');
  });
  it('odd amounts: company + owner still equal the base exactly', () => {
    const r = splitFromSnapshot('3333.33', { company_commission_pct: '17.5' });
    assert.equal(s(r.company.plus(r.owner)), '3333.33');
    assert.equal(s(r.agent), '0.00');
  });
  it('no snapshot → refused (never falls back to today’s rate)', () => {
    assert.throws(() => splitFromSnapshot('1000', null), (e) => e.code === 'NO_SNAPSHOT');
  });
});

describe('money: refunds and currency', () => {
  it('a partial refund leaves the exact remainder', () => {
    const paid = m.money('4500.00');
    const refund = m.percentOf(paid, '33.3333');
    assert.equal(s(paid.minus(refund).plus(refund)), '4500.00');
  });
  it('USD converts only at a stated rate', () => {
    assert.equal(s(m.convert('100', '48.6523')), '4865.23');
    assert.throws(() => m.convert('100', '0'));
  });
});

describe('money: balanced entries and reconciliation', () => {
  it('balanced entry passes; one piaster off is refused', () => {
    const lines = [{ debit: '1140' }, { credit: '1000' }, { credit: '140' }];
    assert.equal(m.assertBalanced(lines).balanced, true);
    assert.throws(() => m.assertBalanced([{ debit: '100.00' }, { credit: '99.99' }]), (e) => e.code === 'UNBALANCED');
  });
  it('reconciliation sorts every key into one bucket', () => {
    const gl = [
      { key: 'P1', amount: '500.00', date: '2026-11-01' },
      { key: 'P2', amount: '300.00', date: '2026-11-02' },
      { key: 'P3', amount: '200.00', date: '2026-11-03' },
      { key: 'P4', amount: '50.00', date: '2026-11-04' },
    ];
    const sub = [
      { key: 'P1', amount: '500.00', date: '2026-11-01' },
      { key: 'P2', amount: '300.50', date: '2026-11-02' },
      { key: 'P3', amount: '200.00', date: '2026-11-05' },
      { key: 'P5', amount: '75.00', date: '2026-11-06' },
    ];
    const r = reconcile(gl, sub);
    assert.equal(r.matched.length, 1);
    assert.equal(r.amount_break[0].key, 'P2');
    assert.equal(r.amount_break[0].delta, '-0.50');
    assert.equal(r.timing_break[0].key, 'P3');
    assert.equal(r.ledger_only[0].key, 'P4');
    assert.equal(r.subledger_only[0].key, 'P5');
    assert.equal(r.summary.matched_pct, '20.00');
  });
});
