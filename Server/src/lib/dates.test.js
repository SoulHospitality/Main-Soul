const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { todayCairo, addCalendarDays, shiftMonth, isoDateOr, adjustPayoutsDue } = require('./dates');

describe('Cairo calendar dates', () => {
  it('uses the Cairo date just after UTC midnight', () => {
    const utcMidnight = new Date('2026-10-27T22:30:00.000Z');
    assert.equal(todayCairo(utcMidnight), '2026-10-28');
  });

  it('adds calendar days and shifts months without UTC drift', () => {
    assert.equal(addCalendarDays('2026-10-28', 7), '2026-11-04');
    assert.equal(shiftMonth('2026-10-28', -5).slice(0, 7), '2026-05');
  });

  it('keeps a real calendar date and replaces a Date object', () => {
    assert.equal(isoDateOr('2026-11-02', '2026-10-28'), '2026-11-02');
    assert.equal(isoDateOr(new Date('2026-11-02T00:00:00Z'), '2026-10-28'), '2026-10-28');
  });

  it('subtracts paid settlements and open payouts from payouts due', () => {
    assert.equal(adjustPayoutsDue(10000, 4000, 1500), 4500);
    assert.equal(adjustPayoutsDue(1000, 4000, 0), 0);
  });
});
