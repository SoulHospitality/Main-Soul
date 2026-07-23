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

async function acceptWebsiteBooking(bookingId, staffUser, options = {}) {
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

  const total = Number(booking.total_egp) || 0;
  const method = String(booking.payment_method || '').toLowerCase();
  const alreadyPaid =
    booking.payment_status === 'paid' || method.includes('paymob') || method.includes('card');

  let amountPaid = alreadyPaid ? total : Number(options.amountPaid);
  const evidenceUrl = options.evidenceUrl || null;
  const evidenceName = options.evidenceName || null;
  const paymentMode = String(options.paymentMode || '').toLowerCase();

  if (!alreadyPaid) {
    if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
      const err = new Error('Enter how much the guest paid (at least 50% of total)');
      err.status = 400;
      throw err;
    }
    const minDeposit = Math.round(total * 0.5 * 100) / 100;
    if (amountPaid + 0.009 < minDeposit) {
      const err = new Error(
        `InstaPay/Cash bookings require at least 50% deposit (EGP ${minDeposit.toLocaleString()}). Received EGP ${amountPaid.toLocaleString()}.`
      );
      err.status = 400;
      throw err;
    }
    if (amountPaid > total + 0.5) {
      const err = new Error('Paid amount cannot exceed the reservation total');
      err.status = 400;
      throw err;
    }
    if (!evidenceUrl) {
      const err = new Error('Upload payment evidence before accepting InstaPay/Cash bookings');
      err.status = 400;
      throw err;
    }
  } else {
    amountPaid = total;
  }

  const remaining = Math.max(0, Math.round((total - amountPaid) * 100) / 100);
  const paymentStatus =
    remaining <= 0.5 ? 'paid' : amountPaid > 0 ? 'partial' : 'pending';

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
        deposit_mode: paymentMode || (alreadyPaid ? 'prepaid' : 'manual'),
        amount_paid: amountPaid,
        remaining,
      });
    }
  }

  const assignee =
    booking.assigned_sales_id ||
    (isReservationsAgent(staffUser) ? staffUser.id : null) ||
    (await pickLeastLoadedReservationsAgent());

  const depositNote = alreadyPaid
    ? null
    : `[deposit] mode=${paymentMode || 'custom'} paid=${amountPaid} remaining=${remaining}`;

  const { rows: updated } = await query(
    `UPDATE bookings SET
       status = 'confirmed',
       hold_expires_at = NULL,
       payment_status = $4,
       assigned_sales_id = COALESCE(assigned_sales_id, $3),
       notes = CASE
         WHEN $2::text IS NULL AND $5::text IS NULL THEN notes
         ELSE COALESCE(notes || E'\n', '')
           || COALESCE(('[commission] ' || $2::text), '')
           || CASE WHEN $2::text IS NOT NULL AND $5::text IS NOT NULL THEN E'\n' ELSE '' END
           || COALESCE($5::text, '')
       END
     WHERE id = $1
     RETURNING *`,
    [bookingId, commissionNote, assignee, paymentStatus, depositNote]
  );

  // Mirror into PMS reservations when linked to a unit
  let reservationId = null;
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
      let pricePerNight = 0;
      let utilitiesAmount = 0;
      let housekeepingFees = 0;
      let stayTotal = Number(booking.total_egp) || 0;

      const { rows: units } = await query(`SELECT * FROM units WHERE id = $1`, [booking.unit_id]);
      const unit = units[0];
      if (unit) {
        const { housekeepingFeeForUnit } = require('../lib/housekeeping');
        housekeepingFees = housekeepingFeeForUnit(unit);
        const costPerNight = parseFloat(unit.utilities_cost) || 0;
        if (costPerNight > 0) utilitiesAmount = costPerNight * nights;

        try {
          const { quoteStay } = require('./pricing');
          const quote = await quoteStay({
            wpPostId: unit.wp_post_id,
            checkin: booking.checkin,
            checkout: booking.checkout,
            unit,
            adults: Number(booking.guests) || 1,
            teens: 0,
            skipBlockCheck: true,
          });
          if (quote?.available) {
            pricePerNight = nights > 0 ? Number(quote.subtotal || 0) / nights : 0;
            housekeepingFees = Number(quote.cleaning_fee_egp) || housekeepingFees;
            stayTotal = Number(quote.total_egp) || stayTotal;
          }
        } catch (_) {
          /* fall back below */
        }
      }

      if (!(pricePerNight > 0) && stayTotal > 0) {
        const { ownerAccommodationGross } = require('../lib/commission');
        const nightsGross = ownerAccommodationGross(
          {
            nights,
            total_amount: stayTotal,
            housekeeping_fees: housekeepingFees,
            utilities_amount: utilitiesAmount,
          },
          unit || {}
        );
        pricePerNight = nights > 0 ? nightsGross / nights : 0;
      }

      // Recompute remaining against stayTotal if quote adjusted total
      const paidCap = Math.min(amountPaid, stayTotal);
      const rem = Math.max(0, Math.round((stayTotal - paidCap) * 100) / 100);
      const resPayStatus = rem <= 0.5 ? 'paid' : paidCap > 0 ? 'partial' : 'pending';

      const { rows: inserted } = await query(
        `INSERT INTO reservations (
           unit_id, guest_name, guest_email, guest_phone, check_in, check_out, nights,
           total_amount, amount_paid, payment_status, booking_source, sales_person_id,
           status, notes, booking_id, created_by, id_photo_urls, price_per_night,
           utilities_amount, housekeeping_fees, transfer_proof_path, transfer_proof_name,
           down_payment
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Website',$11,'confirmed',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         RETURNING id`,
        [
          booking.unit_id,
          booking.guest_name,
          booking.guest_email,
          booking.guest_phone,
          booking.checkin,
          booking.checkout,
          nights,
          stayTotal,
          paidCap,
          resPayStatus,
          assignee || createdBy,
          booking.notes,
          bookingId,
          createdBy,
          booking.id_photo_urls || [],
          pricePerNight,
          utilitiesAmount,
          housekeepingFees,
          evidenceUrl,
          evidenceName,
          paidCap,
        ]
      );
      reservationId = inserted[0]?.id || null;
    } else {
      reservationId = existing.rows[0].id;
      await query(
        `UPDATE reservations
         SET status = 'confirmed',
             sales_person_id = COALESCE(sales_person_id, $2),
             amount_paid = GREATEST(COALESCE(amount_paid, 0), $3),
             payment_status = $4,
             transfer_proof_path = COALESCE($5, transfer_proof_path),
             transfer_proof_name = COALESCE($6, transfer_proof_name),
             down_payment = COALESCE(down_payment, $3),
             updated_at = now()
         WHERE booking_id = $1`,
        [bookingId, assignee, amountPaid, paymentStatus, evidenceUrl, evidenceName]
      );
    }
  }

  // Record deposit payment row for InstaPay / cash accepts
  if (!alreadyPaid && amountPaid > 0) {
    try {
      const payMethod = method.includes('instapay')
        ? 'instapay'
        : method.includes('cash')
          ? 'cash'
          : 'bank_transfer';
      await query(
        `INSERT INTO payments (
           reservation_id, booking_id, amount, payment_date, payment_method,
           reference_number, notes, document_path, document_name, created_by,
           status, is_approved, approved_by, approved_at
         ) VALUES ($1,$2,$3,CURRENT_DATE,$4,$5,$6,$7,$8,$9,'successful',1,$9,now())`,
        [
          reservationId,
          bookingId,
          amountPaid,
          payMethod,
          paymentMode || 'deposit',
          `Accept deposit (${paymentMode || 'custom'}) — remaining EGP ${remaining}`,
          evidenceUrl,
          evidenceName,
          staffUser.id,
        ]
      );
    } catch (payErr) {
      console.error('[accept] payment insert failed:', payErr.message);
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

  return {
    ...updated[0],
    amount_paid: amountPaid,
    remaining,
    payment_status: paymentStatus,
    reservation_id: reservationId,
  };
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
