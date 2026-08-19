const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  dailyRate,
  latenessFactor,
  parseHhMm,
  computeLatenessDeduction,
  computeAbsenceDeduction,
  assertCasualTiming,
  assertAnnualNotice,
  addDaysIso,
  EARLY_LEAVE_MAX_PER_YEAR,
  canRequestHolidays,
  nextPayrollPeriod,
  dateCoveredByRanges,
  parseAttendanceRows,
} = require('./hrRules');

describe('HR daily-rate deductions and leave rules', () => {
  it('uses salary / 30 as the daily rate', () => {
    assert.equal(dailyRate(9000), 300);
  });

  it('applies lateness bands after the 11:00–11:15 grace', () => {
    assert.equal(latenessFactor(parseHhMm('11:15')).factor, 0);
    assert.equal(latenessFactor(parseHhMm('11:16')).factor, 0.25);
    assert.equal(latenessFactor(parseHhMm('11:30')).factor, 0.25);
    assert.equal(latenessFactor(parseHhMm('11:31')).factor, 0.5);
    assert.equal(latenessFactor(parseHhMm('12:00')).factor, 0.5);
    assert.equal(latenessFactor(parseHhMm('12:01')).factor, 1);
    assert.equal(computeLatenessDeduction(9000, '11:20').amount, 75);
    assert.equal(computeLatenessDeduction(9000, '11:45').amount, 150);
    assert.equal(computeLatenessDeduction(9000, '12:10').amount, 300);
  });

  it('deducts 2 days for unnotified absence and 1 day with notice', () => {
    assert.equal(computeAbsenceDeduction(9000, false).amount, 600);
    assert.equal(computeAbsenceDeduction(9000, true).amount, 300);
  });

  it('blocks casual leave after the 11:00 shift on the same day', () => {
    const afterShift = new Date('2026-08-19T09:05:00Z');
    assert.throws(() => assertCasualTiming('2026-08-19', afterShift), /before the 11:00/);
    const beforeShift = new Date('2026-08-19T07:30:00Z');
    assert.doesNotThrow(() => assertCasualTiming('2026-08-19', beforeShift));
  });

  it('requires a week of notice for annual leave', () => {
    const now = new Date('2026-08-19T08:00:00Z');
    assert.throws(() => assertAnnualNotice('2026-08-24', now), /7 days/);
    assert.doesNotThrow(() => assertAnnualNotice(addDaysIso('2026-08-19', 7), now));
  });

  it('caps early leaves at two per year', () => {
    assert.equal(EARLY_LEAVE_MAX_PER_YEAR, 2);
  });

  it('enables holiday access after 6 months unless HR denies or grants', () => {
    const created = new Date('2026-01-19T00:00:00Z');
    const now = new Date('2026-08-19T00:00:00Z');
    assert.equal(canRequestHolidays({ holiday_access: 'auto', created_at: created }, now), true);
    assert.equal(
      canRequestHolidays({ holiday_access: 'auto', created_at: new Date('2026-03-19T00:00:00Z') }, now),
      false
    );
    assert.equal(canRequestHolidays({ holiday_access: 'granted', created_at: now }, now), true);
    assert.equal(canRequestHolidays({ holiday_access: 'denied', created_at: created }, now), false);
  });

  it('schedules approved loans on the first of next month', () => {
    assert.deepEqual(nextPayrollPeriod('2026-08-19'), {
      year: 2026,
      month: 9,
      deductionDate: '2026-09-01',
    });
    assert.equal(nextPayrollPeriod('2026-12-31').deductionDate, '2027-01-01');
  });

  it('skips attendance when an approved holiday covers the date', () => {
    assert.equal(
      dateCoveredByRanges('2026-08-20', [{ start_date: '2026-08-18', end_date: '2026-08-22' }]),
      true
    );
    assert.equal(
      dateCoveredByRanges('2026-08-23', [{ start_date: '2026-08-18', end_date: '2026-08-22' }]),
      false
    );
  });

  it('parses attendance excel rows as lateness or absence', () => {
    const rows = parseAttendanceRows([
      { staff_code: 'SH1', date: '2026-08-19', arrival_time: '11:20' },
      { 'Staff Code': 'SH2', Date: '2026-08-19', Status: 'absent', notified: 'yes' },
    ]);
    assert.equal(rows[0].absent, false);
    assert.equal(rows[0].arrival_time, '11:20');
    assert.equal(rows[1].absent, true);
    assert.equal(rows[1].notified, true);
  });
});
