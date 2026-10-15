const METRICS = ['reservations', 'check_ins', 'check_outs'];

const METRIC_LABELS = {
  reservations: 'Reservations',
  check_ins: 'Check-ins',
  check_outs: 'Check-outs',
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

const RESERVATION_TEAM_ROLES = ['reservations', 'reservations_web', 'reservations_manual'];
const OPERATIONS_TEAM_ROLES = ['operations'];

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function canManageKpi(user) {
  return Boolean(user && LINE_MANAGER_ROLES.has(user.role));
}

function metricsForRole(role) {
  if (role === 'admin' || role === 'operations_supervisor') {
    return ['reservations', 'check_ins', 'check_outs'];
  }
  if (role === 'reservations_manager') return ['reservations'];
  if (LINE_MANAGER_ROLES.has(role)) return ['reservations', 'check_ins', 'check_outs'];
  return [];
}

function teamKeysForRole(role) {
  if (role === 'admin') return ['reservations', 'operations', 'all'];
  return ['mine'];
}

function kpiBonus({ count, targetValue, rewardAmount, minPercent }) {
  const target = Number(targetValue);
  const reward = Number(rewardAmount);
  const minimum = Number(minPercent) || 0;
  const done = Math.max(0, Number(count) || 0);
  if (!(target > 0) || !(reward > 0)) {
    return { percent: 0, bonus: 0, eligible: false };
  }
  const ratio = done / target;
  const percent = Math.round(ratio * 1000) / 10;
  if (percent + 1e-9 < minimum) {
    return { percent, bonus: 0, eligible: false };
  }
  const payable = Math.min(ratio, 1);
  const bonus = roundMoney(reward * payable);
  return { percent, bonus, eligible: bonus > 0 };
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
  RESERVATION_TEAM_ROLES,
  OPERATIONS_TEAM_ROLES,
  roundMoney,
  canManageKpi,
  metricsForRole,
  teamKeysForRole,
  kpiBonus,
  eachDate,
};
