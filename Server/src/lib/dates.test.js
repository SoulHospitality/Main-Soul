const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { todayCairo, addCalendarDays, shiftMonth } = require('./dates');

describe('Cairo calendar dates', () => {
  it('uses the Cairo date just after UTC midnight', () => {
    const utcMidnight = new Date('2026-10-27T22:30:00.000Z');
    assert.equal(todayCairo(utcMidnight), '2026-10-28');
  });

  it('adds calendar days and shifts months without UTC drift', () => {
    assert.equal(addCalendarDays('2026-10-28', 7), '2026-11-04');
    assert.equal(shiftMonth('2026-10-28', -5).slice(0, 7), '2026-05');
  });
});
