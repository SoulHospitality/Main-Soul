const { query } = require('../config/db');
const { salesLabelBelongsToUser } = require('./salesNameMatch');

const RESERVATIONS_TEAM_ROLES = new Set([
  'reservations',
  'reservations_web',
  'reservations_manual',
]);

function isReservationsTeam(user) {
  return RESERVATIONS_TEAM_ROLES.has(user?.role);
}

/** Any reservations-team member (legacy helper name kept for callers). */
function isReservationsAgent(user) {
  return isReservationsTeam(user);
}

function isWebsiteReservationsAgent(user) {
  return user?.role === 'reservations_web' || user?.role === 'reservations';
}

function isManualReservationsAgent(user) {
  return user?.role === 'reservations_manual' || user?.role === 'reservations';
}

function isAdmin(user) {
  return user?.role === 'admin';
}

function isWebsiteOriginReservation(reservation) {
  if (!reservation) return false;
  if (reservation.booking_id) return true;
  return String(reservation.booking_source || '').trim().toLowerCase() === 'website';
}

function assertNotAdminReservationHandler(user, action = 'manage reservations') {
  if (isAdmin(user)) {
    const err = new Error(`Admins cannot ${action}`);
    err.status = 403;
    throw err;
  }
}

/**
 * Pick the active website-reservations agent with the fewest open assignments.
 * Pool: reservations_web (+ legacy reservations dual-role accounts).
 */
async function pickLeastLoadedReservationsAgent() {
  const { rows } = await query(
    `SELECT s.id
     FROM staff_users s
     LEFT JOIN (
       SELECT staff_id, COUNT(*)::int AS cnt
       FROM (
         SELECT sales_person_id AS staff_id
         FROM reservations
         WHERE status NOT IN ('cancelled')
           AND sales_person_id IS NOT NULL
         UNION ALL
         SELECT assigned_sales_id AS staff_id
         FROM bookings
         WHERE status IN ('pending', 'held')
           AND assigned_sales_id IS NOT NULL
       ) workload
       GROUP BY staff_id
     ) load ON load.staff_id = s.id
     WHERE s.is_active = 1
       AND s.role IN ('reservations_web', 'reservations')
     ORDER BY COALESCE(load.cnt, 0) ASC, random()
     LIMIT 1`
  );
  if (rows[0]?.id) return rows[0].id;

  // Fallback so website bookings are never orphaned with no assignee
  const { rows: admins } = await query(
    `SELECT id FROM staff_users
     WHERE is_active = 1 AND role = 'admin'
     ORDER BY id
     LIMIT 1`
  );
  return admins[0]?.id ?? null;
}

/**
 * SQL fragment restricting reservation rows to the logged-in reservations agent.
 * Matches sales_person_id, created_by, or sales_label text close to the agent's name
 * (covers Excel imports that only stored the sales name).
 */
function reservationScopeClause(user, alias = 'r', paramIndex = 1) {
  if (!isReservationsTeam(user)) {
    return { clause: '', params: [], nextIndex: paramIndex };
  }

  const name = String(user.full_name || '').trim();
  const params = [user.id];
  let nextIndex = paramIndex + 1;

  // Own bookings: assigned sales person, creator, or sales_label text match
  let clause = ` AND (
    ${alias}.sales_person_id = $${paramIndex}
    OR ${alias}.created_by = $${paramIndex}`;

  if (name) {
    const nameParam = nextIndex;
    params.push(name);
    nextIndex += 1;
    // Normalize spaces in SQL; include containment for "Amira Hesham" vs "Amira Hesham X"
    clause += `
    OR (
      ${alias}.sales_label IS NOT NULL
      AND btrim(${alias}.sales_label) <> ''
      AND lower(btrim(${alias}.sales_label)) NOT IN ('owner')
      AND (
        lower(regexp_replace(btrim(${alias}.sales_label), '\\s+', ' ', 'g'))
          = lower(regexp_replace(btrim($${nameParam}), '\\s+', ' ', 'g'))
        OR lower(regexp_replace(btrim(${alias}.sales_label), '\\s+', ' ', 'g'))
          LIKE lower(regexp_replace(btrim($${nameParam}), '\\s+', ' ', 'g')) || ' %'
        OR lower(regexp_replace(btrim($${nameParam}), '\\s+', ' ', 'g'))
          LIKE lower(regexp_replace(btrim(${alias}.sales_label), '\\s+', ' ', 'g')) || ' %'
        OR (
          length(btrim($${nameParam})) >= 4
          AND lower(regexp_replace(btrim(${alias}.sales_label), '\\s+', ' ', 'g'))
            LIKE '%' || lower(regexp_replace(btrim($${nameParam}), '\\s+', ' ', 'g')) || '%'
        )
      )
    )`;
  }

  clause += `
  )`;

  if (user.role === 'reservations_manual') {
    clause += ` AND ${alias}.booking_id IS NULL AND LOWER(COALESCE(${alias}.booking_source, '')) <> 'website'`;
  }
  // reservations_web may own website stays and their own manual creates

  return { clause, params, nextIndex };
}

