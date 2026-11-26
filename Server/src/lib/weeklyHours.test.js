const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  shiftOf,
  computeLatenessDeduction,
  computeEarlyLeaveDeduction,
  computeWeeklyHoursDeduction,
  weeklyHourlyRate,
  isWeeklyHoursStaff,
  dailyRate,
} = require('./hrRules');
const { weekBounds, clockedMinutes, requiredHoursForWeek, weekSummary, settleWeeklyHours } = require('./weeklyHours');

describe('Own shift per staff member', () => {
  it('falls back to 11:00–19:00 and reads HH:MM:SS from the database', () => {
    assert.deepEqual(shiftOf({}), { start: 660, end: 1140, startText: '11:00', endText: '19:00' });
    assert.deepEqual(shiftOf({ shift_start: '09:00:00', shift_end: '17:30:00' }), { start: 540, end: 1050, startText: '09:00', endText: '17:30' });
    // An impossible shift (end before start) is ignored.
    assert.equal(shiftOf({ shift_start: '18:00', shift_end: '10:00' }).startText, '11:00');
  });

  it('moves the lateness bands with the shift start', () => {
    const salary = 9000; // daily 300
    assert.equal(computeLatenessDeduction(salary, '11:20').amount, 75); // standard shift: 0.25 day
    assert.equal(computeLatenessDeduction(salary, '09:10', '09:00').amount, 0); // 09:00 shift, inside grace
    assert.equal(computeLatenessDeduction(salary, '09:20', '09:00').amount, 75); // 20 min late = 0.25 day
    assert.equal(computeLatenessDeduction(salary, '10:30', '09:00').amount, 300); // 90 min late = full day
    assert.equal(computeLatenessDeduction(salary, '11:20', '13:00').amount, 0); // early for a 13:00 shift
    assert.match(computeLatenessDeduction(salary, '09:20', '09:00').label, /20 min after the 09:00 shift start · 0.25 × daily rate/);
  });

  it('counts leaving early against the person\'s own shift end', () => {
    const salary = 7200; // daily 240, hourly (÷8) 30
    assert.equal(computeEarlyLeaveDeduction(salary, '17:00').hours, 2); // 19:00 shift
    assert.equal(computeEarlyLeaveDeduction(salary, '17:00').amount, 60);
    assert.equal(computeEarlyLeaveDeduction(salary, '17:00', '17:00').amount, 0);
    assert.equal(computeEarlyLeaveDeduction(salary, '16:00', '17:00:00').hours, 1);
  });
});

