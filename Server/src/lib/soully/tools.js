const { query } = require('../../config/db');
const { reservationScopeClause, bookingAssigneeClause } = require('../reservationScope');
const {
  canManageStaffTasks,
  staffTaskScopeSql,
  presentStaffTaskForViewer,
} = require('../staffTasks');
const { staffTaskTablesReady } = require('../staffTaskSchema');
const { soullyCan } = require('./access');
const { FINANCIAL_EPOCH, clampFromDate } = require('../financialEpoch');

const ROLE_LABELS = {
  admin: 'CEO',
  reservations: 'Reservations',
  reservations_web: 'Website Reservations',
  reservations_manual: 'Manual Reservations',
  reservations_manager: 'Reservations Manager',
  unit_acquisition_agent: 'Unit Acquisition Agent',
  unit_acquisition_manager: 'Unit Acquisition Manager',
  operations: 'Operations',
  operations_supervisor: 'Operations Manager',
  housekeeping: 'Housekeeping',
  housekeeping_supervisor: 'Housekeeping Supervisor',
  resale: 'Resale',
  resale_manager: 'Resale Manager',
  finance: 'Finance',
  finance_manager: 'Financial Manager',
  hr: 'HR',
  hr_supervisor: 'HR Manager',
  owners_relations: 'Owner Experience',
  marketing_pr: 'Marketing and PR',
  web_developer: 'Web Developer',
};

function clip(value, max = 80) {
  return String(value || '').trim().slice(0, max);
}

function isoDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function rangeOf(input) {
  const to = isoDate(input.to) || isoDate(input.date) || cairoToday();
  const from = isoDate(input.from) || `${to.slice(0, 7)}-01`;
  return from <= to ? { from, to } : { from: to, to: from };
}

function rowLimit(user, normal, wide) {
  return user?.role === 'admin' ? wide : normal;
}

function denied(page) {
  return { error: 'forbidden', page, message: 'This role cannot see that part of the PMS.' };
}

function failed() {
  return { error: 'lookup_failed', message: 'That lookup did not run. Say so instead of guessing.' };
}

function like(term) {
  return `%${term.replace(/[%_]/g, '')}%`;
}

async function searchUnits(user, input) {
  if (!soullyCan(user, 'units')) return denied('units');
  const term = clip(input.query, 60);
  if (term.length < 2) return { error: 'need_query', message: 'Ask for a unit number, name, or project.' };
  try {
    const { rows } = await query(
      `SELECT COALESCE(u.unit_number, u.title) AS unit,
              u.title,
              COALESCE(u.project, u.compound) AS project,
              u.city,
              u.beds,
              u.baths,
              u.status,
              u.listing_type,
              u.property_type
       FROM units u
       WHERE u.title ILIKE $1
          OR COALESCE(u.unit_number, '') ILIKE $1
          OR COALESCE(u.project, '') ILIKE $1
          OR COALESCE(u.compound, '') ILIKE $1
       ORDER BY u.project NULLS LAST, u.unit_number NULLS LAST
       LIMIT ${rowLimit(user, 12, 40)}`,
      [like(term)]
    );
    return { count: rows.length, truncated: rows.length >= rowLimit(user, 12, 40), units: rows };
  } catch (err) {
    console.error('[soully] units', err.message);
    return failed();
  }
}

async function searchReservations(user, input) {
  if (!soullyCan(user, 'reservations')) return denied('reservations');
  const term = clip(input.query, 60);
  if (term.length < 2) return { error: 'need_query', message: 'Ask for a guest name, unit, or project.' };
  const scope = reservationScopeClause(user, 'r', 2);
  try {
    const { rows } = await query(
      `SELECT r.guest_name,
              r.check_in::text AS check_in,
              r.check_out::text AS check_out,
              r.nights,
              r.status,
              r.booking_source,
              r.total_amount,
              r.amount_paid,
              r.payment_status,
              COALESCE(r.guest_phone, '') AS guest_phone,
              COALESCE(u.unit_number, u.title) AS unit,
              COALESCE(u.project, u.compound) AS project
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       WHERE (
         r.guest_name ILIKE $1
         OR COALESCE(u.unit_number, '') ILIKE $1
         OR COALESCE(u.title, '') ILIKE $1
         OR COALESCE(u.project, u.compound, '') ILIKE $1
       )${scope.clause}
       ORDER BY r.check_in DESC
       LIMIT ${rowLimit(user, 12, 40)}`,
      [like(term), ...scope.params]
    );
    return {
      count: rows.length,
      truncated: rows.length >= rowLimit(user, 12, 40),
      reservations: rows,
      scope: user.role === 'admin' ? 'every stay' : 'only stays this login can open',
    };
  } catch (err) {
    console.error('[soully] reservations', err.message);
    return failed();
  }
}

