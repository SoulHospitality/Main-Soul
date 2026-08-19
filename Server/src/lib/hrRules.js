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

const HOLIDAY_ACCESS_MONTHS = 6;

function monthsBetween(fromDate, toDate) {
  const from = fromDate instanceof Date ? fromDate : new Date(fromDate);
  const to = toDate instanceof Date ? toDate : new Date(toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  const years = to.getFullYear() - from.getFullYear();
  const months = to.getMonth() - from.getMonth();
  let total = years * 12 + months;
  if (to.getDate() < from.getDate()) total -= 1;
  return total;
}

function canRequestHolidays({ holiday_access, created_at }, now = new Date()) {
  const mode = String(holiday_access || 'auto').toLowerCase();
  if (mode === 'granted') return true;
  if (mode === 'denied') return false;
  return monthsBetween(created_at, now) >= HOLIDAY_ACCESS_MONTHS;
}

function nextPayrollPeriod(isoDate) {
  const [y, m] = String(isoDate).slice(0, 10).split('-').map(Number);
  if (m === 12) return { year: y + 1, month: 1, deductionDate: `${y + 1}-01-01` };
  return {
    year: y,
    month: m + 1,
    deductionDate: `${y}-${String(m + 1).padStart(2, '0')}-01`,
  };
}

function dateCoveredByRanges(isoDate, ranges = []) {
  return ranges.some((r) => r.start_date <= isoDate && isoDate <= r.end_date);
}

function excelSerialToIso(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;
  const utc = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  const d = new Date(utc);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function excelTimeToHhMm(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  }
  if (typeof value === 'number' && value >= 0 && value < 1.5) {
    const mins = Math.round((value % 1) * 24 * 60);
    const hh = Math.floor(mins / 60) % 24;
    const mm = mins % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  const parsed = parseHhMm(value);
  if (parsed == null) return null;
  const hh = Math.floor(parsed / 60);
  const mm = parsed % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
}

function truthyNotice(value) {
  const t = String(value || '').trim().toLowerCase();
  return ['1', 'yes', 'y', 'true', 'notified', 'with notice', 'with_notice'].includes(t);
}

function parseAttendanceRows(rows) {
  return (rows || []).map((row, index) => {
    const keys = Object.keys(row || {});
    const pick = (...aliases) => {
      for (const alias of aliases) {
        const key = keys.find((k) => normalizeHeader(k) === alias);
        if (key != null && row[key] != null && String(row[key]).trim() !== '') return row[key];
      }
      return null;
    };
    let dateVal = pick('date', 'day', 'attendance_date');
    if (dateVal instanceof Date) {
      dateVal = `${dateVal.getFullYear()}-${String(dateVal.getMonth() + 1).padStart(2, '0')}-${String(dateVal.getDate()).padStart(2, '0')}`;
    } else if (typeof dateVal === 'number') {
      dateVal = excelSerialToIso(dateVal);
    } else if (dateVal) {
      const s = String(dateVal).trim();
      const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
      dateVal = m ? m[1] : null;
    }
    const status = String(pick('status', 'type', 'attendance') || '').toLowerCase();
    const arrivalRaw = pick('arrival_time', 'arrival', 'check_in', 'checkin', 'time', 'clock_in');
    const arrival_time = arrivalRaw != null ? excelTimeToHhMm(arrivalRaw) : null;
    const absent = !arrival_time || /absent|absence|no.show/.test(status);
    const staffCode = pick('staff_code', 'staff_id', 'code', 'id');
    const name = pick('name', 'full_name', 'staff', 'employee');
    return {
      row: index + 2,
      staff_code: staffCode ? String(staffCode).trim() : '',
      name: name ? String(name).trim() : '',
      date: dateVal,
      arrival_time: absent ? null : arrival_time,
      notified: truthyNotice(pick('notified', 'notice', 'with_notice')),
      absent,
    };
  });
}

function computeHalfDayDeduction(baseSalary) {
  const rate = dailyRate(baseSalary);
  return {
    daily_rate: rate,
    days_factor: 0.5,
    amount: roundMoney(rate * 0.5),
    label: 'Work from home · 0.5 × daily rate',
  };
}

const PENALTY_CATEGORIES = ['lateness', 'absence', 'delay', 'performance', 'penalty'];
const NO_OFFICE_ATTENDANCE_ROLES = new Set(['operations', 'operations_supervisor']);

function hasOfficeAttendance(role) {
  return !NO_OFFICE_ATTENDANCE_ROLES.has(String(role || ''));
}

function isPenaltyCategory(category) {
  return PENALTY_CATEGORIES.includes(String(category || '').toLowerCase());
}

function splitSalaryAdjustments(deductionRows = []) {
  const penalties = [];
  const deductions = [];
  for (const row of deductionRows) {
    if (isPenaltyCategory(row.category)) penalties.push(row);
    else deductions.push(row);
  }
  const sum = (rows) => roundMoney(rows.reduce((acc, r) => acc + (Number(r.amount) || 0), 0));
  return {
    penalties,
    deductions,
    penalties_total: sum(penalties),
    deductions_total: sum(deductions),
  };
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
  HOLIDAY_ACCESS_MONTHS,
  monthsBetween,
  canRequestHolidays,
  nextPayrollPeriod,
  dateCoveredByRanges,
  parseAttendanceRows,
  excelTimeToHhMm,
  computeHalfDayDeduction,
  PENALTY_CATEGORIES,
  NO_OFFICE_ATTENDANCE_ROLES,
  hasOfficeAttendance,
  isPenaltyCategory,
  splitSalaryAdjustments,
};
