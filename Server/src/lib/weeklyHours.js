/**
 * Staff paid by hours per week (staff_users.pay_basis = 'weekly_hours').
 *
 * - The week runs Saturday to Friday (Cairo dates).
 * - Hours worked are the phone clock-in sessions (clock in → clock out) on the days of that week.
 * - The required hours are the weekly hours, less one day's share (weekly hours ÷ working days a week)
 *   for each working day covered by approved full-day leave or approved work from home, and less the
 *   hours of approved timed excuses and missions. Weeks before weekly_hours_since don't count, and the
 *   first week is reduced the same way for the days before it.
 * - Covering the required hours costs nothing. Each hour short costs hourly rate × 2, where hourly
 *   rate = daily rate ÷ 8 (daily rate = salary ÷ 30). The deduction is one row per week, dated the
 *   Friday that ends the week, so it falls in that day's payroll month.
 * - Settled once a week has ended, and re-checked for the last two ended weeks, so leave approved
 *   afterwards updates or removes the deduction. Weeks in a payroll month already paid are left alone.
 */
const {
  addDaysIso,
  enumerateDateRange,
  cairoParts,
  normalizeDaysOff,
  isScheduledDayOff,
  hasOfficeAttendance,
  payrollCycleForDate,
  roundMoney,
  computeWeeklyHoursDeduction,
  isWeeklyHoursStaff,
  excuseHoursFromTimes,
} = require('./hrRules');

const WEEK_START_DAY = 6; // Saturday (Date#getUTCDay)
const RECHECK_WEEKS = 2;
const TIMED_LEAVE_TYPES = ['paid_excuse', 'unpaid_excuse', 'early_leave', 'mission'];