async function stayBoard(user, input) {
  const allowed = soullyCan(user, 'reservations') || soullyCan(user, 'schedule') || soullyCan(user, 'operations');
  if (!allowed) return denied('reservations');
  const date = isoDate(input.date) || cairoToday();
  const kind = ['arrivals', 'departures', 'in_house'].includes(input.kind) ? input.kind : 'arrivals';
  const scope = reservationScopeClause(user, 'r', 2);
  const when = {
    arrivals: 'r.check_in::date = $1::date',
    departures: 'r.check_out::date = $1::date',
    in_house: 'r.check_in::date <= $1::date AND r.check_out::date > $1::date',
  }[kind];
  try {
    const { rows } = await query(
      `SELECT r.guest_name,
              r.check_in::text AS check_in,
              r.check_out::text AS check_out,
              r.status,
              r.booking_source,
              r.total_amount,
              r.amount_paid,
              r.payment_status,
              COALESCE(r.guest_phone, '') AS guest_phone,
              COALESCE(u.unit_number, u.title) AS unit,
              COALESCE(u.project, u.compound) AS project
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       WHERE r.status <> 'cancelled'
         AND ${when}${scope.clause}
       ORDER BY u.project NULLS LAST, u.unit_number NULLS LAST
       LIMIT ${rowLimit(user, 20, 80)}`,
      [date, ...scope.params]
    );
    return { date, kind, count: rows.length, truncated: rows.length >= rowLimit(user, 20, 80), stays: rows };
  } catch (err) {
    console.error('[soully] stay-board', err.message);
    return failed();
  }
}

async function myTasks(user) {
  if (!soullyCan(user, 'tasks')) return denied('tasks');
  try {
    const ready = await staffTaskTablesReady();
    if (!ready.staff_tasks) return { tasks: [], message: 'Tasks are not set up yet.' };
    const me = user.id;
    const sql = user.role === 'admin'
      ? `SELECT t.title, t.deadline::text AS deadline, t.completed_at, t.assignee_id, t.created_by,
                a.full_name AS assignee_name, m.full_name AS created_by_name
         FROM staff_tasks t
         JOIN staff_users a ON a.id = t.assignee_id
         JOIN staff_users m ON m.id = t.created_by
         WHERE ${staffTaskScopeSql('$1', 'a', user.role)}
         ORDER BY (t.completed_at IS NULL) DESC, t.deadline ASC
         LIMIT 40`
      : canManageStaffTasks(user)
        ? `SELECT t.title, t.deadline::text AS deadline, t.completed_at, t.assignee_id, t.created_by,
                  a.full_name AS assignee_name, m.full_name AS created_by_name
           FROM staff_tasks t
           JOIN staff_users a ON a.id = t.assignee_id
           JOIN staff_users m ON m.id = t.created_by
           WHERE t.assignee_id = $1 OR ${staffTaskScopeSql('$1', 'a', user.role)}
           ORDER BY (t.completed_at IS NULL) DESC, t.deadline ASC
           LIMIT 15`
        : `SELECT t.title, t.deadline::text AS deadline, t.completed_at, t.assignee_id, t.created_by,
                  a.full_name AS assignee_name, m.full_name AS created_by_name
           FROM staff_tasks t
           JOIN staff_users a ON a.id = t.assignee_id
           JOIN staff_users m ON m.id = t.created_by
           WHERE t.assignee_id = $1
           ORDER BY (t.completed_at IS NULL) DESC, t.deadline ASC
           LIMIT 15`;
    const params = user.role === 'admin' ? [] : [me];
    const { rows } = await query(sql, params);
    const tasks = rows.map((row) => {
      const shown = presentStaffTaskForViewer(row, user);
      return {
        title: shown.title,
        deadline: shown.deadline,
        done: Boolean(shown.completed_at),
        mine: String(row.assignee_id) === String(me),
        assigned_by_me: String(row.created_by) === String(me),
        assignee: shown.assignee_name || null,
      };
    });
    return { count: tasks.length, tasks };
  } catch (err) {
    console.error('[soully] tasks', err.message);
    return failed();
  }
}

