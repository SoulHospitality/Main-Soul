// Engine → ledger adapter (lossless copy of computed-engine entries into the posting format).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const m = require('./money');
const { toLedgerEntry } = require('./engineAdapter');

const line = (account, debit, credit) => ({ account, debit, credit });
const entry = (id, date, type, lines) => ({ id, date, type, lines, debit: 0, credit: 0, balanced: true, meta: {} });

describe('engine → ledger adapter', () => {
  it('copies amounts exactly and keys the entry for idempotent import', () => {
    const { entry: out, notes } = toLedgerEntry(entry('BK-9', '2026-11-05', 'booking', [line('105000', 4682, 0), line('401000', 0, 800), line('404000', 0, 3882)]), { policyVersion: 'P' });
    assert.equal(out.idempotencyKey, 'engine:BK-9');
    assert.equal(out.origin, 'migrated');
    assert.deepEqual(out.lines.map((l) => [l.account, l.debit, l.credit]), [['105000', '4682.00', '0'], ['401000', '0', '800.00'], ['404000', '0', '3882.00']]);
    assert.deepEqual(notes, []);
  });
  it('USD cash posts in dollars at the effective rate so the EGP base is exact', () => {
    const { entry: out } = toLedgerEntry(entry('PAY-9', '2026-10-10', 'collection', [{ account: '104000', debit: 9000, credit: 0, usd: 185.57 }, line('105000', 0, 9000)]), { policyVersion: 'P' });
    const usd = out.lines[0];
    assert.equal(usd.currency, 'USD');
    assert.equal(usd.debit, '185.57');
    assert.equal(m.toFixed(m.convert(usd.debit, usd.fxRate)), '9000.00');
  });
  it('refuses a USD cash line without its dollar figure', () => {
    assert.throws(() => toLedgerEntry(entry('PAY-8', '2026-10-10', 'collection', [line('104000', 100, 0), line('105000', 0, 100)]), { policyVersion: 'P' }), (err) => err.code === 'NO_USD_AMOUNT');
  });
});

describe('engine → ledger adapter: representation (review L2, L3)', () => {
  it('splits a line carrying both a debit and a credit into two lines (gross and balance kept)', () => {
    const { entry: out, notes } = toLedgerEntry(entry('X', '2026-11-01', 'x', [line('103000', 100, 30), line('105000', 0, 70)]), { policyVersion: 'P' });
    assert.deepEqual(out.lines.map((l) => [l.account, l.debit, l.credit]), [['103000', '100.00', '0'], ['103000', '0', '30.00'], ['105000', '0', '70.00']]);
    assert.ok(notes.some((n) => /split/.test(n)));
  });
  it('moves negatives to the other side with the same gross amounts', () => {
    const { entry: out } = toLedgerEntry(entry('N', '2026-11-01', 'x', [line('401000', -300, 0), line('105000', 0, -300)]), { policyVersion: 'P' });
    assert.deepEqual(out.lines.map((l) => [l.account, l.debit, l.credit]), [['401000', '0', '300.00'], ['105000', '300.00', '0']]);
  });
  it('refuses a two-sided USD line (one dollar figure cannot describe both sides)', () => {
    assert.throws(() => toLedgerEntry(entry('U', '2026-11-01', 'x', [{ account: '104000', debit: 100, credit: 40, usd: 2 }, line('105000', 0, 60)]), { policyVersion: 'P' }), (e) => e.code === 'USD_TWO_SIDED');
  });
  it('fills the unit dimension from the reservation → unit map', () => {
    const src = { ...entry('BK-1', '2026-11-01', 'booking', [line('105000', 50, 0), line('401000', 0, 50)]), meta: { reservation_id: 7 } };
    const { entry: out } = toLedgerEntry(src, { policyVersion: 'P', unitOf: { 7: 'unit-uuid-7' } });
    assert.ok(out.lines.every((l) => l.unitId === 'unit-uuid-7' && l.reservationId === 7));
  });
});
