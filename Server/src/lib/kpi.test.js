const test = require('node:test');
const assert = require('node:assert/strict');
const { kpiProgress, metricsForRole, measuresForMetric, canManageKpi, checklistCompletion, blendKpiPercent } = require('./kpi');

test('progress is the actual result divided by the target', () => {
  assert.deepEqual(kpiProgress({ actual: 51, targetValue: 100 }), { actual: 51, percent: 51 });
  assert.deepEqual(kpiProgress({ actual: 4.5, targetValue: 5 }), { actual: 4.5, percent: 90 });
  assert.equal(kpiProgress({ actual: null, targetValue: 4 }).percent, 0);
});

test('every manager can set the three KPI types', () => {
  assert.equal(canManageKpi({ role: 'reservations_web' }), false);
  assert.equal(canManageKpi({ role: 'unit_acquisition_manager' }), true);
  assert.deepEqual(metricsForRole('admin'), ['reservations', 'unit_acquisitions', 'reviews', 'check_ins']);
  assert.deepEqual(metricsForRole('reservations_manager'), ['reservations', 'unit_acquisitions', 'reviews', 'check_ins']);
  assert.deepEqual(measuresForMetric('reservations'), ['count', 'value']);
  assert.deepEqual(measuresForMetric('reviews'), ['average']);
  assert.deepEqual(measuresForMetric('unit_acquisitions'), ['count']);
});

test('a daily checklist is the share of the KPI its creator assigned', () => {
  const completion = checklistCompletion({
    days: ['2026-10-01', '2026-10-02'],
    itemCount: 2,
    checkedByDay: { '2026-10-01': 2, '2026-10-02': 1 },
  });
  assert.equal(completion.percent, 75);
  assert.equal(blendKpiPercent({
    metricPercent: 80,
    parts: [{ weight: 30, percent: completion.percent }],
  }), 78.5);
  assert.equal(blendKpiPercent({ metricPercent: 51, parts: [] }), 51);
});

const { kpiPace, personScore, workingDays, statusCounts } = require('./kpi');

test('pace compares the result with a straight line to the target', () => {
  const pace = kpiPace({ metric: 'reservations', actual: 15, targetValue: 30, startsOn: '2026-11-01', deadline: '2026-11-30', today: '2026-11-15' });
  assert.equal(pace.elapsed_days, 15);
  assert.equal(pace.expected, 15);
  assert.equal(pace.status, 'on_track');
  assert.equal(pace.projected, 30);
  assert.equal(pace.needed_per_day, 1);
  assert.equal(kpiPace({ metric: 'reservations', actual: 13, targetValue: 30, startsOn: '2026-11-01', deadline: '2026-11-30', today: '2026-11-15' }).status, 'at_risk');
  assert.equal(kpiPace({ metric: 'reservations', actual: 5, targetValue: 30, startsOn: '2026-11-01', deadline: '2026-11-30', today: '2026-11-15' }).status, 'behind');
  assert.equal(kpiPace({ metric: 'reservations', actual: 0, targetValue: 30, startsOn: '2026-11-01', deadline: '2026-11-30', today: '2026-11-02' }).status, 'early');
  assert.equal(kpiPace({ metric: 'reservations', actual: 30, targetValue: 30, startsOn: '2026-11-01', deadline: '2026-11-30', today: '2026-11-20' }).status, 'achieved');
  assert.equal(kpiPace({ metric: 'reservations', actual: 29, targetValue: 30, startsOn: '2026-11-01', deadline: '2026-11-30', today: '2026-12-02' }).status, 'missed');
  assert.equal(kpiPace({ metric: 'reservations', actual: 0, targetValue: 30, startsOn: '2026-12-01', deadline: '2026-12-30', today: '2026-11-20' }).status, 'not_started');
});

test('review KPIs need enough reviews before they are judged', () => {
  const base = { metric: 'reviews', targetValue: 4.5, startsOn: '2026-11-01', deadline: '2026-11-30', today: '2026-11-15' };
  assert.equal(kpiPace({ ...base, actual: 3, reviewCount: 2 }).status, 'early');
  assert.equal(kpiPace({ ...base, actual: 4.6, reviewCount: 4 }).status, 'on_track');
  assert.equal(kpiPace({ ...base, actual: 4.3, reviewCount: 4 }).status, 'at_risk');
  assert.equal(kpiPace({ ...base, actual: 3.9, reviewCount: 4 }).status, 'behind');
  assert.equal(kpiPace({ ...base, today: '2026-12-01', actual: null, reviewCount: 0 }).status, 'missed');
});

test('a person score weights KPIs by importance and caps each at 100%', () => {
  const kpis = [
    { status: 'on_track', percent: 150, weight: 1 },
    { status: 'behind', percent: 40, weight: 3 },
    { status: 'not_started', percent: 0, weight: 5 },
  ];
  assert.deepEqual(personScore(kpis), { score: 55, counted: 2 });
  assert.deepEqual(personScore([]), { score: null, counted: 0 });
  assert.deepEqual(statusCounts(kpis), { on_track: 1, behind: 1, not_started: 1 });
});

test('checklists only expect working days', () => {
  // 2026-11-06 is a Friday.
  const days = ['2026-11-05', '2026-11-06', '2026-11-07'];
  assert.deepEqual(workingDays(days, { daysOff: ['fri'], leaveDates: new Set(['2026-11-07']) }), ['2026-11-05']);
});

const { dailyTarget } = require('./kpi');

test('the daily target spreads what is left over the days left, including today', () => {
  const base = { metric: 'reservations', targetValue: 30000, startsOn: '2026-11-01', deadline: '2026-11-30' };
  const day1 = dailyTarget({ ...base, actual: 500, todayValue: 500, today: '2026-11-01' });
  assert.equal(day1.amount, 1000);
  assert.equal(day1.done_today, 500);
  assert.equal(day1.percent, 50);
  assert.equal(day1.met, false);
  const day2 = dailyTarget({ ...base, actual: 500, todayValue: 0, today: '2026-11-02' });
  assert.equal(day2.amount, Math.round((29500 / 29) * 100) / 100);
  assert.equal(day2.days_left, 29);
  const lastDay = dailyTarget({ ...base, actual: 29000, todayValue: 0, today: '2026-11-30' });
  assert.equal(lastDay.amount, 1000);
  assert.equal(dailyTarget({ ...base, actual: 31000, todayValue: 0, today: '2026-11-10' }).amount, 0);
  assert.equal(dailyTarget({ ...base, metric: 'reviews', actual: 4, today: '2026-11-10' }), null);
  assert.equal(dailyTarget({ ...base, actual: 0, today: '2026-12-01' }), null);
});