describe('Hours per week', () => {
  it('needs both the pay basis and the hours', () => {
    assert.equal(isWeeklyHoursStaff({ pay_basis: 'weekly_hours', weekly_hours: 16 }), true);
    assert.equal(isWeeklyHoursStaff({ pay_basis: 'weekly_hours', weekly_hours: null }), false);
    assert.equal(isWeeklyHoursStaff({ pay_basis: 'shift', weekly_hours: 16 }), false);
  });

  it('hourly rate = daily rate ÷ 8, and each hour short costs 2 × hourly rate', () => {
    const salary = 9600; // daily 320, hourly 40
    assert.equal(dailyRate(salary), 320);
    assert.equal(weeklyHourlyRate(salary), 40);
    // The example: 14 h worked of 16 → 2 h short × 40 × 2 = 160.
    const d = computeWeeklyHoursDeduction(salary, 16, 14);
    assert.equal(d.short_hours, 2);
    assert.equal(d.amount, 160);
    assert.equal(computeWeeklyHoursDeduction(salary, 16, 16).amount, 0);
    assert.equal(computeWeeklyHoursDeduction(salary, 16, 20).amount, 0); // extra hours never go negative
    assert.equal(computeWeeklyHoursDeduction(salary, 16, 15.5).amount, 40); // half an hour short
  });

  it('weeks run Saturday to Friday', () => {
    assert.deepEqual(weekBounds('2026-11-26'), { from: '2026-11-21', to: '2026-11-27' }); // Thursday
    assert.deepEqual(weekBounds('2026-11-21'), { from: '2026-11-21', to: '2026-11-27' }); // Saturday
    assert.deepEqual(weekBounds('2026-11-27'), { from: '2026-11-21', to: '2026-11-27' }); // Friday
  });

  it('adds up clock-in sessions per day', () => {
    const events = [
      { work_date: '2026-11-22', kind: 'in', at: '2026-11-22T08:00:00Z' },
      { work_date: '2026-11-22', kind: 'out', at: '2026-11-22T10:30:00Z' },
      { work_date: '2026-11-22', kind: 'in', at: '2026-11-22T11:00:00Z' },
      { work_date: '2026-11-22', kind: 'out', at: '2026-11-22T13:00:00Z' },
      { work_date: '2026-11-23', kind: 'in', at: '2026-11-23T09:00:00Z' },
    ];
    assert.equal(clockedMinutes(events), 270); // the open session doesn't count yet
    assert.equal(clockedMinutes(events, new Date('2026-11-23T10:00:00Z')), 330);
  });

  it('lowers the target for approved leave, WFH, timed excuses and the first partial week', () => {
    const base = { weeklyHours: 20, daysOff: ['fri', 'sat'], from: '2026-11-21', to: '2026-11-27' }; // 5 working days, 4 h each
    assert.equal(requiredHoursForWeek(base).required_hours, 20);
    assert.equal(requiredHoursForWeek({ ...base, awayDates: new Set(['2026-11-23']) }).required_hours, 16);
    // A day off isn't a working day, so leave on it changes nothing.
    assert.equal(requiredHoursForWeek({ ...base, awayDates: new Set(['2026-11-27']) }).required_hours, 20);
    assert.equal(requiredHoursForWeek({ ...base, creditedHours: 2 }).required_hours, 18);
    // Put on hours per week on Tuesday 24 Nov: Sun and Mon don't count.
    assert.equal(requiredHoursForWeek({ ...base, since: '2026-11-24' }).required_hours, 12);
  });
});

