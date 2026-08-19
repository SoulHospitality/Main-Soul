const DAYS_IN_MONTH = 30;
const SHIFT_START_MINUTES = 11 * 60;
const GRACE_END_MINUTES = 11 * 60 + 15;
const LATE_QUARTER_END = 11 * 60 + 30;
const LATE_HALF_END = 12 * 60;
const ANNUAL_MIN_NOTICE_DAYS = 7;
const EARLY_LEAVE_MAX_PER_YEAR = 2;
const TIMEZONE = 'Africa/Cairo';

function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function dailyRate(baseSalary) {
  const salary = Number(baseSalary) || 0;
  return roundMoney(salary / DAYS_IN_MONTH);
}

function parseHhMm(value) {
  const text = String(value || '').trim();
  const m = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

/** @returns {{ factor: number, band: string, label: string } | { factor: 0, band: 'grace', label: string }} */
function latenessFactor(arrivalMinutes) {
  if (!Number.isFinite(arrivalMinutes)) {
    const err = new Error('Arrival time is required for lateness');
    err.status = 400;
    throw err;
  }
  if (arrivalMinutes <= GRACE_END_MINUTES) {
    return {
      factor: 0,
      band: 'grace',
      label: 'On time (11:00–11:15, no deduction)',
    };
  }
  if (arrivalMinutes <= LATE_QUARTER_END) {
    return {
      factor: 0.25,
      band: 'quarter',
      label: '11:16–11:30 · 0.25 × daily rate',
    };
  }
  if (arrivalMinutes <= LATE_HALF_END) {
    return {
      factor: 0.5,
      band: 'half',
      label: '11:31–12:00 · 0.5 × daily rate',
    };
  }
  return {
    factor: 1,
    band: 'full',
    label: 'After 12:00 PM · 1 × daily rate',
  };
}

function absenceFactor(notified) {
  return notified ? 1 : 2;
}

function computeLatenessDeduction(baseSalary, arrivalTime) {
  const minutes = typeof arrivalTime === 'number' ? arrivalTime : parseHhMm(arrivalTime);
  if (minutes == null) {
    const err = new Error('Arrival time must be HH:MM');
    err.status = 400;
    throw err;
  }
  const rate = dailyRate(baseSalary);
  const late = latenessFactor(minutes);
  return {
    ...late,
    daily_rate: rate,
    amount: roundMoney(rate * late.factor),
    arrival_minutes: minutes,
  };
}

function computeAbsenceDeduction(baseSalary, notified) {
  const rate = dailyRate(baseSalary);
  const factor = absenceFactor(!!notified);
  return {
    factor,
    daily_rate: rate,
    amount: roundMoney(rate * factor),
    notified: !!notified,
    label: notified
      ? 'Absence with notice · 1 × daily rate'
      : 'Absence without notice · 2 × daily rate',
  };
}

function cairoParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function assertCasualTiming(startDate, now = new Date()) {
  const cairo = cairoParts(now);
  if (startDate < cairo.date) {
    const err = new Error('Casual leave cannot be requested for a past date');
    err.status = 400;
    throw err;
  }
  if (startDate === cairo.date && cairo.minutes >= SHIFT_START_MINUTES) {
    const err = new Error('Casual leave must be requested before the 11:00 AM shift');
    err.status = 400;
    throw err;
  }
}

function assertAnnualNotice(startDate, now = new Date()) {
  const cairo = cairoParts(now);
  const minDate = addDaysIso(cairo.date, ANNUAL_MIN_NOTICE_DAYS);
  if (startDate < minDate) {
    const err = new Error(`Annual leave must be requested at least ${ANNUAL_MIN_NOTICE_DAYS} days in advance`);
    err.status = 400;
    throw err;
  }
}

function assertEarlyLeaveTiming(startDate, now = new Date()) {
  const cairo = cairoParts(now);
  if (startDate < cairo.date) {
    const err = new Error('Early leave cannot be requested for a past date');
    err.status = 400;
    throw err;
  }
}

module.exports = {
  DAYS_IN_MONTH,
  SHIFT_START_MINUTES,
  GRACE_END_MINUTES,
  LATE_QUARTER_END,
  LATE_HALF_END,
  ANNUAL_MIN_NOTICE_DAYS,
  EARLY_LEAVE_MAX_PER_YEAR,
  TIMEZONE,
  roundMoney,
  dailyRate,
  parseHhMm,
  latenessFactor,
  absenceFactor,
  computeLatenessDeduction,
  computeAbsenceDeduction,
  cairoParts,
  addDaysIso,
  assertCasualTiming,
  assertAnnualNotice,
  assertEarlyLeaveTiming,
};