function isoWeekday(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The Saturday–Friday week that contains a date. */
function weekBounds(isoDate) {
  const back = (isoWeekday(isoDate) - WEEK_START_DAY + 7) % 7;
  const from = addDaysIso(String(isoDate).slice(0, 10), -back);
  return { from, to: addDaysIso(from, 6) };
}

/**
 * Minutes inside clock-in sessions: each 'in' paired with the next 'out' on the same work day.
 * An open session counts up to `openUntil` (a Date) when given, otherwise not at all.
 */
function clockedMinutes(events, openUntil = null) {
  const byDay = new Map();
  for (const e of events || []) {
    const day = String(e.work_date).slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(e);
  }
  let total = 0;
  for (const list of byDay.values()) {
    list.sort((a, b) => new Date(a.at) - new Date(b.at));
    let openAt = null;
    for (const e of list) {
      if (e.kind === 'in') {
        if (openAt == null) openAt = new Date(e.at);
      } else if (openAt != null) {
        total += Math.max(0, (new Date(e.at) - openAt) / 60000);
        openAt = null;
      }
    }
    if (openAt != null && openUntil) total += Math.max(0, (openUntil - openAt) / 60000);
  }
  return Math.round(total);
}

/**
 * The hours a person owes for a week.
 * @param {object} p
 * @param {number} p.weeklyHours
 * @param {string[]} p.daysOff        weekly days off
 * @param {string} p.from             Saturday
 * @param {string} p.to               Friday
 * @param {string|null} p.since       first day the weekly hours count
 * @param {Set<string>} p.awayDates   working days covered by full-day leave or WFH
 * @param {number} p.creditedHours    approved timed excuses and missions in the week
 */
function requiredHoursForWeek({ weeklyHours, daysOff, from, to, since = null, awayDates = new Set(), creditedHours = 0 }) {
  const weekly = Number(weeklyHours) || 0;
  const workingPerWeek = Math.max(1, 7 - normalizeDaysOff(daysOff).length);
  const dayShare = weekly / workingPerWeek;
  let excused = 0;
  for (const date of enumerateDateRange(from, to)) {
    if (isScheduledDayOff(daysOff, date)) continue;
    if ((since && date < since) || awayDates.has(date)) excused += 1;
  }
  const required = Math.max(0, weekly - dayShare * excused - (Number(creditedHours) || 0));
  return { required_hours: roundMoney(required), day_share: roundMoney(dayShare), excused_days: excused };
}

function hoursText(h) {
  const minutes = Math.round((Number(h) || 0) * 60);
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return mm ? `${hh}h ${String(mm).padStart(2, '0')}m` : `${hh}h`;
}

function dayLabel(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function deductionReason(from, to, d) {
  return `Hours per week ${dayLabel(from)}–${dayLabel(to)}: worked ${hoursText(d.worked_hours)} of ${hoursText(d.required_hours)} · ${hoursText(d.short_hours)} short × hourly rate (daily ÷ 8) × ${d.multiplier}`;
}

/** Everything needed to work out one person's week, read from the database. */
async function loadWeek(query, staff, from, to) {
  const [events, leaves, wfh] = await Promise.all([
    query(
      `SELECT work_date::text AS work_date, kind, at FROM staff_clock_events
       WHERE staff_user_id = $1 AND work_date BETWEEN $2::date AND $3::date ORDER BY at, id`,
      [staff.id, from, to]
    ),
    query(
      `SELECT leave_type, start_date::text AS start_date, end_date::text AS end_date,
              start_time::text AS start_time, end_time::text AS end_time, hours
       FROM staff_leave_requests
       WHERE staff_user_id = $1 AND status = 'approved' AND start_date <= $3::date AND end_date >= $2::date`,
      [staff.id, from, to]
    ),
    query(
      `SELECT work_date::text AS work_date FROM staff_wfh_requests
       WHERE staff_user_id = $1 AND status = 'approved' AND work_date BETWEEN $2::date AND $3::date`,
      [staff.id, from, to]
    ),
  ]);
  const awayDates = new Set(wfh.rows.map((r) => r.work_date));
  let creditedHours = 0;
  for (const l of leaves.rows) {
    const timed = Boolean(l.start_time && l.end_time);
    if (timed && TIMED_LEAVE_TYPES.includes(String(l.leave_type))) {
      let hours = Number(l.hours);
      if (!(hours > 0)) {
        try {
          hours = excuseHoursFromTimes(l.start_time, l.end_time);
        } catch {
          hours = 0;
        }
      }
      creditedHours += hours;
      continue;
    }
    for (const date of enumerateDateRange(l.start_date > from ? l.start_date : from, l.end_date < to ? l.end_date : to)) {
      awayDates.add(date);
    }
  }
  return { events: events.rows, awayDates, creditedHours };
}

/** One person's week: hours worked, hours required and the deduction (0 when covered). */
async function weekSummary(query, staff, isoDate, { now = new Date() } = {}) {
  const { from, to } = weekBounds(isoDate);
  const since = staff.weekly_hours_since ? String(staff.weekly_hours_since).slice(0, 10) : null;
  const { events, awayDates, creditedHours } = await loadWeek(query, staff, from, to);
  const today = cairoParts(now).date;
  const worked = clockedMinutes(events, to >= today ? now : null) / 60;
  const req = requiredHoursForWeek({ weeklyHours: staff.weekly_hours, daysOff: staff.days_off, from, to, since, awayDates, creditedHours });
  const d = computeWeeklyHoursDeduction(staff.base_salary, req.required_hours, worked);
  return {
    from,
    to,
    ended: to < today,
    weekly_hours: Number(staff.weekly_hours) || 0,
    ...req,
    worked_hours: d.worked_hours,
    short_hours: d.short_hours,
    hourly_rate: d.hourly_rate,
    daily_rate: d.daily_rate,
    multiplier: d.multiplier,
    deduction: d.amount,
    reason: deductionReason(from, to, d),
  };
}

const WEEKLY_STAFF_SELECT = `
  SELECT id, full_name, role, COALESCE(base_salary, 0)::float AS base_salary, pay_basis,
         weekly_hours::float AS weekly_hours, weekly_hours_since::text AS weekly_hours_since,
         COALESCE(days_off, '{}') AS days_off, COALESCE(office_attendance_exempt, false) AS office_attendance_exempt
  FROM staff_users
  WHERE pay_basis = 'weekly_hours' AND COALESCE(is_active, 1)::int = 1`;

/** Writes, updates or removes the weekly-hours deduction of every ended week still being re-checked. */
async function settleWeeklyHours({ query, now = new Date(), staffId = null } = {}) {
  const q = query || require('../config/db').query;
  const params = [];
  let sql = WEEKLY_STAFF_SELECT;
  if (staffId) {
    params.push(staffId);
    sql += ` AND id = $1`;
  }
  const { rows: staff } = await q(sql, params);
  const today = cairoParts(now).date;
  const lastEnded = addDaysIso(weekBounds(today).from, -7);
  let changed = 0;
  for (const person of staff) {
    if (!isWeeklyHoursStaff(person) || !hasOfficeAttendance(person.role) || person.office_attendance_exempt) continue;
    for (let i = 0; i < RECHECK_WEEKS; i += 1) {
      const from = addDaysIso(lastEnded, -7 * i);
      const to = addDaysIso(from, 6);
      if (person.weekly_hours_since && person.weekly_hours_since > to) continue;
      const cycle = payrollCycleForDate(to);
      const { rows: paid } = await q(
        `SELECT 1 FROM staff_payroll_entries WHERE staff_user_id = $1 AND period_year = $2 AND period_month = $3 AND status = 'paid' LIMIT 1`,
        [person.id, cycle.year, cycle.month]
      );
      if (paid[0]) continue;
      const week = await weekSummary(q, person, from, { now });
      const { rows: existing } = await q(
        `SELECT id, amount::float AS amount, reason FROM staff_salary_deductions
         WHERE staff_user_id = $1 AND category = 'weekly_hours' AND deduction_date = $2::date ORDER BY id`,
        [person.id, to]
      );
      const row = existing[0];
      for (const extra of existing.slice(1)) {
        await q(`DELETE FROM staff_salary_deductions WHERE id = $1`, [extra.id]);
        changed += 1;
      }
      if (week.deduction > 0 && !row) {
        await q(
          `INSERT INTO staff_salary_deductions (staff_user_id, amount, reason, deduction_date, category, daily_rate)
           VALUES ($1, $2, $3, $4::date, 'weekly_hours', $5)`,
          [person.id, week.deduction, week.reason, to, week.daily_rate]
        );
        changed += 1;
      } else if (week.deduction > 0 && (Math.abs(week.deduction - row.amount) > 0.009 || row.reason !== week.reason)) {
        await q(`UPDATE staff_salary_deductions SET amount = $2, reason = $3 WHERE id = $1`, [row.id, week.deduction, week.reason]);
        changed += 1;
      } else if (!(week.deduction > 0) && row) {
        await q(`DELETE FROM staff_salary_deductions WHERE id = $1`, [row.id]);
        changed += 1;
      }
    }
  }
  return changed;
}

module.exports = {
  weekBounds,
  clockedMinutes,
  requiredHoursForWeek,
  weekSummary,
  settleWeeklyHours,
  deductionReason,
  hoursText,
  RECHECK_WEEKS,
};
