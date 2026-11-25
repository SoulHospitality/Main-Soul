const { query } = require('../config/db');
const { emitSalesNotification } = require('../config/socket');


const WEB_TEAM_ROLES = ['admin', 'reservations_web', 'reservations'];

const OPS_ROLES = ['admin', 'reservations_web', 'reservations_manual', 'reservations', 'reservations_manager'];
const ADMIN_ROLES = ['admin'];
const FINANCE_ROLES = ['admin', 'finance', 'finance_manager'];

async function resolveUserIds({ roles, userIds, excludeUserIds = [] } = {}) {
  const exclude = new Set(
    (excludeUserIds || [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
  );
  const ids = new Set();

  for (const raw of userIds || []) {
    const id = Number(raw);
    if (Number.isFinite(id) && id > 0 && !exclude.has(id)) ids.add(id);
  }

  if (roles?.length) {
    const { rows } = await query(
      `SELECT id FROM staff_users
       WHERE is_active = 1 AND role = ANY($1::text[])`,
      [roles]
    );
    for (const row of rows) {
      const id = Number(row.id);
      if (!exclude.has(id)) ids.add(id);
    }
  }

  return [...ids];
}


/**
 * notifications.entity_id is an integer column. Some entities (website bookings)
 * have UUID ids; writing one there makes the whole INSERT fail. Keep integer ids
 * and store null for anything else; links for those entities do not use the id.
 */
function toIntegerEntityId(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  const s = String(value).trim();
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

async function notifyStaff({
  roles,
  userIds,
  excludeUserIds,
  type,
  title,
  message,
  entity_type = null,
  entity_id = null,
  dedupeSameDay = false,
} = {}) {
  if (!type || !title || !message) return [];
  entity_id = toIntegerEntityId(entity_id);

  const ids = await resolveUserIds({ roles, userIds, excludeUserIds });
  if (!ids.length) return [];

  const created = [];
  for (const userId of ids) {
    if (dedupeSameDay && entity_type && entity_id != null) {
      const { rows: existing } = await query(
        `SELECT id FROM notifications
         WHERE user_id = $1
           AND type = $2
           AND entity_type = $3
           AND entity_id = $4
           AND created_at::date = CURRENT_DATE
         LIMIT 1`,
        [userId, type, entity_type, entity_id]
      );
      if (existing[0]) continue;
    }

    const { rows } = await query(
      `INSERT INTO notifications (user_id, type, title, message, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, type, title, message, entity_type, entity_id]
    );
    const row = rows[0];
    if (!row) continue;

    emitSalesNotification(userId, {
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      created_at: row.created_at,
    });
    created.push(row);
  }

  return created;
}

async function notifyNewWebsiteBooking(booking, { assigneeId } = {}) {
  if (!booking?.id) return [];
  const guest = booking.guest_name || 'Guest';
  const unit = booking.listing_title || booking.unit_title || booking.unit_number || 'unit';
  const guests = booking.guests != null ? `${booking.guests} guests` : null;
  const total =
    booking.total_egp != null
      ? `EGP ${Number(booking.total_egp).toLocaleString('en-EG')}`
      : null;
  const bits = [guest, unit, guests, total].filter(Boolean);

  return notifyStaff({
    roles: WEB_TEAM_ROLES,
    userIds: assigneeId ? [assigneeId] : [],
    type: 'new_booking',
    title: 'New website reservation request',
    message: bits.join(' · '),
    entity_type: 'booking',
    entity_id: booking.id,
  });
}

async function notifyWebsiteBookingAccepted(booking, actor) {
  if (!booking?.id) return [];
  const guest = booking.guest_name || 'Guest';
  const actorName = actor?.full_name || actor?.username || 'Staff';
  return notifyStaff({
    roles: ADMIN_ROLES,
    userIds: booking.assigned_sales_id ? [booking.assigned_sales_id] : [],
    excludeUserIds: [actor?.id],
    type: 'booking_accepted',
    title: 'Website booking accepted',
    message: `${guest} accepted by ${actorName}`,
    entity_type: 'booking',
    entity_id: booking.id,
  });
}

async function notifyWebsiteBookingRejected(booking, actor, reason) {
  if (!booking?.id) return [];
  const guest = booking.guest_name || 'Guest';
  const actorName = actor?.full_name || actor?.username || 'Staff';
  const reasonText = reason ? ` — ${String(reason).slice(0, 120)}` : '';
  return notifyStaff({
    roles: ADMIN_ROLES,
    userIds: booking.assigned_sales_id ? [booking.assigned_sales_id] : [],
    excludeUserIds: [actor?.id],
    type: 'booking_rejected',
    title: 'Website booking rejected',
    message: `${guest} rejected by ${actorName}${reasonText}`,
    entity_type: 'booking',
    entity_id: booking.id,
  });
}

const OPS_LEAD_ROLES = ['operations_supervisor'];

function cairoDay(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const ymd = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10));

/**
 * Operations plan arrivals, cleans and checkouts a day ahead. A booking created, moved or cancelled for today
 * or tomorrow reaches the ops and housekeeping leads (and the assigned agent) at once.
 * kind: 'created' | 'changed' | 'cancelled'.
 */
async function notifyOpsShortNotice(kind, after, before = null, actor = null) {
  try {
    const today = cairoDay(0);
    const tomorrow = cairoDay(1);
    const soon = (d) => d && d >= today && d <= tomorrow;
    const now = after || before;
    if (!now?.id) return [];
    const dates = [ymd(now.check_in), ymd(now.check_out), ymd(before?.check_in), ymd(before?.check_out)];
    if (!dates.some(soon)) return [];
    if (kind === 'changed') {
      const moved = ymd(before?.check_in) !== ymd(after?.check_in) || ymd(before?.check_out) !== ymd(after?.check_out)
        || String(before?.unit_id || '') !== String(after?.unit_id || '');
      if (!moved) return [];
    }
    const guest = now.guest_name || 'Guest';
    const span = `${ymd(now.check_in)} → ${ymd(now.check_out)}`;
    const title = kind === 'created' ? 'Short-notice booking' : kind === 'cancelled' ? 'Short-notice cancellation' : 'Short-notice change';
    const message = kind === 'changed'
      ? `${guest}: ${ymd(before?.check_in)} → ${ymd(before?.check_out)} is now ${span}`
      : `${guest}: ${span}`;
    return notifyStaff({
      roles: OPS_LEAD_ROLES,
      userIds: [now.ops_assigned_to, now.ops_checkout_assigned_to].filter(Boolean),
      excludeUserIds: [actor?.id],
      type: `ops_short_notice_${kind}`,
      title,
      message,
      entity_type: 'reservation',
      entity_id: now.id,
    });
  } catch (err) {
    console.warn('[ops notify] short notice failed', err.message);
    return [];
  }
}

async function notifyManualReservationCreated(reservation, actor) {
  if (!reservation?.id) return [];
  if (reservation.is_owner_reservation && !(Number(reservation.total_amount) > 0)) {
    return []; 
  }
  const guest = reservation.guest_name || 'Guest';
  const actorName = actor?.full_name || actor?.username || 'Staff';
  return notifyStaff({
    roles: ADMIN_ROLES,
    excludeUserIds: [actor?.id],
    type: 'reservation_created',
    title: 'New manual reservation',
    message: `${guest} created by ${actorName}`,
    entity_type: 'reservation',
    entity_id: reservation.id,
  });
}

async function notifyCancelRequest(reservation, actor, reason) {
  if (!reservation?.id) return [];
  const guest = reservation.guest_name || 'Guest';
  const actorName = actor?.full_name || actor?.username || 'Staff';
  const reasonText = reason ? ` — ${String(reason).slice(0, 120)}` : '';
  return notifyStaff({
    roles: FINANCE_ROLES,
    excludeUserIds: [actor?.id],
    type: 'cancel_request',
    title: 'Cancellation request',
    message: `${guest} — requested by ${actorName}${reasonText}`,
    entity_type: 'reservation',
    entity_id: reservation.id,
  });
}

async function notifyPaymentRecorded(payment, reservation, actor) {
  if (!payment?.id || !reservation?.id) return [];
  
  if (['admin', 'finance', 'finance_manager'].includes(actor?.role)) return [];
  const amount = Number(payment.amount) || 0;
  const guest = reservation.guest_name || 'Guest';
  const actorName = actor?.full_name || actor?.username || 'Staff';
  return notifyStaff({
    roles: FINANCE_ROLES,
    excludeUserIds: [actor?.id],
    type: 'payment_pending',
    title: 'Payment awaiting approval',
    message: `${guest} · EGP ${amount.toLocaleString('en-EG')} by ${actorName}`,
    entity_type: 'reservation',
    entity_id: reservation.id,
  });
}

module.exports = {
  notifyStaff,
  toIntegerEntityId,
  notifyNewWebsiteBooking,
  notifyWebsiteBookingAccepted,
  notifyWebsiteBookingRejected,
  notifyManualReservationCreated,
  notifyOpsShortNotice,
  notifyCancelRequest,
  notifyPaymentRecorded,
  WEB_TEAM_ROLES,
  OPS_ROLES,
  ADMIN_ROLES,
  FINANCE_ROLES,
};
