const test = require('node:test');
const assert = require('node:assert/strict');
const { kpiBonus, metricsForRole, canManageKpi } = require('./kpi');

test('a partial target pays the same share of the reward', () => {
  const result = kpiBonus({ count: 51, targetValue: 100, rewardAmount: 1000, minPercent: 50 });
  assert.equal(result.percent, 51);
  assert.equal(result.bonus, 510);
  assert.equal(result.eligible, true);
});

test('work below the minimum pays nothing', () => {
  const result = kpiBonus({ count: 49, targetValue: 100, rewardAmount: 1000, minPercent: 50 });
  assert.equal(result.bonus, 0);
  assert.equal(result.eligible, false);
});

test('passing the target pays the full reward and no more', () => {
  const result = kpiBonus({ count: 140, targetValue: 100, rewardAmount: 1000, minPercent: 0 });
  assert.equal(result.bonus, 1000);
});

test('only the CEO and managers can add targets', () => {
  assert.equal(canManageKpi({ role: 'admin' }), true);
  assert.equal(canManageKpi({ role: 'reservations_manager' }), true);
  assert.equal(canManageKpi({ role: 'operations_supervisor' }), true);
  assert.equal(canManageKpi({ role: 'reservations_web' }), false);
  assert.deepEqual(metricsForRole('reservations_manager'), ['reservations']);
  assert.deepEqual(metricsForRole('operations_supervisor'), ['reservations', 'check_ins', 'check_outs']);
});
