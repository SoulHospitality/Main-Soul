/**
 * Clocks out anyone still clocked in once their shift is over: at their own shift end (staff_users.shift_end,
 * Cairo time; 19:00 unless HR set another) of the day they clocked in, or at the moment they clocked in if that
 * was after the shift had ended.
 * Days left open from before today are closed the same way. Clocking in early is never affected.
 */
const { query } = require('../config/db');
const {
  cairoParts,
  computeEarlyLeaveDeduction,
  hasOfficeAttendance,
  isScheduledDayOff,
  isWeeklyHoursStaff,
} = require('./hrRules');
const { settleWeeklyHours } = require('./weeklyHours');
const { logAudit } = require('./audit');

const TIMEZONE = 'Africa/Cairo';

function hhmm(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Closes every open clock-in whose shift has ended. Pass staffId to close one person's only. */
async function closeEndedShifts({ staffId = null, now = new Date() } = {}) {
  const { date: today, minutes } = cairoParts(now);
  const params = [today, hhmm(minutes), TIMEZONE];
  let staffFilter = '';
  if (staffId) {
    params.push(staffId);
    staffFilter = ` AND staff_user_id = $${params.length}`;
  }
  const { rows: open } = await query(
    `SELECT l.staff_user_id, to_char(l.work_date, 'YYYY-MM-DD') AS work_date, l.at,
            GREATEST(((l.work_date + su.shift_end) AT TIME ZONE $3), l.at) AS out_at,
            to_char(GREATEST(((l.work_date + su.shift_end) AT TIME ZONE $3), l.at) AT TIME ZONE $3, 'HH24:MI') AS out_time,
            su.full_name
     FROM (
       SELECT DISTINCT ON (staff_user_id, work_date) staff_user_id, work_date, kind, at
       FROM staff_clock_events
       WHERE work_date <= $1::date${staffFilter}
       ORDER BY staff_user_id, work_date, at DESC, id DESC
     ) l
     JOIN staff_users su ON su.id = l.staff_user_id
     WHERE l.kind = 'in' AND (l.work_date < $1::date OR $2::time >= su.shift_end)`,
    params
  );
  for (const row of open) {
    await query(
      `INSERT INTO staff_clock_events (staff_user_id, work_date, kind, source, at)
       VALUES ($1, $2::date, 'out', 'shift_end', $3)`,
      [row.staff_user_id, row.work_date, row.out_at]
    );
    await query(
      `UPDATE staff_attendance SET check_out = $3::time, updated_at = now()
       WHERE staff_user_id = $1 AND work_date = $2::date AND check_in IS NOT NULL`,
      [row.staff_user_id, row.work_date, row.out_time]
    );
    await logAudit({
      userId: row.staff_user_id,
      action: 'CLOCK_AUTO_OUT',
      entityType: 'staff_user',
      entityId: row.staff_user_id,
      details: { name: row.full_name, reason: 'shift_end', date: row.work_date, at: row.out_time },
    }).catch(() => {});
  }
  return open.length;
}

const EXCUSED_TYPES = ['paid_excuse', 'unpaid_excuse', 'early_leave', 'mission'];

/**
 * Leaving early: once a day's shift has ended, anyone whose clock-in day ended before their shift end
 * (last clock-out before staff_users.shift_end) is deducted hours missed × hourly rate, unless an approved excuse or
 * mission covers that day. Re-checked for the last 7 days, so an excuse approved afterwards, or HR
 * correcting the check-out, removes the deduction again.
 */
async function settleEarlyLeaves({ now = new Date() } = {}) {
  const { date: today, minutes } = cairoParts(now);
  const { rows } = await query(
    `SELECT a.staff_user_id, to_char(a.work_date, 'YYYY-MM-DD') AS work_date, a.check_out::text AS check_out, a.status,
            su.full_name, su.role, COALESCE(su.base_salary, 0)::float AS base_salary,
            COALESCE(su.days_off, '{}') AS days_off, COALESCE(su.office_attendance_exempt, false) AS exempt,
            su.shift_end::text AS shift_end, su.pay_basis, su.weekly_hours::float AS weekly_hours,
            EXISTS (
              SELECT 1 FROM staff_leave_requests l
              WHERE l.staff_user_id = a.staff_user_id AND l.status = 'approved'
                AND l.leave_type = ANY($3::text[])
                AND l.start_date <= a.work_date AND COALESCE(l.end_date, l.start_date) >= a.work_date
            ) AS excused,
            (SELECT e.kind FROM staff_clock_events e
              WHERE e.staff_user_id = a.staff_user_id AND e.work_date = a.work_date
              ORDER BY e.at DESC, e.id DESC LIMIT 1) AS last_kind,
            d.id AS deduction_id, d.amount::float AS deducted
     FROM staff_attendance a
     JOIN staff_users su ON su.id = a.staff_user_id
     LEFT JOIN LATERAL (
       SELECT id, amount FROM staff_salary_deductions
       WHERE staff_user_id = a.staff_user_id AND deduction_date = a.work_date AND category = 'early_leave'
       ORDER BY id LIMIT 1
     ) d ON true
     WHERE a.work_date >= $1::date - 7 AND a.work_date <= $1::date
       AND (a.work_date < $1::date OR $2::time >= su.shift_end)
       AND a.check_in IS NOT NULL`,
    [today, hhmm(minutes), EXCUSED_TYPES]
  );
  let changed = 0;
  for (const r of rows) {
    // Only days run by the phone clock (the last event says out); HR-entered days stay as HR set them.
    if (r.last_kind !== 'out') continue;
    const counts =
      ['on_time', 'late'].includes(r.status) &&
      hasOfficeAttendance(r.role) &&
      !r.exempt &&
      // Hours-per-week staff are settled on the week's hours instead.
      !isWeeklyHoursStaff(r) &&
      !isScheduledDayOff(r.days_off, r.work_date) &&
      !r.excused;
    const due = counts ? computeEarlyLeaveDeduction(r.base_salary, r.check_out, r.shift_end) : { amount: 0 };
    const amount = Number(due.amount) || 0;
    if (amount > 0 && !r.deduction_id) {
      await query(
        `INSERT INTO staff_salary_deductions (staff_user_id, amount, reason, deduction_date, category, daily_rate)
         VALUES ($1, $2, $3, $4::date, 'early_leave', $5)`,
        [r.staff_user_id, amount, due.label, r.work_date, due.daily_rate]
      );
      changed += 1;
    } else if (amount > 0 && Math.abs(amount - (r.deducted || 0)) > 0.009) {
      await query(`UPDATE staff_salary_deductions SET amount = $2, reason = $3 WHERE id = $1`, [r.deduction_id, amount, due.label]);
      changed += 1;
    } else if (!(amount > 0) && r.deduction_id) {
      await query(`DELETE FROM staff_salary_deductions WHERE id = $1`, [r.deduction_id]);
      changed += 1;
    }
  }
  return changed;
}

const WEEKLY_INTERVAL_MS = 15 * 60 * 1000;
let lastWeeklyRun = 0;

function startClockShiftEndJob() {
  const interval = Number(process.env.CLOCK_SHIFT_END_INTERVAL_MS || 60000);
  const timer = setInterval(async () => {
    try {
      const n = await closeEndedShifts();
      if (n) console.log(`[clock] clocked out ${n} at shift end`);
      const early = await settleEarlyLeaves();
      if (early) console.log(`[clock] early-leave deductions updated: ${early}`);
      // Hours per week: re-checked every 15 minutes, so leave approved after the week still counts.
      if (Date.now() - lastWeeklyRun >= WEEKLY_INTERVAL_MS) {
        lastWeeklyRun = Date.now();
        const weekly = await settleWeeklyHours();
        if (weekly) console.log(`[clock] weekly-hours deductions updated: ${weekly}`);
      }
    } catch (err) {
      if (err.code !== '42P01') console.error('[clock] shift-end clock-out', err.message);
    }
  }, interval);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { closeEndedShifts, settleEarlyLeaves, startClockShiftEndJob };