async function websiteQueue(user) {
  if (!soullyCan(user, 'website_bookings')) return denied('website_bookings');
  const scope = bookingAssigneeClause(user, 'b', 1);
  try {
    const { rows } = await query(
      `SELECT b.guest_name,
              b.checkin::text AS check_in,
              b.checkout::text AS check_out,
              b.status,
              b.guests,
              COALESCE(u.unit_number, u.title) AS unit,
              COALESCE(u.project, u.compound) AS project,
              (b.assigned_sales_id IS NULL) AS unassigned
       FROM bookings b
       LEFT JOIN units u ON u.id = b.unit_id
       WHERE b.status IN ('pending', 'held')${scope.clause}
       ORDER BY b.created_at DESC
       LIMIT 15`,
      scope.params
    );
    return { count: rows.length, requests: rows };
  } catch (err) {
    console.error('[soully] website', err.message);
    return failed();
  }
}

async function findStaff(user, input) {
  if (!soullyCan(user, 'users')) return denied('users');
  const term = clip(input.query, 60);
  if (term.length < 2) return { error: 'need_query', message: 'Ask for a name or staff code.' };
  try {
    const { rows } = await query(
      `SELECT full_name, role, email, staff_code, is_active, base_salary
       FROM staff_users
       WHERE role <> 'owner'
         AND (
           full_name ILIKE $1
           OR COALESCE(email, '') ILIKE $1
           OR COALESCE(staff_code, '') ILIKE $1
         )
       ORDER BY full_name
       LIMIT 12`,
      [like(term)]
    );
    const showPay = soullyCan(user, 'payroll');
    return {
      count: rows.length,
      staff: rows.map((row) => ({
        name: row.full_name,
        role: ROLE_LABELS[row.role] || row.role,
        email: row.email,
        staff_code: row.staff_code,
        active: Boolean(row.is_active),
        ...(showPay ? { base_salary: row.base_salary != null ? Number(row.base_salary) : null } : {}),
      })),
    };
  } catch (err) {
    console.error('[soully] staff', err.message);
    return failed();
  }
}

async function housekeepingToday(user, input) {
  const allowed = soullyCan(user, 'hk_today') || soullyCan(user, 'housekeeping') || soullyCan(user, 'operations');
  if (!allowed) return denied('housekeeping');
  const date = isoDate(input.date) || cairoToday();
  try {
    const { rows } = await query(
      `SELECT t.status,
              t.due_at::date::text AS due,
              COALESCE(u.unit_number, u.title) AS unit,
              COALESCE(u.project, u.compound) AS project
       FROM housekeeping_tasks t
       JOIN units u ON u.id = t.unit_id
       WHERE t.due_at::date = $1::date
       ORDER BY t.status, u.project NULLS LAST
       LIMIT 20`,
      [date]
    );
    return { date, count: rows.length, cleans: rows };
  } catch (err) {
    console.error('[soully] housekeeping', err.message);
    return failed();
  }
}

function monthKeys(today, count) {
  const [year, month] = today.split('-').map(Number);
  const keys = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - i, 1));
    keys.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

function fillMonths(keys, rows, fields) {
  const byMonth = new Map(rows.map((row) => [String(row.month), row]));
  return keys.map((month) => {
    const row = byMonth.get(month) || {};
    const point = { month };
    for (const field of fields) point[field] = Number(row[field]) || 0;
    return point;
  });
}

function forecastNext(values, floorAtZero = true) {
  const series = values.filter((value) => Number.isFinite(value));
  if (series.length < 2) return null;
  let change = 0;
  for (let i = 1; i < series.length; i += 1) change += series[i] - series[i - 1];
  const step = change / (series.length - 1);
  const latest = series[series.length - 1];
  const recent = series.slice(-3);
  const average = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  const estimate = Math.round(latest + step);
  return {
    based_on_full_months: series.length,
    latest_full_month: Math.round(latest),
    recent_average: Math.round(average),
    estimated_next_month: floorAtZero ? Math.max(0, estimate) : estimate,
  };
}

