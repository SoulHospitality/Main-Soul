const { query } = require('../config/db');

function isReservationsAgent(user) {
  return user?.role === 'reservations';
}

function isAdmin(user) {
  return user?.role === 'admin';
}

function assertNotAdminReservationHandler(user, action = 'manage reservations') {
  if (isAdmin(user)) {
    const err = new Error(`Admins cannot ${action}`);
    err.status = 403;
    throw err;
  }
}

/**
 * Pick the active reservations-team member with the fewest open assignments.
 * Counts confirmed PMS reservations + pending website bookings already assigned.
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
     WHERE s.is_active = 1 AND s.role = 'reservations'
     ORDER BY COALESCE(load.cnt, 0) ASC, random()
     LIMIT 1`
  );
  return rows[0]?.id ?? null;
}

/** SQL fragment restricting reservation rows to the logged-in reservations agent. */
function reservationScopeClause(user, alias = 'r', paramIndex = 1) {
  if (!isReservationsAgent(user)) {
    return { clause: '', params: [], nextIndex: paramIndex };
  }
  return {
    clause: ` AND ${alias}.sales_person_id = $${paramIndex}`,
    params: [user.id],
    nextIndex: paramIndex + 1,
  };
}

/** SQL fragment restricting website booking rows to the assignee. */
function bookingAssigneeClause(user, alias = 'b', paramIndex = 1) {
  if (!isReservationsAgent(user)) {
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
    `SELECT id, sales_person_id, created_by, booking_id, status FROM reservations WHERE id = $1`,
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
  if (!isReservationsAgent(user)) return;
  if (!reservation || Number(reservation.sales_person_id) !== Number(user.id)) {
    const err = new Error('You can only access reservations assigned to you');
    err.status = 403;
    throw err;
  }
}

function assertBookingAssigned(user, booking) {
  if (!isReservationsAgent(user)) return;
  if (!booking || Number(booking.assigned_sales_id) !== Number(user.id)) {
    const err = new Error('This website booking is not assigned to you');
    err.status = 403;
    throw err;
  }
}

module.exports = {
  isReservationsAgent,
  isAdmin,
  pickLeastLoadedReservationsAgent,
  reservationScopeClause,
  bookingAssigneeClause,
  loadReservationAccess,
  loadBookingAccess,
  assertReservationOwned,
  assertBookingAssigned,
  assertNotAdminReservationHandler,
};
