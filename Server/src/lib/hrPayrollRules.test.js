const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeRule, evaluateRule, evaluatePeriod, monthsOfService } = require('./hrPayrollRules');

const period = { from: '2026-10-26', through: '2026-11-25' };
const staff = { id: 1, full_name: 'Sara', role: 'reservations', base_salary: 9000, days_off: ['fri'], start_date: '2025-01-10' };
const day = (work_date, status, check_in = null, check_out = null, notified = null) => ({ work_date, status, check_in, check_out, notified });

function rule(overrides) {
  return { id: 7, active: true, roles: [], staff_ids: [], free_count: 0, cap_amount: null, ...sanitizeRule({ name: 'Test', effect: 'deduction', amount_type: 'fixed', amount: 100, ...overrides }), id: 7 };
}

test('late arrivals after a time are counted per day, with free occurrences', () => {
  const r = rule({ trigger: 'late_arrival', params: { after: '11:30' }, free_count: 1 });
  const attendance = [day('2026-11-01', 'late', '11:45'), day('2026-11-02', 'late', '11:20'), day('2026-11-03', 'late', '12:10'), day('2026-11-04', 'late', '12:30')];
  const hit = evaluateRule(r, { staff, period, attendance, leaves: [] });
  assert.equal(hit.quantity, 2);
  assert.equal(hit.amount, 200);
  assert.match(hit.reason, /2 times \(first 1 free\)/);
});

test('daily-rate amounts use the 30-day daily rate and respect the cap', () => {
  const r = rule({ trigger: 'no_show', params: { notified: 'no' }, amount_type: 'daily_rate', amount: 1, cap_amount: 500 });
  const attendance = [day('2026-11-05', 'no_show', null, null, false), day('2026-11-06', 'no_show', null, null, true)];
  const hit = evaluateRule(r, { staff, period, attendance, leaves: [] });
  assert.equal(hit.quantity, 1);
  assert.equal(hit.amount, 300);
  const two = evaluateRule({ ...r, params: { notified: 'any' } }, { staff, period, attendance, leaves: [] });
  assert.equal(two.amount, 500);
  assert.match(two.reason, /capped/);
});

test('perfect attendance pays a bonus only with no late or missed days', () => {
  const r = rule({ trigger: 'perfect_attendance', effect: 'bonus', amount_type: 'percent_base', amount: 5 });
  assert.equal(evaluateRule(r, { staff, period, attendance: [day('2026-11-01', 'on_time', '10:55')], leaves: [] }).amount, 450);
  assert.equal(evaluateRule(r, { staff, period, attendance: [day('2026-11-01', 'late', '11:40')], leaves: [] }), null);
  assert.equal(evaluateRule(r, { staff, period, attendance: [], leaves: [] }), null);
});

test('overtime counts quarter hours after the set time', () => {
  const r = rule({ trigger: 'overtime', effect: 'bonus', amount_type: 'hourly_rate', amount: 1.5, params: { after: '19:00' } });
  const attendance = [day('2026-11-01', 'on_time', '11:00', '20:30'), day('2026-11-02', 'on_time', '11:00', '19:20')];
  const hit = evaluateRule(r, { staff, period, attendance, leaves: [] });
  assert.equal(hit.quantity, 1.75);
});

test('worked days off and early check-outs are detected', () => {
  const dayOff = rule({ trigger: 'worked_day_off', effect: 'bonus', amount: 250 });
  // 2026-11-06 is a Friday.
  assert.equal(evaluateRule(dayOff, { staff, period, attendance: [day('2026-11-06', 'on_time', '11:00')], leaves: [] }).quantity, 1);
  const early = rule({ trigger: 'early_checkout', params: { before: '18:00' } });
  assert.equal(evaluateRule(early, { staff, period, attendance: [day('2026-11-02', 'on_time', '11:00', '17:15')], leaves: [] }).quantity, 1);
});

