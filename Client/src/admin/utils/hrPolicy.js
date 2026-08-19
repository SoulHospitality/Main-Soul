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
};

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
