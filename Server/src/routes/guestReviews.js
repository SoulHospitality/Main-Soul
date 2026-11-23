/**
 * Guest rating page (/rate/:token on the website): the guest rates the stay out of 5. A 5-star rating
 * is offered the Google Reviews link; a rating of 3 or less alerts the operations leads.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('../config/db');
const { loadSettings, getSettings } = require('../lib/inbox/settings');

const router = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

async function byToken(token) {
  if (!/^[a-f0-9]{24,64}$/.test(String(token || ''))) return null;
  const { rows } = await query(
    `SELECT g.*, r.guest_name, r.check_in::text AS check_in, r.check_out::text AS check_out,
            COALESCE(u.title, u.unit_number) AS unit_title, COALESCE(u.project, u.compound) AS project
     FROM guest_reviews g JOIN reservations r ON r.id = g.reservation_id JOIN units u ON u.id = r.unit_id
     WHERE g.token = $1`,
    [token]
  );
  return rows[0] || null;
}

async function googleUrl() {
  await loadSettings();
  return String(getSettings().google_review_url || '').trim() || null;
}

function view(row, google) {
  return {
    guest_first_name: String(row.guest_name || '').trim().split(/\s+/)[0] || null,
    unit_title: row.unit_title,
    project: row.project,
    check_in: row.check_in,
    check_out: row.check_out,
    rating: row.rating,
    comment: row.comment,
    rated: row.rating != null,
    // Only a rating above 4 is offered the Google Reviews link.
    google_review_url: row.rating > 4 ? google : null,
  };
}

router.get('/:token', limiter, async (req, res, next) => {
  try {
    const row = await byToken(req.params.token);
    if (!row) return res.status(404).json({ error: 'This link is not valid' });
    res.json(view(row, await googleUrl()));
  } catch (err) {
    next(err);
  }
});

router.post('/:token', limiter, async (req, res, next) => {
  try {
    const row = await byToken(req.params.token);
    if (!row) return res.status(404).json({ error: 'This link is not valid' });
    if (row.rating != null) return res.status(409).json({ error: 'You already rated this stay. Thank you!', ...view(row, await googleUrl()) });
    const rating = Number(req.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'Choose 1 to 5 stars' });
    const comment = String(req.body?.comment || '').trim().slice(0, 2000) || null;
    const google = await googleUrl();
    const { rows } = await query(
      `UPDATE guest_reviews SET rating = $2, comment = $3, rated_at = now(), google_offered = $4 WHERE id = $1 AND rating IS NULL RETURNING *`,
      [row.id, rating, comment, Boolean(google) && rating > 4]
    );
    if (!rows.length) return res.status(409).json({ error: 'You already rated this stay. Thank you!' });
    if (rating <= 3) {
      const { notifyStaff } = require('../services/pmsNotifications');
      notifyStaff({
        roles: ['admin', 'operations_supervisor'],
        type: 'guest_low_rating',
        title: `Guest rated ${rating}/5`,
        message: `${row.guest_name || 'Guest'} · ${row.unit_title}${comment ? `: ${comment.slice(0, 200)}` : ''}`,
        entity_type: 'reservation',
        entity_id: row.reservation_id,
      }).catch((err) => console.warn('[reviews] alert failed:', err.message));
    }
    res.json(view({ ...row, ...rows[0] }, google));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