/** A tiny in-memory stand-in for the queries weeklyHours runs. */
function fakeDb({ staff, events = [], leaves = [], wfh = [], paid = [] }) {
  const deductions = [];
  let nextId = 1;
  const query = async (sql, params = []) => {
    if (/FROM staff_users/.test(sql)) return { rows: staff };
    if (/FROM staff_clock_events/.test(sql)) {
      return { rows: events.filter((e) => e.staff_user_id === params[0] && e.work_date >= params[1] && e.work_date <= params[2]) };
    }
    if (/FROM staff_leave_requests/.test(sql)) return { rows: leaves.filter((l) => l.staff_user_id === params[0]) };
    if (/FROM staff_wfh_requests/.test(sql)) return { rows: wfh.filter((w) => w.staff_user_id === params[0]) };
    if (/FROM staff_payroll_entries/.test(sql)) {
      return { rows: paid.some((p) => p.staff_user_id === params[0] && p.year === params[1] && p.month === params[2]) ? [{}] : [] };
    }
    if (/^\s*SELECT id, amount/.test(sql)) {
      return { rows: deductions.filter((d) => d.staff_user_id === params[0] && d.deduction_date === params[1]) };
    }
    if (/^\s*INSERT INTO staff_salary_deductions/.test(sql)) {
      deductions.push({ id: nextId++, staff_user_id: params[0], amount: params[1], reason: params[2], deduction_date: params[3], daily_rate: params[4] });
      return { rows: [] };
    }
    if (/^\s*UPDATE staff_salary_deductions/.test(sql)) {
      const d = deductions.find((x) => x.id === params[0]);
      d.amount = params[1];
      d.reason = params[2];
      return { rows: [] };
    }
    if (/^\s*DELETE FROM staff_salary_deductions/.test(sql)) {
      deductions.splice(deductions.findIndex((x) => x.id === params[0]), 1);
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  };
  return { query, deductions };
}

function session(staffId, day, fromUtc, toUtc) {
  return [
    { staff_user_id: staffId, work_date: day, kind: 'in', at: `${day}T${fromUtc}:00Z` },
    { staff_user_id: staffId, work_date: day, kind: 'out', at: `${day}T${toUtc}:00Z` },
  ];
}

describe('Settling the week', () => {
  const marketer = {
    id: 7, full_name: 'Web Dev', role: 'web_developer', base_salary: 9600, pay_basis: 'weekly_hours',
    weekly_hours: 16, weekly_hours_since: '2026-11-01', days_off: ['fri'], office_attendance_exempt: false,
  };
  // Week Sat 14 – Fri 20 Nov 2026; settled on Thursday 26 Nov (re-checks 14–20 and 7–13).
  const now = new Date('2026-11-26T10:00:00Z');

  it('deducts 2 h short × 40 × 2 = 160, dated the Friday that ends the week', async () => {
    const events = [...session(7, '2026-11-15', '08:00', '15:00'), ...session(7, '2026-11-17', '08:00', '15:00')]; // 14 h
    const db = fakeDb({ staff: [marketer], events });
    await settleWeeklyHours({ query: db.query, now });
    const week = db.deductions.filter((d) => d.deduction_date === '2026-11-20');
    assert.equal(week.length, 1);
    assert.equal(week[0].amount, 160);
    assert.equal(week[0].daily_rate, 320);
    assert.match(week[0].reason, /worked 14h of 16h · 2h short/);
    // The week before had no clock-ins at all: 16 h short = 1,280.
    assert.equal(db.deductions.find((d) => d.deduction_date === '2026-11-13').amount, 1280);
  });

  it('no deduction when the hours are covered, and a later approved leave removes one', async () => {
    const events = [...session(7, '2026-11-15', '08:00', '16:00'), ...session(7, '2026-11-17', '08:00', '16:00')]; // 16 h
    const db = fakeDb({ staff: [{ ...marketer, weekly_hours_since: '2026-11-14' }], events });
    await settleWeeklyHours({ query: db.query, now });
    assert.equal(db.deductions.length, 0);

    const short = fakeDb({ staff: [{ ...marketer, weekly_hours_since: '2026-11-14' }], events: session(7, '2026-11-15', '08:00', '16:00') });
    await settleWeeklyHours({ query: short.query, now });
    assert.equal(short.deductions.length, 1); // 8 h short
    // Approved annual leave on two working days (2 × 16/6 h) lowers the target to 10.67 h: 2.67 h short.
    const leaves = [{ staff_user_id: 7, leave_type: 'annual', start_date: '2026-11-17', end_date: '2026-11-18', start_time: null, end_time: null, hours: null }];
    const again = fakeDb({ staff: [{ ...marketer, weekly_hours_since: '2026-11-14' }], events: session(7, '2026-11-15', '08:00', '16:00'), leaves });
    const summary = await weekSummary(again.query, { ...marketer, weekly_hours_since: '2026-11-14' }, '2026-11-20', { now });
    assert.equal(summary.required_hours, 10.67);
    assert.equal(summary.short_hours, 2.67);
  });

  it('leaves a paid payroll month alone, and skips staff paid by shifts', async () => {
    // 13 and 20 Nov are both in the payroll cycle 26 Oct – 25 Nov (November).
    const db = fakeDb({ staff: [marketer], paid: [{ staff_user_id: 7, year: 2026, month: 11 }] });
    await settleWeeklyHours({ query: db.query, now });
    assert.equal(db.deductions.length, 0);
    const shiftStaff = fakeDb({ staff: [{ ...marketer, pay_basis: 'shift' }] });
    await settleWeeklyHours({ query: shiftStaff.query, now });
    assert.equal(shiftStaff.deductions.length, 0);
  });
});
