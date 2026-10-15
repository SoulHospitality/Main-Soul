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
  assert.deepEqual(metricsForRole('admin'), ['reservations', 'unit_acquisitions', 'reviews']);
  assert.deepEqual(metricsForRole('reservations_manager'), ['reservations', 'unit_acquisitions', 'reviews']);
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