test('count rules fire once when the threshold is reached', () => {
  const r = rule({ trigger: 'late_count', params: { min_count: 3 }, amount: 400 });
  const lates = [day('2026-11-01', 'late', '11:40'), day('2026-11-02', 'late', '11:50')];
  assert.equal(evaluateRule(r, { staff, period, attendance: lates, leaves: [] }), null);
  const hit = evaluateRule(r, { staff, period, attendance: [...lates, day('2026-11-03', 'late', '12:30')], leaves: [] });
  assert.equal(hit.amount, 400);
});

test('leave days and excuse hours only count approved leave inside the cycle', () => {
  const sick = rule({ trigger: 'leave_days', params: { leave_type: 'sick' }, amount: 50 });
  const leaves = [
    { leave_type: 'sick', status: 'approved', start_date: '2026-10-24', end_date: '2026-10-27' },
    { leave_type: 'sick', status: 'pending', start_date: '2026-11-10', end_date: '2026-11-10' },
  ];
  assert.equal(evaluateRule(sick, { staff, period, attendance: [], leaves }).quantity, 2);
  const excuse = rule({ trigger: 'excuse_hours', params: { leave_type: 'unpaid_excuse' }, amount_type: 'hourly_rate', amount: 1 });
  const hit = evaluateRule(excuse, {
    staff,
    period,
    attendance: [],
    leaves: [{ leave_type: 'unpaid_excuse', status: 'approved', start_date: '2026-11-03', end_date: '2026-11-03', start_time: '14:00', end_time: '16:30' }],
  });
  assert.equal(hit.quantity, 2.5);
});

test('fixed and tenure rules apply every cycle to the right people', () => {
  const allowance = rule({ trigger: 'monthly_fixed', effect: 'bonus', amount: 600, roles: ['operations'] });
  assert.equal(evaluateRule(allowance, { staff, period, attendance: [], leaves: [] }), null);
  assert.equal(evaluateRule(allowance, { staff: { ...staff, role: 'operations' }, period, attendance: [], leaves: [] }).amount, 600);
  const named = rule({ trigger: 'monthly_fixed', staff_ids: [1], roles: ['operations'] });
  assert.ok(evaluateRule(named, { staff, period, attendance: [], leaves: [] }), 'named people win over roles');
  const seniority = rule({ trigger: 'tenure', effect: 'bonus', params: { min_months: 12 }, amount: 1000 });
  assert.equal(evaluateRule(seniority, { staff, period, attendance: [], leaves: [] }).amount, 1000);
  assert.equal(monthsOfService('2026-01-10', '2026-11-25'), 10);
});

test('inactive rules and rules outside their dates do nothing', () => {
  const r = rule({ trigger: 'monthly_fixed', amount: 100 });
  assert.equal(evaluateRule({ ...r, active: false }, { staff, period, attendance: [], leaves: [] }), null);
  assert.equal(evaluateRule({ ...r, effective_from: '2026-12-01' }, { staff, period, attendance: [], leaves: [] }), null);
  assert.equal(evaluateRule({ ...r, effective_to: '2026-10-01' }, { staff, period, attendance: [], leaves: [] }), null);
});

test('sanitizeRule rejects incomplete rules', () => {
  assert.throws(() => sanitizeRule({ name: 'x' }), /name/);
  assert.throws(() => sanitizeRule({ name: 'Late', effect: 'deduction', trigger: 'late_arrival', amount_type: 'fixed', amount: 10 }), /HH:MM/);
  assert.throws(() => sanitizeRule({ name: 'Big', effect: 'deduction', trigger: 'monthly_fixed', amount_type: 'percent_base', amount: 150 }), /at most 100/);
});

test('evaluatePeriod returns one result per rule per person', () => {
  const rules = [rule({ trigger: 'monthly_fixed', amount: 100 }), { ...rule({ trigger: 'monthly_fixed', effect: 'bonus', amount: 50 }), id: 8 }];
  const data = { attendanceByStaff: new Map(), leavesByStaff: new Map() };
  const results = evaluatePeriod(rules, [staff, { ...staff, id: 2, full_name: 'Omar' }], data, period);
  assert.equal(results.length, 4);
});
