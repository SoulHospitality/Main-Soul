const { query } = require('../config/db');
const { emitSalesNotification } = require('../config/socket');
const { sendBookingAcceptedEmail } = require('./guestEmails');
const {
  pickLeastLoadedReservationsAgent,
  assertBookingAssigned,
  isReservationsAgent,
  isAdmin,
} = require('../lib/reservationScope');

async function pickSalesAssignee() {
  return pickLeastLoadedReservationsAgent();
}

async function acceptWebsiteBooking(bookingId, staffUser) {
  if (isAdmin(staffUser)) {
    const err = new Error('Admins cannot accept website bookings');
    err.status = 403;
    throw err;
  }

  const { rows } = await query(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
  const booking = rows[0];
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }
  if (!['pending', 'held'].includes(booking.status)) {
    const err = new Error(`Cannot accept booking in status ${booking.status}`);
    err.status = 409;
    throw err;
  }

  assertBookingAssigned(staffUser, booking);

  let commissionNote = null;
  if (booking.unit_id) {
    const { rows: units } = await query(`SELECT * FROM units WHERE id = $1`, [booking.unit_id]);
    const unit = units[0];
    if (unit) {
      commissionNote = JSON.stringify({
        commission_mode: unit.commission_mode,
        company_commission_pct: unit.company_commission_pct,
        company_commission_owner_pct: unit.company_commission_owner_pct,
        commission_tenant_pct: unit.commission_tenant_pct,
        accepted_by: staffUser?.id || null,
        accepted_at: new Date().toISOString(),
      });
    }
  }

  const assignee =
    booking.assigned_sales_id ||
    (isReservationsAgent(staffUser) ? staffUser.id : null) ||
    (await pickLeastLoadedReservationsAgent());

  const { rows: updated } = await query(
    `UPDATE bookings SET
       status = 'confirmed',
       hold_expires_at = NULL,
       assigned_sales_id = COALESCE(assigned_sales_id, $3),
       notes = CASE
         WHEN $2::text IS NULL THEN notes
         ELSE COALESCE(notes || E'\n', '') || ('[commission] ' || $2::text)
       END
     WHERE id = $1
     RETURNING *`,
    [bookingId, commissionNote, assignee]
  );

  // Mirror into PMS reservations when linked to a unit
  if (booking.unit_id) {
    const nights = Math.max(
      1,
      Math.round((new Date(booking.checkout) - new Date(booking.checkin)) / 86400000)
    );
    const createdBy = staffUser?.id || assignee;
    if (!createdBy) {
      const err = new Error('No staff user available to own reservation');
      err.status = 400;
      throw err;
    }
    const existing = await query(`SELECT id FROM reservations WHERE booking_id = $1`, [bookingId]);
    if (!existing.rows[0]) {
      const pricePerNight = nights > 0 ? (Number(booking.total_egp) || 0) / nights : 0;
      let utilitiesAmount = 0;
      let housekeepingFees = 0;
      if (booking.unit_id) {
        const { rows: units } = await query(
          `SELECT utilities_cost, property_type FROM units WHERE id = $1`,
          [booking.unit_id]
        );
        const { housekeepingFeeForUnit } = require('../lib/housekeeping');
        housekeepingFees = housekeepingFeeForUnit(units[0]);
        const costPerNight = parseFloat(units[0]?.utilities_cost) || 0;
        if (costPerNight > 0) utilitiesAmount = costPerNight * nights;
      }
      await query(
        `INSERT INTO reservations (
           unit_id, guest_name, guest_email, guest_phone, check_in, check_out, nights,
           total_amount, amount_paid, payment_status, booking_source, sales_person_id,
           status, notes, booking_id, created_by, id_photo_urls, price_per_night,
           utilities_amount, housekeeping_fees
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Website',$11,'confirmed',$12,$13,$14,$15,$16,$17,$18)`,
        [
          booking.unit_id,
          booking.guest_name,
          booking.guest_email,
          booking.guest_phone,
          booking.checkin,
          booking.checkout,
          nights,
          booking.total_egp || 0,
          booking.payment_status === 'paid' ? booking.total_egp || 0 : 0,
          booking.payment_status === 'paid' ? 'paid' : 'pending',
          assignee || createdBy,
          booking.notes,
          bookingId,
          createdBy,
          booking.id_photo_urls || [],
          pricePerNight,
          utilitiesAmount,
          housekeepingFees,
        ]
      );
    } else {
      await query(
        `UPDATE reservations
         SET status = 'confirmed',
             sales_person_id = COALESCE(sales_person_id, $2),
             updated_at = now()
         WHERE booking_id = $1`,
        [bookingId, assignee]
      );
    }
  }

  try {
    await sendBookingAcceptedEmail(updated[0]);
  } catch (emailErr) {
    console.error('[email] Acceptance email failed:', emailErr.message);
  }

  try {
    const { awardPointsForBooking } = require('../lib/soulPoints');
    await awardPointsForBooking(updated[0], { reason: 'reservation_accepted' });
  } catch (pointsErr) {
    console.error('[points] Award failed:', pointsErr.message);
  }

  return updated[0];
}

/**
 * Cancel a guest website booking (any active status).
 * Used when staff delete/cancel a PMS reservation so availability + My Trips stay in sync.
 */
async function cancelWebsiteBooking(bookingId, reason = 'cancelled_by_staff') {
  if (!bookingId) return null;

  const { rows: updated } = await query(
    `UPDATE bookings SET
       status = 'cancelled',
       hold_expires_at = NULL,
       cancellation_reason = COALESCE($2, cancellation_reason),
       payment_status = CASE
         WHEN payment_status = 'paid' THEN 'refund_noted'
         ELSE payment_status
       END
     WHERE id = $1
       AND status IN ('confirmed', 'pending', 'held')
     RETURNING *`,
    [bookingId, reason]
  );

  return updated[0] || null;
}

async function rejectWebsiteBooking(bookingId, staffUser, reason = 'rejected_by_staff') {
  if (isAdmin(staffUser)) {
    const err = new Error('Admins cannot reject website bookings');
    err.status = 403;
    throw err;
  }

  const { rows } = await query(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
  const booking = rows[0];
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }
  if (!['pending', 'held'].includes(booking.status)) {
    const err = new Error(`Cannot reject booking in status ${booking.status}`);
    err.status = 409;
    throw err;
  }

  assertBookingAssigned(staffUser, booking);

  const updated = await cancelWebsiteBooking(bookingId, reason);

  await query(
    `UPDATE reservations SET status = 'cancelled', updated_at = now() WHERE booking_id = $1`,
    [bookingId]
  );

  return updated;
}

async function assignSalesOnCreate(bookingId) {
  const assignee = await pickLeastLoadedReservationsAgent();
  if (!assignee) return null;

  await query(`UPDATE bookings SET assigned_sales_id = $1 WHERE id = $2`, [assignee, bookingId]);

  await query(
    `INSERT INTO sales_notifications (user_id, title, message, meta)
     VALUES ($1,$2,$3,$4)`,
    [
      assignee,
      'New website booking',
      'A guest request was assigned to you',
      JSON.stringify({ booking_id: bookingId, assigned: true }),
    ]
  );
  emitSalesNotification(assignee, {
    title: 'New website booking',
    message: 'A guest request was assigned to you',
    bookingId,
  });
  return assignee;
}

module.exports = {
  acceptWebsiteBooking,
  rejectWebsiteBooking,
  cancelWebsiteBooking,
  pickSalesAssignee,
  assignSalesOnCreate,
};