function daysInMonth(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function diagnoseField(series, field, currentMonth, today) {
  const history = series.filter((row) => row.month < currentMonth);
  if (history.length < 2) return { field, status: 'not_enough_history' };
  const previous = history[history.length - 2];
  const latest = history[history.length - 1];
  const before = Number(previous[field]) || 0;
  const after = Number(latest[field]) || 0;
  const change = Math.round(after - before);
  const changePercent = before ? Math.round((change / Math.abs(before)) * 100) : null;
  const current = series.find((row) => row.month === currentMonth);
  const soFar = current ? Number(current[field]) || 0 : 0;
  const day = Number(String(today).slice(8, 10)) || 1;
  const pace = Math.round((soFar / day) * daysInMonth(currentMonth));
  let reading = 'flat';
  if (change > 0 && (changePercent == null || changePercent >= 5)) reading = 'up';
  else if (change < 0 && (changePercent == null || changePercent <= -5)) reading = 'down';
  return {
    field,
    previous_month: previous.month,
    previous_value: Math.round(before),
    latest_full_month: latest.month,
    latest_value: Math.round(after),
    change,
    change_percent: changePercent,
    reading,
    current_month_so_far: Math.round(soFar),
    current_month_pace_if_the_rate_holds: pace,
    pace_versus_latest_full_month: Math.round(pace - after),
  };
}

function attachForecasts(series, fields, currentMonth, signed = [], today = null) {
  const history = series.filter((row) => row.month < currentMonth);
  const asOf = today || `${currentMonth}-01`;
  const forecasts = {};
  const diagnosis = {};
  for (const field of fields) {
    const values = history.map((row) => row[field]);
    const next = forecastNext(values, !signed.includes(field));
    forecasts[field] = next
      ? { ...next, method: 'average change between the recorded full months' }
      : null;
    diagnosis[field] = diagnoseField(series, field, currentMonth, asOf);
  }
  return {
    months: series,
    current_month: currentMonth,
    current_month_is_partial: true,
    forecast_uses_full_months_only: true,
    diagnosis,
    forecast: forecasts,
  };
}

async function departmentOutlook(user, input) {
  const department = ['all', 'reservations', 'finance', 'hr', 'operations', 'acquisition'].includes(input.department)
    ? input.department
    : 'all';
  const today = cairoToday();
  const currentMonth = today.slice(0, 7);
  const keys = monthKeys(today, 6);
  const from = `${keys[0]}-01`;
  const want = (name) => department === 'all' || department === name;
  const report = {
    as_of: today,
    from,
    to: today,
    department,
    basis: 'diagnosis and forecast are calculated from the months below. A prediction or a diagnosis must use those fields and must not add a cause the months do not show.',
  };

  try {
    if (want('reservations')) {
      if (!soullyCan(user, 'reservations')) {
        report.reservations = denied('reservations');
      } else {
        const { rows } = await query(
          `SELECT to_char((created_at AT TIME ZONE 'Africa/Cairo')::date, 'YYYY-MM') AS month,
                  COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS reservations,
                  COALESCE(SUM(total_amount) FILTER (WHERE status <> 'cancelled'), 0)::float AS booked_value,
                  COALESCE(SUM(COALESCE(amount_paid, 0)) FILTER (WHERE status <> 'cancelled'), 0)::float AS collected
           FROM reservations
           WHERE (created_at AT TIME ZONE 'Africa/Cairo')::date >= $1::date
           GROUP BY 1
           ORDER BY 1`,
          [from]
        );
        report.reservations = attachForecasts(
          fillMonths(keys, rows, ['reservations', 'booked_value', 'collected']),
          ['reservations', 'booked_value', 'collected'],
          currentMonth,
          [],
          today
        );
      }
    }

    if (want('finance')) {
      if (!soullyCan(user, 'financial_system') && !soullyCan(user, 'reservations')) {
        report.finance = denied('financial_system');
      } else {
        const { rows: money } = await query(
          `SELECT to_char(check_in::date, 'YYYY-MM') AS month,
                  COALESCE(SUM(total_amount) FILTER (WHERE status <> 'cancelled'), 0)::float AS stay_value,
                  COALESCE(SUM(COALESCE(amount_paid, 0)) FILTER (WHERE status <> 'cancelled'), 0)::float AS collected
           FROM reservations
           WHERE check_in::date >= $1::date
           GROUP BY 1`,
          [from]
        );
        let expenses = [];
        if (soullyCan(user, 'financial_system')) {
          const { rows } = await query(
            `SELECT to_char(expense_date, 'YYYY-MM') AS month,
                    COALESCE(SUM(amount), 0)::float AS expenses
             FROM expenses
             WHERE expense_date >= $1::date
             GROUP BY 1`,
            [from]
          );
          expenses = rows;
        }
        const byMoney = new Map(money.map((row) => [String(row.month), row]));
        const byExpense = new Map(expenses.map((row) => [String(row.month), row]));
        const series = keys.map((month) => {
          const stay = byMoney.get(month) || {};
          const expense = byExpense.get(month) || {};
          const collected = Number(stay.collected) || 0;
          const spent = Number(expense.expenses) || 0;
          return {
            month,
            stay_value: Number(stay.stay_value) || 0,
            collected,
            expenses: spent,
            collected_minus_expenses: Math.round(collected - spent),
          };
        });
        report.finance = attachForecasts(
          series,
          ['stay_value', 'collected', 'expenses', 'collected_minus_expenses'],
          currentMonth,
          ['collected_minus_expenses'],
          today
        );
      }
    }

    if (want('hr')) {
      if (!soullyCan(user, 'attendance') && !soullyCan(user, 'payroll')) {
        report.hr = denied('attendance');
      } else {
        const hr = {};
        if (soullyCan(user, 'attendance')) {
          const { rows } = await query(
            `SELECT to_char(work_date, 'YYYY-MM') AS month,
                    COUNT(*) FILTER (WHERE status = 'on_time')::int AS on_time,
                    COUNT(*) FILTER (WHERE status = 'late')::int AS late,
                    COUNT(*) FILTER (WHERE status = 'no_show')::int AS no_show
             FROM staff_attendance
             WHERE work_date >= $1::date
             GROUP BY 1`,
            [from]
          );
          const series = fillMonths(keys, rows, ['on_time', 'late', 'no_show']).map((row) => {
            const marked = row.on_time + row.late + row.no_show;
            return {
              ...row,
              present_percent: marked ? Math.round(((row.on_time + row.late) / marked) * 100) : 0,
            };
          });
          hr.attendance = attachForecasts(series, ['no_show', 'present_percent'], currentMonth, [], today);
        }
        if (soullyCan(user, 'payroll')) {
          const { rows } = await query(
            `SELECT period_year::text || '-' || lpad(period_month::text, 2, '0') AS month,
                    COALESCE(SUM(net_pay), 0)::float AS net_pay,
                    COUNT(*)::int AS payslips
             FROM staff_payroll_entries
             WHERE make_date(period_year, period_month, 1) >= $1::date
             GROUP BY period_year, period_month
             ORDER BY period_year, period_month`,
            [from]
          );
          hr.payroll = attachForecasts(fillMonths(keys, rows, ['net_pay', 'payslips']), ['net_pay'], currentMonth, [], today);
          const { rows: headcount } = await query(
            `SELECT COUNT(*) FILTER (WHERE is_active = true AND role <> 'owner')::int AS active_staff,
                    COALESCE(SUM(base_salary) FILTER (WHERE is_active = true AND role <> 'owner'), 0)::float AS monthly_base
             FROM staff_users`
          );
          hr.headcount = headcount[0] || {};
        }
        report.hr = hr;
      }
    }

    if (want('operations')) {
      if (!soullyCan(user, 'operations') && !soullyCan(user, 'reservations')) {
        report.operations = denied('operations');
      } else {
        const { rows } = await query(
          `SELECT to_char((ops_handed_over_at AT TIME ZONE 'Africa/Cairo')::date, 'YYYY-MM') AS month,
                  COUNT(*)::int AS checkins
           FROM reservations
           WHERE COALESCE(ops_handed_over, 0)::int = 1
             AND ops_handed_over_at IS NOT NULL
             AND (ops_handed_over_at AT TIME ZONE 'Africa/Cairo')::date >= $1::date
           GROUP BY 1`,
          [from]
        );
        report.operations = attachForecasts(fillMonths(keys, rows, ['checkins']), ['checkins'], currentMonth, [], today);
      }
    }

    if (want('acquisition')) {
      if (!soullyCan(user, 'units') && user.role !== 'admin') {
        report.acquisition = denied('units');
      } else {
        const { rows } = await query(
          `SELECT to_char((created_at AT TIME ZONE 'Africa/Cairo')::date, 'YYYY-MM') AS month,
                  COUNT(*)::int AS units_added
           FROM units
           WHERE created_at IS NOT NULL
             AND (created_at AT TIME ZONE 'Africa/Cairo')::date >= $1::date
           GROUP BY 1`,
          [from]
        );
        report.acquisition = attachForecasts(fillMonths(keys, rows, ['units_added']), ['units_added'], currentMonth, [], today);
      }
    }

    return report;
  } catch (err) {
    console.error('[soully] outlook', err.message);
    return failed();
  }
}

async function businessReport(user, input) {
  const topic = ['snapshot', 'money', 'payroll', 'attendance', 'expenses', 'owners'].includes(input.topic)
    ? input.topic
    : 'snapshot';
  const date = isoDate(input.date) || cairoToday();
  const { from, to } = rangeOf({ ...input, date });
  const term = clip(input.query, 60);

  if (topic === 'snapshot' && !soullyCan(user, 'reservations') && !soullyCan(user, 'dashboard')) {
    return denied('reservations');
  }
  if (topic === 'money' && !soullyCan(user, 'financial_system') && !soullyCan(user, 'reservations')) {
    return denied('financial_system');
  }
  if (topic === 'payroll' && !soullyCan(user, 'payroll')) return denied('payroll');
  if (topic === 'attendance' && !soullyCan(user, 'attendance')) return denied('attendance');
  if (topic === 'expenses' && !soullyCan(user, 'financial_system')) return denied('financial_system');
  if (topic === 'owners' && !soullyCan(user, 'owner_statement') && !soullyCan(user, 'financial_system')) {
    return denied('owner_statement');
  }

  try {
    if (topic === 'snapshot') {
      const { rows } = await query(
        `SELECT
           COUNT(*) FILTER (WHERE check_in::date = $1::date AND status <> 'cancelled')::int AS arrivals,
           COUNT(*) FILTER (WHERE check_out::date = $1::date AND status <> 'cancelled')::int AS departures,
           COUNT(*) FILTER (WHERE check_in::date <= $1::date AND check_out::date > $1::date AND status <> 'cancelled')::int AS in_house,
           COALESCE(SUM(total_amount) FILTER (WHERE check_in::date <= $1::date AND check_out::date > $1::date AND status <> 'cancelled'), 0)::float AS in_house_value,
           COALESCE(SUM(COALESCE(amount_paid, 0)) FILTER (WHERE check_in::date <= $1::date AND check_out::date > $1::date AND status <> 'cancelled'), 0)::float AS in_house_paid
         FROM reservations`,
        [date]
      );
      const { rows: units } = await query(
        `SELECT COALESCE(status, 'unknown') AS status, COUNT(*)::int AS count FROM units GROUP BY status ORDER BY count DESC`
      );
      let openTasks = null;
      try {
        const ready = await staffTaskTablesReady();
        if (ready.staff_tasks) {
          const { rows: taskRows } = await query(
            `SELECT COUNT(*) FILTER (WHERE completed_at IS NULL)::int AS open,
                    COUNT(*) FILTER (WHERE completed_at IS NULL AND deadline::date < $1::date)::int AS overdue
             FROM staff_tasks`,
            [date]
          );
          openTasks = taskRows[0] || null;
        }
      } catch (err) {
        console.error('[soully] snapshot tasks', err.message);
      }
      return { date, stays: rows[0] || {}, units, open_tasks: openTasks };
    }

    if (topic === 'money') {
      const { rows } = await query(
        `SELECT
           COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS stays,
           COALESCE(SUM(total_amount) FILTER (WHERE status <> 'cancelled'), 0)::float AS booked,
           COALESCE(SUM(COALESCE(amount_paid, 0)) FILTER (WHERE status <> 'cancelled'), 0)::float AS collected
         FROM reservations
         WHERE check_in::date >= $1::date AND check_in::date <= $2::date`,
        [from, to]
      );
      let expenses = null;
      if (soullyCan(user, 'financial_system')) {
        const { rows: exp } = await query(
          `SELECT COALESCE(SUM(amount), 0)::float AS total, COUNT(*)::int AS count
           FROM expenses
           WHERE expense_date >= $1::date AND expense_date <= $2::date`,
          [from, to]
        );
        expenses = exp[0] || null;
      }
      return { from, to, reservations: rows[0] || {}, expenses };
    }

    if (topic === 'payroll') {
      const params = [];
      let where = `role <> 'owner'`;
      if (term.length >= 2) {
        params.push(like(term));
        where += ` AND (full_name ILIKE $1 OR COALESCE(staff_code, '') ILIKE $1 OR COALESCE(email, '') ILIKE $1)`;
      }
      const { rows } = await query(
        `SELECT full_name, role, staff_code, is_active, COALESCE(base_salary, 0)::float AS base_salary
         FROM staff_users
         WHERE ${where}
         ORDER BY full_name
         LIMIT 80`,
        params
      );
      return {
        count: rows.length,
        truncated: rows.length >= 80,
        staff: rows.map((row) => ({
          name: row.full_name,
          role: ROLE_LABELS[row.role] || row.role,
          staff_code: row.staff_code,
          active: Boolean(row.is_active),
          base_salary: Number(row.base_salary) || 0,
        })),
      };
    }

    if (topic === 'attendance') {
      const params = [date];
      let nameClause = '';
      if (term.length >= 2) {
        params.push(like(term));
        nameClause = ` AND u.full_name ILIKE $2`;
      }
      const { rows } = await query(
        `SELECT u.full_name, a.status, a.check_in::text AS check_in, a.check_out::text AS check_out, a.notes
         FROM staff_attendance a
         JOIN staff_users u ON u.id = a.staff_user_id
         WHERE a.work_date = $1::date${nameClause}
         ORDER BY u.full_name
         LIMIT 80`,
        params
      );
      return { date, count: rows.length, attendance: rows };
    }

    if (topic === 'expenses') {
      const params = [from, to];
      let nameClause = '';
      if (term.length >= 2) {
        params.push(like(term));
        nameClause = ` AND (COALESCE(description, '') ILIKE $3 OR COALESCE(category, '') ILIKE $3)`;
      }
      const { rows } = await query(
        `SELECT description, amount, category, expense_date::text AS expense_date
         FROM expenses
         WHERE expense_date >= $1::date AND expense_date <= $2::date${nameClause}
         ORDER BY expense_date DESC
         LIMIT 40`,
        params
      );
      return { from, to, count: rows.length, truncated: rows.length >= 40, expenses: rows };
    }

    const params = [];
    let nameClause = '';
    if (term.length >= 2) {
      params.push(like(term));
      nameClause = ` AND su.full_name ILIKE $1`;
    } else {
      nameClause = ` AND su.is_active = true`;
    }
    const { rows: owners } = await query(
      `SELECT su.id, su.full_name, su.is_active, COUNT(ou.unit_id)::int AS units
       FROM staff_users su
       LEFT JOIN owner_units ou ON ou.owner_id = su.id
       WHERE su.role = 'owner'${nameClause}
       GROUP BY su.id
       ORDER BY su.full_name`,
      params
    );
    const periodFrom = clampFromDate(isoDate(input.from) || FINANCIAL_EPOCH);
    const periodTo = isoDate(input.to) || isoDate(input.date) || cairoToday();
    const { loadOwnerStatementData } = require('../../routes/pms/financialSystem');
    const { ownerBalances } = await loadOwnerStatementData(periodFrom, periodTo);
    const byOwner = new Map(ownerBalances.map((row) => [Number(row.owner_id), row]));
    const people = owners.map((owner) => {
      const balance = byOwner.get(Number(owner.id));
      return {
        name: owner.full_name,
        units: Number(owner.units) || 0,
        share: balance ? balance.gross_credits : 0,
        owner_expenses: balance ? balance.maintenance_deductions : 0,
        already_paid: balance ? balance.paid_out : 0,
        still_owed: balance ? balance.remaining : 0,
      };
    });
    const total = (field) => Math.round(people.reduce((sum, row) => sum + (Number(row[field]) || 0), 0));
    return {
      from: periodFrom,
      to: periodTo,
      active_owners: people.length,
      total_share: total('share'),
      total_owner_expenses: total('owner_expenses'),
      total_already_paid: total('already_paid'),
      total_still_owed: total('still_owed'),
      owners: people,
    };
  } catch (err) {
    console.error('[soully] report', topic, err.message);
    return failed();
  }
}

const TOOL_DEFS = [
  {
    name: 'search_units',
    page: 'units',
    description: 'Find chalets, apartments, and villas by unit number, name, or project. Read only.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Unit number, title, or project' } },
      required: ['query'],
    },
  },
  {
    name: 'search_reservations',
    page: 'reservations',
    description: 'Find stays this staff member is allowed to see, by guest, unit, or project. Read only.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'stay_board',
    page: 'reservations',
    also: ['schedule', 'operations'],
    description: 'Arrivals, departures, or guests in house on a Cairo date. Defaults to today. Read only.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD in Cairo. Omit for today.' },
        kind: { type: 'string', enum: ['arrivals', 'departures', 'in_house'] },
      },
    },
  },
  {
    name: 'my_tasks',
    page: 'tasks',
    description: 'Open and recently finished staff tasks this login can see. Read only.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'website_queue',
    page: 'website_bookings',
    description: 'Pending and held website booking requests this login can see. Read only.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'find_staff',
    page: 'users',
    description: 'Look up a coworker by name, email, or staff code. Includes base salary when this login can open payroll. HR and CEO.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'business_report',
    page: 'reservations',
    also: ['financial_system', 'payroll', 'attendance', 'users', 'owner_statement'],
    description: 'Live figures for one Cairo date or range. Topics: snapshot, money, payroll, attendance, expenses, owners. The owners topic returns each owner’s share, expenses, what was already paid, and what is still owed. Use it whenever they ask how much owners are owed. For a written report, a trend, or a next-month estimate, use department_outlook instead.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', enum: ['snapshot', 'money', 'payroll', 'attendance', 'expenses', 'owners'] },
        date: { type: 'string', description: 'YYYY-MM-DD. Omit for today.' },
        from: { type: 'string', description: 'YYYY-MM-DD range start. Omit for the first day of the month.' },
        to: { type: 'string', description: 'YYYY-MM-DD range end. Omit for date or today.' },
        query: { type: 'string', description: 'Optional name, code, or category filter.' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'department_outlook',
    page: 'reservations',
    also: ['financial_system', 'payroll', 'attendance', 'operations', 'units'],
    description: 'Six months of recorded department history, a diagnosis of what changed between the last two full months, the current month pace, and a next-month figure calculated from those months. Departments: all, reservations, finance, hr, operations, acquisition. Use this for every report, prediction, or diagnosis. Read the diagnosis and forecast back. Do not invent a cause.',
    input_schema: {
      type: 'object',
      properties: {
        department: {
          type: 'string',
          enum: ['all', 'reservations', 'finance', 'hr', 'operations', 'acquisition'],
          description: 'Use all unless they named one department.',
        },
      },
    },
  },
  {
    name: 'housekeeping_today',
    page: 'housekeeping',
    also: ['hk_today', 'operations'],
    description: 'Cleaning tasks due on a Cairo date. Defaults to today. Read only.',
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD. Omit for today.' } },
    },
  },
];

function toolsFor(user) {
  return TOOL_DEFS.filter((tool) => {
    if (soullyCan(user, tool.page)) return true;
    return (tool.also || []).some((page) => soullyCan(user, page));
  }).map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}

async function runTool(user, name, input) {
  const args = input && typeof input === 'object' ? input : {};
  if (name === 'search_units') return searchUnits(user, args);
  if (name === 'search_reservations') return searchReservations(user, args);
  if (name === 'stay_board') return stayBoard(user, args);
  if (name === 'my_tasks') return myTasks(user);
  if (name === 'website_queue') return websiteQueue(user);
  if (name === 'find_staff') return findStaff(user, args);
  if (name === 'housekeeping_today') return housekeepingToday(user, args);
  if (name === 'business_report') return businessReport(user, args);
  if (name === 'department_outlook') return departmentOutlook(user, args);
  return { error: 'unknown_tool' };
}

module.exports = { toolsFor, runTool, cairoToday, ROLE_LABELS, forecastNext };
