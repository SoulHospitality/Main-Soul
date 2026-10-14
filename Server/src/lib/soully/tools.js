const { query } = require('../../config/db');
const { reservationScopeClause, bookingAssigneeClause } = require('../reservationScope');
const {
  canManageStaffTasks,
  staffTaskScopeSql,
  presentStaffTaskForViewer,
} = require('../staffTasks');
const { staffTaskTablesReady } = require('../staffTaskSchema');
const { soullyCan } = require('./access');

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
       LIMIT 12`,
      [like(term)]
    );
    return { count: rows.length, units: rows };
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
       LIMIT 12`,
      [like(term), ...scope.params]
    );
    return { count: rows.length, reservations: rows, scope: 'only stays this login can open' };
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
              COALESCE(r.guest_phone, '') AS guest_phone,
              COALESCE(u.unit_number, u.title) AS unit,
              COALESCE(u.project, u.compound) AS project
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       WHERE r.status <> 'cancelled'
         AND ${when}${scope.clause}
       ORDER BY u.project NULLS LAST, u.unit_number NULLS LAST
       LIMIT 20`,
      [date, ...scope.params]
    );
    return { date, kind, count: rows.length, stays: rows };
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
         LIMIT 15`
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
      `SELECT full_name, role, email, staff_code, is_active
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
    return {
      count: rows.length,
      staff: rows.map((row) => ({
        name: row.full_name,
        role: ROLE_LABELS[row.role] || row.role,
        email: row.email,
        staff_code: row.staff_code,
        active: Boolean(row.is_active),
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
    description: 'Look up a coworker by name, email, or staff code. No salaries. HR and CEO only.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
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
  return { error: 'unknown_tool' };
}

module.exports = { toolsFor, runTool, cairoToday, ROLE_LABELS };
