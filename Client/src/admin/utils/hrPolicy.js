export const DAYS_IN_MONTH = 30;
export const ANNUAL_MIN_NOTICE_DAYS = 7;
export const EARLY_LEAVE_MAX_PER_YEAR = 2;

export function dailyRate(baseSalary) {
  return Math.round(((Number(baseSalary) || 0) / DAYS_IN_MONTH + Number.EPSILON) * 100) / 100;
}

export const LEAVE_TYPE_LABELS = {
  casual: 'Casual',
  annual: 'Annual',
  early_leave: 'Early leave',
  sick: 'Sick leave',
  holiday: 'Holiday',
  day_off: 'Day off',
  unpaid: 'Unpaid',
};

export function requestableLeaveTypes(canRequestHolidays) {
  const unpaid = { value: 'unpaid', label: 'Unpaid' };
  if (canRequestHolidays) {
    return [
      { value: 'casual', label: 'Casual' },
      { value: 'annual', label: 'Annual' },
      { value: 'early_leave', label: 'Early leave' },
      unpaid,
    ];
  }
  return [unpaid];
}

export function computeAttendanceAmount(baseSalary, { status, check_in, notified } = {}) {
  const rate = dailyRate(baseSalary);
  const st = String(status || '').toLowerCase();
  if (st === 'on_time') return 0;
  if (st === 'no_show') return Math.round((rate * (notified ? 1 : 2) + Number.EPSILON) * 100) / 100;
  if (st !== 'late') return 0;
  const text = String(check_in || '').trim();
  const m = text.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  let factor = 1;
  if (minutes <= 11 * 60 + 15) factor = 0;
  else if (minutes <= 11 * 60 + 30) factor = 0.25;
  else if (minutes <= 12 * 60) factor = 0.5;
  return Math.round((rate * factor + Number.EPSILON) * 100) / 100;
}

export const DEDUCTION_TYPE_LABELS = {
  lateness: 'Lateness',
  delay: 'Lateness',
  absence: 'Absence',
  performance: 'Performance',
  advance: 'Advance',
  other: 'Other',
  penalty: 'Penalty',
  bonus: 'Bonus',
  loan: 'Loan',
  wfh: 'Work from home',
};