/** SQL fragment restricting website booking rows for agents.
 * Agents only see bookings assigned to them (requests + history).
 * Unassigned pool is listed separately via status=unassigned.
 */
function bookingAssigneeClause(user, alias = 'b', paramIndex = 1) {
  if (user?.role === 'reservations_manual') {
    return { clause: ' AND FALSE', params: [], nextIndex: paramIndex };
  }
  if (isAdmin(user) || !isWebsiteReservationsAgent(user)) {
    return { clause: '', params: [], nextIndex: paramIndex };
  }
  const col = alias ? `${alias}.assigned_sales_id` : 'assigned_sales_id';
  return {
    clause: ` AND ${col} = $${paramIndex}`,
    params: [user.id],
    nextIndex: paramIndex + 1,
  };
}

async function loadReservationAccess(id) {
  const { rows } = await query(
    `SELECT id, sales_person_id, created_by, booking_id, booking_source, status, sales_label
     FROM reservations WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function loadBookingAccess(id) {
  const { rows } = await query(
    `SELECT id, assigned_sales_id, status FROM bookings WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

function assertReservationOwned(user, reservation) {
  if (isAdmin(user)) return;
  if (!isReservationsTeam(user)) return;
  const mine =
    reservation &&
    (Number(reservation.sales_person_id) === Number(user.id) ||
      Number(reservation.created_by) === Number(user.id) ||
      salesLabelBelongsToUser(reservation.sales_label, user));
  if (!mine) {
    const err = new Error('You can only access your own reservations');
    err.status = 403;
    throw err;
  }
  if (user.role === 'reservations_manual' && isWebsiteOriginReservation(reservation)) {
    const err = new Error('Manual agents can only access manual reservations');
    err.status = 403;
    throw err;
  }
}

function assertBookingAssigned(user, booking) {
  if (isAdmin(user)) return;
  if (!isWebsiteReservationsAgent(user)) {
    const err = new Error('Only website reservation agents can manage website bookings');
    err.status = 403;
    throw err;
  }
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }
  if (!booking.assigned_sales_id) {
    const err = new Error('Assign this request to yourself before accepting or rejecting');
    err.status = 403;
    throw err;
  }
  if (Number(booking.assigned_sales_id) !== Number(user.id)) {
    const err = new Error('This website booking is not assigned to you');
    err.status = 403;
    throw err;
  }
}

module.exports = {
  RESERVATIONS_TEAM_ROLES,
  isReservationsTeam,
  isReservationsAgent,
  isWebsiteReservationsAgent,
  isManualReservationsAgent,
  isAdmin,
  isWebsiteOriginReservation,
  pickLeastLoadedReservationsAgent,
  reservationScopeClause,
  bookingAssigneeClause,
  loadReservationAccess,
  loadBookingAccess,
  assertReservationOwned,
  assertBookingAssigned,
  assertNotAdminReservationHandler,
};
