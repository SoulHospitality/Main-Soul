const express = require('express');
const { query } = require('../config/db');
const { quoteStay } = require('../services/pricing');
const { initializePaymobCheckout } = require('../config/paymob');
const { authGuest, optionalGuest } = require('../middleware/auth');
const { upload, attachCloudinaryUrls } = require('../config/cloudinary');
const { emitSalesNotification } = require('../config/socket');

const router = express.Router();

function merchantOrderId() {
  return `TEMP_SOUL_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

router.post('/checkout', optionalGuest, upload.array('id_photos', 4), attachCloudinaryUrls, async (req, res, next) => {
  try {
    const {
      slug,
      checkin,
      checkout,
      guests,
      guest_name,
      guest_email,
      guest_phone,
      payment_method = 'paymob_card',
      notes,
      promo_code,
      callback_url,
    } = req.body;

    const { rows: units } = await query(`SELECT * FROM units WHERE slug = $1 AND status = 'published'`, [slug]);
    const unit = units[0];
    if (!unit) return res.status(404).json({ error: 'Listing not found' });

    const quote = await quoteStay({
      wpPostId: unit.wp_post_id,
      checkin,
      checkout,
      unit,
    });
    if (!quote.available) return res.status(409).json({ error: quote.reason || 'Unavailable' });

    let total = quote.total_egp;
    if (promo_code) {
      const { rows: promos } = await query(
        `SELECT * FROM promo_codes WHERE upper(code) = upper($1) AND active = true
         AND (expires_at IS NULL OR expires_at > now())`,
        [promo_code]
      );
      const promo = promos[0];
      if (promo) {
        if (promo.discount_percent) total = Math.round(total * (1 - Number(promo.discount_percent) / 100));
        if (promo.discount_amount) total = Math.max(0, total - Number(promo.discount_amount));
      }
    }

    const holdMinutes = Number(process.env.BOOKING_HOLD_MINUTES || 30);
    const holdExpires = new Date(Date.now() + holdMinutes * 60 * 1000);

    const photoUrls = (req.files || []).map((f) => f.path || f.secure_url).filter(Boolean);

    if (payment_method === 'paymob_card' || payment_method === 'card') {
      const orderId = merchantOrderId();
      const payload = {
        slug: unit.slug,
        unit_id: unit.id,
        listing_wp_id: unit.wp_post_id,
        listing_title: unit.title,
        checkin,
        checkout,
        guests: Number(guests),
        guest_name,
        guest_email,
        guest_phone,
        total_egp: total,
        notes,
        photo_urls: photoUrls,
        user_id: req.guest?.id || null,
      };

      const paymob = await initializePaymobCheckout({
        amountEgp: total,
        merchantOrderId: orderId,
        billing: {
          email: guest_email,
          phone: guest_phone,
          firstName: String(guest_name || 'Guest').split(' ')[0],
          lastName: String(guest_name || 'Soul').split(' ').slice(1).join(' ') || 'Guest',
        },
      });

      await query(
        `INSERT INTO card_checkout_sessions
          (merchant_order_id, paymob_order_id, paymob_payment_key, amount_cents, currency, payload, payment_url, status)
         VALUES ($1,$2,$3,$4,'EGP',$5,$6,'pending')`,
        [orderId, paymob.paymobOrderId, paymob.paymentKey, paymob.amountCents, JSON.stringify(payload), paymob.checkoutUrl]
      );

      return res.json({
        mode: 'paymob',
        redirectToPaymob: true,
        checkoutUrl: paymob.checkoutUrl,
        merchantOrderId: orderId,
        callback_url: callback_url || `${process.env.FRONTEND_URL}/checkout/payment/callback`,
      });
    }

    // cash / instapay — pending hold awaiting staff Accept
    const { rows } = await query(
      `INSERT INTO bookings
        (listing_slug, listing_wp_id, listing_title, checkin, checkout, guests, total_egp,
         guest_name, guest_email, guest_phone, status, notes, currency, hold_expires_at,
         payment_status, payment_method, unit_id, id_photo_urls)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,'EGP',$12,'pending',$13,$14,$15)
       RETURNING *`,
      [
        unit.slug,
        unit.wp_post_id,
        unit.title,
        checkin,
        checkout,
        Number(guests),
        total,
        guest_name,
        guest_email,
        guest_phone,
        notes,
        holdExpires,
        payment_method,
        unit.id,
        photoUrls,
      ]
    );

    const booking = rows[0];
    try {
      const { assignSalesOnCreate } = require('../services/bookingWorkflow');
      await assignSalesOnCreate(booking.id);
    } catch (_) {
      /* optional */
    }
    await notifySales(booking);

    res.status(201).json({ mode: 'hold', booking, message: 'Request received — awaiting confirmation' });
  } catch (err) {
    next(err);
  }
});

router.get('/mine', authGuest, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT b.* FROM bookings b
       LEFT JOIN profiles p ON p.email = b.guest_email
       WHERE (p.id = $1 OR b.guest_email = $2)
         AND b.status <> 'cancelled'
       ORDER BY b.created_at DESC`,
      [req.guest.id, req.guest.email]
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

async function notifySales(booking) {
  const { rows } = await query(
    `SELECT id FROM staff_users WHERE role IN ('reservations','admin') AND is_active = 1`
  );
  for (const u of rows) {
    await query(
      `INSERT INTO sales_notifications (user_id, title, message, meta)
       VALUES ($1,$2,$3,$4)`,
      [
        u.id,
        'New booking request',
        `${booking.guest_name} — ${booking.listing_title} (awaiting Accept)`,
        JSON.stringify({ booking_id: booking.id }),
      ]
    );
    emitSalesNotification(u.id, {
      title: 'New booking request',
      message: `${booking.guest_name} — ${booking.listing_title}`,
      bookingId: booking.id,
    });
  }
}

module.exports = router;
module.exports.notifySales = notifySales;
