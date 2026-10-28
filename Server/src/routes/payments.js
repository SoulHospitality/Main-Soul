const express = require('express');
const { pool } = require('../config/db');
const { verifyPaymobHmac } = require('../config/paymob');

const router = express.Router();

router.post('/paymob-webhook', async (req, res, next) => {
  try {
    const hmac = req.query.hmac || req.headers['hmac'] || req.body.hmac;
    const body = req.body;
    const ok = verifyPaymobHmac(body, hmac);
    if (!ok) return res.status(401).json({ error: 'Invalid HMAC' });

    const obj = body.obj || body;
    const success = obj.success === true || obj.success === 'true';
    const merchantOrderId =
      obj.order?.merchant_order_id ||
      body.merchant_order_id ||
      obj.merchant_order_id;

    if (!merchantOrderId) return res.status(400).json({ error: 'Missing merchant_order_id' });

    const client = await pool.connect();
    let booking = null;
    let checkoutPayload = null;
    try {
      await client.query('BEGIN');
      const { rows: sessions } = await client.query(
        `SELECT * FROM card_checkout_sessions WHERE merchant_order_id = $1 FOR UPDATE`,
        [merchantOrderId]
      );
      const session = sessions[0];
      if (!session) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Session not found' });
      }
      if (session.status === 'paid') {
        await client.query('COMMIT');
        return res.json({ ok: true, duplicate: true });
      }

      if (!success) {
        await client.query(
          `UPDATE card_checkout_sessions SET status = 'failed', updated_at = now() WHERE id = $1`,
          [session.id]
        );
        await client.query('COMMIT');
        return res.json({ ok: true, status: 'failed' });
      }

      const paidCents = Number(obj.amount_cents);
      if (Number.isFinite(paidCents) && paidCents !== Number(session.amount_cents)) {
        await client.query(
          `UPDATE card_checkout_sessions SET status = 'failed', updated_at = now() WHERE id = $1`,
          [session.id]
        );
        await client.query('COMMIT');
        return res.status(409).json({ error: 'Paid amount does not match the checkout session' });
      }

      const payload = typeof session.payload === 'string' ? JSON.parse(session.payload) : session.payload;
      checkoutPayload = payload;
      let datesTaken = false;
      if (payload.unit_id && payload.checkin && payload.checkout) {
        const { rows: clash } = await client.query(
          `SELECT id FROM reservations
           WHERE unit_id = $1
             AND status <> 'cancelled'
             AND check_in < $3::date
             AND check_out > $2::date
           LIMIT 1`,
          [payload.unit_id, payload.checkin, payload.checkout]
        );
        datesTaken = Boolean(clash[0]);
      }
      const stayNotes = [
        payload.notes || null,
        datesTaken
          ? 'NEEDS ATTENTION: these dates were taken while the guest was paying. Review the stay before confirming it.'
          : null,
      ].filter(Boolean).join('\n');
      const photoUrls = Array.isArray(payload.photo_urls) ? payload.photo_urls.filter(Boolean) : [];
      const adultCount = Math.max(
        1,
        parseInt(payload.adults, 10) || parseInt(payload.guests, 10) || 1
      );
      const childCount = Math.max(0, parseInt(payload.children ?? payload.teens, 10) || 0);
      const nannyCount = Math.max(0, parseInt(payload.nanny_count, 10) || 0);
      const guestTotal =
        Math.max(Number(payload.guests) || 0, adultCount + childCount + nannyCount) || adultCount;

      const { rows: bookings } = await client.query(
        `INSERT INTO bookings
          (listing_slug, listing_wp_id, listing_title, checkin, checkout, guests, total_egp,
           guest_name, guest_email, guest_phone, status, notes, currency, hold_expires_at,
           payment_status, payment_method, unit_id, id_photo_urls,
           adults, children, nanny_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,'EGP',NULL,'paid','paymob_card',$12,$13,$14,$15,$16)
         RETURNING *`,
        [
          payload.slug,
          payload.listing_wp_id,
          payload.listing_title,
          payload.checkin,
          payload.checkout,
          guestTotal,
          payload.total_egp,
          payload.guest_name,
          payload.guest_email,
          payload.guest_phone,
          stayNotes || null,
          payload.unit_id,
          photoUrls,
          adultCount,
          childCount,
          nannyCount,
        ]
      );
      booking = bookings[0];

      await client.query(
        `INSERT INTO payments
          (booking_id, amount, payment_date, payment_method, status, transaction_reference, paid_at, is_approved)
         VALUES ($1,$2,CURRENT_DATE,'paymob_card','successful',$3,now(),1)`,
        [booking.id, payload.total_egp, String(obj.id || obj.order?.id || '')]
      );

      await client.query(
        `UPDATE card_checkout_sessions
         SET status = 'paid', booking_id = $1, updated_at = now()
         WHERE id = $2`,
        [booking.id, session.id]
      );
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) { /* connection already failed */ }
      throw err;
    } finally {
      client.release();
    }

    if (checkoutPayload?.promo_code && booking) {
      try {
        const { redeemPromo } = require('../lib/promoCodes');
        await redeemPromo({
          code: checkoutPayload.promo_code,
          email: checkoutPayload.guest_email,
          phone: checkoutPayload.guest_phone,
          guestId: checkoutPayload.user_id,
          bookingId: booking.id,
          amountBeforeDiscount: checkoutPayload.amount_before_promo || checkoutPayload.total_egp,
        });
      } catch (promoErr) {
        console.warn('[payments] promo redeem failed', promoErr.message);
      }
    }

    try {
      const { assignSalesOnCreate } = require('../services/bookingWorkflow');
      await assignSalesOnCreate(booking.id);
    } catch (_) {}

    res.json({ ok: true, booking_id: booking.id });
  } catch (err) {
    next(err);
  }
});

router.get('/paymob-callback', async (req, res) => {
  
  const success = req.query.success === 'true';
  const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
  res.redirect(`${frontend}/checkout/payment/callback?status=${success ? 'success' : 'failed'}`);
});

module.exports = router;
