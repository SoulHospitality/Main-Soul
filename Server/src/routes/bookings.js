const express = require('express');
const { query } = require('../config/db');
const { quoteStay } = require('../services/pricing');
const { initializePaymobCheckout } = require('../config/paymob');
const { authGuest } = require('../middleware/auth');
const { upload, attachCloudinaryUrls } = require('../config/cloudinary');
const { emitSalesNotification } = require('../config/socket');

const router = express.Router();

function merchantOrderId() {
  return `TEMP_SOUL_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

router.post('/checkout', authGuest, upload.array('id_photos', 4), attachCloudinaryUrls, async (req, res, next) => {
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

    res.status(201).json({ mode: 'hold', booking, message: 'Request received — awaiting confirmation' });
  } catch (err) {
    next(err);
  }
});

router.get('/mine', authGuest, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT b.*,
              u.unit_number,
              u.title AS unit_title,
              u.slug AS unit_slug,
              r.id AS reservation_id,
              CASE
                WHEN b.status = 'confirmed'
                 AND CURRENT_DATE >= b.checkin::date
                 AND CURRENT_DATE < b.checkout::date
                THEN true ELSE false
              END AS is_current_stay,
              (
                SELECT count(*)::int FROM housekeeping_tasks ht
                WHERE ht.booking_id = b.id AND ht.source = 'guest_request'
              ) AS guest_housekeeping_count,
              EXISTS (
                SELECT 1 FROM housekeeping_tasks ht
                WHERE ht.booking_id = b.id
                  AND ht.source = 'guest_request'
                  AND ht.status IN ('pending', 'accepted', 'in_progress', 'submitted', 'needs_reclean')
              ) AS has_pending_housekeeping
       FROM bookings b
       LEFT JOIN profiles p ON p.email = b.guest_email
       LEFT JOIN units u ON u.id = b.unit_id
       LEFT JOIN reservations r ON r.booking_id = b.id
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

/** Guest mid-stay housekeeping request — appears on PMS Housekeeping tasks */
router.post('/:id/housekeeping-request', authGuest, async (req, res, next) => {
  try {
    const timeLabel = String(req.body?.time || req.body?.requested_time || '').trim();
    const serviceDate = String(req.body?.date || req.body?.service_date || '')
      .trim()
      .slice(0, 10);

    const allowedTimes = [];
    for (let h = 3; h <= 23; h++) {
      const hour12 = h % 12 === 0 ? 12 : h % 12;
      const suffix = h < 12 ? 'AM' : 'PM';
      allowedTimes.push(`${hour12}:00 ${suffix}`);
    }
    if (!allowedTimes.includes(timeLabel)) {
      return res.status(400).json({ error: 'Choose a time between 3:00 AM and 11:00 PM' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
      return res.status(400).json({ error: 'A valid service date is required' });
    }

    const { rows: bookings } = await query(
      `SELECT b.*, u.unit_number, r.id AS reservation_id
       FROM bookings b
       LEFT JOIN profiles p ON p.email = b.guest_email
       LEFT JOIN units u ON u.id = b.unit_id
       LEFT JOIN reservations r ON r.booking_id = b.id
       WHERE b.id = $1
         AND (p.id = $2 OR b.guest_email = $3)
       LIMIT 1`,
      [req.params.id, req.guest.id, req.guest.email]
    );
    const booking = bookings[0];
    if (!booking) return res.status(404).json({ error: 'Reservation not found' });
    if (booking.status !== 'confirmed') {
      return res.status(400).json({ error: 'Only accepted reservations can request housekeeping' });
    }
    if (!booking.unit_id) {
      return res.status(400).json({ error: 'This reservation has no unit assigned' });
    }

    const checkin = String(booking.checkin).slice(0, 10);
    const checkout = String(booking.checkout).slice(0, 10);
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (todayIso < checkin || todayIso >= checkout) {
      return res.status(400).json({
        error: 'Housekeeping can only be requested during your stay',
      });
    }
    if (serviceDate < checkin || serviceDate >= checkout) {
      return res.status(400).json({
        error: 'Pick a date within your reservation dates',
      });
    }

    const { rows: pendingRows } = await query(
      `SELECT id, status, requested_time
       FROM housekeeping_tasks
       WHERE booking_id = $1
         AND source = 'guest_request'
         AND status IN ('pending', 'accepted', 'in_progress', 'submitted', 'needs_reclean')
       ORDER BY created_at DESC
       LIMIT 1`,
      [booking.id]
    );
    if (pendingRows[0]) {
      return res.status(409).json({
        error:
          'You already have a housekeeping request in progress. Wait until it is completed before requesting another.',
        pending_task_id: pendingRows[0].id,
        pending_status: pendingRows[0].status,
        requested_time: pendingRows[0].requested_time,
      });
    }

    // Parse 3:00 AM style into 24h for due_at
    const m = timeLabel.match(/^(\d{1,2}):00\s*(AM|PM)$/i);
    let hour24 = Number(m[1]);
    const meridiem = m[2].toUpperCase();
    if (meridiem === 'AM') {
      if (hour24 === 12) hour24 = 0;
    } else if (hour24 !== 12) {
      hour24 += 12;
    }
    const dueAt = `${serviceDate}T${String(hour24).padStart(2, '0')}:00:00`;

    const { DEFAULT_CHECKLIST } = require('../jobs/housekeepingTasks');
    const note = [
      'Guest mid-stay housekeeping request',
      `Unit: ${booking.unit_number || booking.unit_id}`,
      `Requested time: ${timeLabel} on ${serviceDate}`,
      `Phone: ${booking.guest_phone || '—'}`,
    ].join('\n');

    const { rows } = await query(
      `INSERT INTO housekeeping_tasks (
         reservation_id, unit_id, booking_id, status, checklist, due_at,
         notes, source, requested_time
       ) VALUES ($1,$2,$3,'pending',$4::jsonb,$5::timestamptz,$6,'guest_request',$7)
       RETURNING *`,
      [
        booking.reservation_id || null,
        booking.unit_id,
        booking.id,
        JSON.stringify(DEFAULT_CHECKLIST),
        dueAt,
        note,
        `${serviceDate} ${timeLabel}`,
      ]
    );

    res.status(201).json({ ok: true, task: rows[0] });
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
