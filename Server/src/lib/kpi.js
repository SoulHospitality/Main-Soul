const METRIC_LABELS = {
  reservations: 'Reservations',
  unit_acquisitions: 'Unit acquisitions',
  reviews: 'Check-in reviews',
};

const MEASURE_LABELS = {
  count: 'Number',
  value: 'Total value',
  average: 'Average rating',
};

const LINE_MANAGER_ROLES = new Set([
  'admin',
  'hr_supervisor',
  'reservations_manager',
  'resale_manager',
  'unit_acquisition_manager',
  'operations_supervisor',
  'finance_manager',
]);

const METRICS = ['reservations', 'unit_acquisitions', 'reviews'];

const RESERVATION_TEAM_ROLES = ['reservations', 'reservations_web', 'reservations_manual'];
const OPERATIONS_TEAM_ROLES = ['operations'];
const ACQUISITION_TEAM_ROLES = ['unit_acquisition_agent'];

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function canManageKpi(user) {
  return Boolean(user && LINE_MANAGER_ROLES.has(user.role));
}

function metricsForRole(role) {
  if (!LINE_MANAGER_ROLES.has(role)) return [];
  return METRICS.slice();
}

function measuresForMetric(metric) {
  if (metric === 'reservations') return ['count', 'value'];
  if (metric === 'reviews') return ['average'];
  if (metric === 'unit_acquisitions') return ['count'];
  return [];
}

function teamKeysForRole(role) {
  if (role === 'admin') return ['all', 'reservations', 'operations', 'acquisition'];
  return ['mine'];
}

function kpiProgress({ actual, targetValue }) {
  const target = Number(targetValue);
  const done = actual == null || actual === '' ? null : Number(actual);
  if (!(target > 0) || done == null || Number.isNaN(done)) {
    return { percent: 0, actual: done };
  }
  return {
    actual: done,
    percent: Math.round((done / target) * 1000) / 10,
  };
}

function eachDate(from, to) {
  const days = [];
  const cursor = new Date(`${String(from).slice(0, 10)}T00:00:00Z`);
  const end = new Date(`${String(to).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || cursor > end) return days;
  while (cursor <= end && days.length < 120) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

module.exports = {
  METRICS,
  METRIC_LABELS,
  MEASURE_LABELS,
  RESERVATION_TEAM_ROLES,
  OPERATIONS_TEAM_ROLES,
  ACQUISITION_TEAM_ROLES,
  roundMoney,
  canManageKpi,
  metricsForRole,
  measuresForMetric,
  teamKeysForRole,
  kpiProgress,
  eachDate,
};
