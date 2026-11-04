const METRIC_LABELS = {
  reservations: 'Reservations',
  unit_acquisitions: 'Unit acquisitions',
  reviews: 'Check-in reviews',
  check_ins: 'Check-ins handled',
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

const METRICS = ['reservations', 'unit_acquisitions', 'reviews', 'check_ins'];

/** Results above target still show, but each KPI counts at most 100% towards a person's score. */
const SCORE_CAP = 100;
/** Below this many reviews an average is too thin to judge. */
const MIN_REVIEWS_FOR_STATUS = 3;

const STATUS_LABELS = {
  not_started: 'Not started',
  early: 'Too early to tell',
  on_track: 'On track',
  at_risk: 'At risk',
  behind: 'Behind',
  achieved: 'Achieved',
  missed: 'Missed',
};

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
  if (metric === 'unit_acquisitions' || metric === 'check_ins') return ['count'];
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

function checklistCompletion({ days, itemCount, checkedByDay }) {
  const total = Number(itemCount) || 0;
  if (!days?.length || total < 1) return { percent: 0, days: [] };
  const daily = days.map((date) => {
    const checked = Math.max(0, Math.min(total, Number(checkedByDay?.[date]) || 0));
    return {
      date,
      checked,
      total,
      percent: Math.round((checked / total) * 1000) / 10,
    };
  });
  const average = daily.reduce((sum, day) => sum + day.percent, 0) / daily.length;
  return { percent: Math.round(average * 10) / 10, days: daily };
}

function blendKpiPercent({ metricPercent, parts }) {
  const list = Array.isArray(parts) ? parts : [];
  const requested = list.reduce((sum, part) => sum + Math.max(0, Number(part.weight) || 0), 0);
  const used = Math.min(100, requested);
  let score = (Number(metricPercent) || 0) * ((100 - used) / 100);
  let consumed = 0;
  for (const part of list) {
    const room = Math.max(0, used - consumed);
    const applied = Math.min(room, Math.max(0, Number(part.weight) || 0));
    consumed += applied;
    score += (Number(part.percent) || 0) * (applied / 100);
  }
  return Math.round(score * 10) / 10;
}

function dayCount(from, to) {
  const a = Date.parse(`${String(from).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(to).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/**
 * Where a KPI stands today: what was expected by now (straight-line pace for running totals),
 * where the current pace lands at the deadline, and a status.
 */
function kpiPace({ metric, actual, targetValue, startsOn, deadline, today, reviewCount = 0 }) {
  const target = Number(targetValue) || 0;
  const done = Number(actual) || 0;
  const totalDays = dayCount(startsOn, deadline);
  const finished = today > deadline;
  if (today < startsOn) {
    return { status: 'not_started', total_days: totalDays, elapsed_days: 0, days_left: totalDays, expected: 0, projected: null };
  }
  const elapsed = finished ? totalDays : dayCount(startsOn, today);
  const daysLeft = finished ? 0 : Math.max(0, totalDays - elapsed);
  const base = { total_days: totalDays, elapsed_days: elapsed, days_left: daysLeft };

  if (metric === 'reviews') {
    const enough = Number(reviewCount) >= MIN_REVIEWS_FOR_STATUS;
    let status;
    if (finished) status = actual != null && done >= target ? 'achieved' : 'missed';
    else if (!enough) status = 'early';
    else if (done >= target) status = 'on_track';
    else if (done >= target - 0.3) status = 'at_risk';
    else status = 'behind';
    return { ...base, status, expected: target, projected: actual == null ? null : done, min_reviews: MIN_REVIEWS_FOR_STATUS };
  }

  const expected = totalDays ? (target * elapsed) / totalDays : target;
  const projected = elapsed ? Math.round(((done / elapsed) * totalDays) * 100) / 100 : 0;
  const ratio = expected > 0 ? done / expected : 0;
  let status;
  if (done >= target) status = 'achieved';
  else if (finished) status = 'missed';
  else if (elapsed <= Math.max(1, Math.floor(totalDays * 0.1)) && ratio < 1) status = 'early';
  else if (ratio >= 1) status = 'on_track';
  else if (ratio >= 0.8) status = 'at_risk';
  else status = 'behind';
  return {
    ...base,
    status,
    expected: Math.round(expected * 100) / 100,
    expected_percent: target ? Math.round((expected / target) * 1000) / 10 : 0,
    projected,
    projected_percent: target ? Math.round((projected / target) * 1000) / 10 : 0,
    needed_per_day: daysLeft ? Math.round((Math.max(0, target - done) / daysLeft) * 100) / 100 : null,
  };
}

/** A person's score: importance-weighted average of their started KPIs, each capped at 100%. */
function personScore(kpis) {
  const counted = (kpis || []).filter((k) => k.status !== 'not_started');
  const weightSum = counted.reduce((sum, k) => sum + (Number(k.weight) || 1), 0);
  if (!weightSum) return { score: null, counted: 0 };
  const total = counted.reduce(
    (sum, k) => sum + Math.min(SCORE_CAP, Math.max(0, Number(k.percent) || 0)) * (Number(k.weight) || 1),
    0
  );
  return { score: Math.round((total / weightSum) * 10) / 10, counted: counted.length };
}

function statusCounts(kpis) {
  const counts = {};
  for (const k of kpis || []) counts[k.status] = (counts[k.status] || 0) + 1;
  return counts;
}

/** Days a checklist is expected: every day in range except scheduled days off and approved leave. */
function workingDays(days, { daysOff = [], leaveDates = new Set() } = {}) {
  const { isScheduledDayOff } = require('./hrRules');
  return (days || []).filter((iso) => !leaveDates.has(iso) && !isScheduledDayOff(daysOff, iso));
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
  STATUS_LABELS,
  SCORE_CAP,
  kpiPace,
  personScore,
  statusCounts,
  workingDays,
  dayCount,
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
  checklistCompletion,
  blendKpiPercent,
  eachDate,
};
