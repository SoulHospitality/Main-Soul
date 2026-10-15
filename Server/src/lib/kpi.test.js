const test = require('node:test');
const assert = require('node:assert/strict');
const { kpiProgress, metricsForRole, measuresForMetric, canManageKpi } = require('./kpi');

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
