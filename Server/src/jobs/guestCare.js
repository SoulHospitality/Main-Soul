/**
 * Guest care, every day (Cairo time). Each part is switched on in Live Inbox → Settings → Chatbot & guest care.
 * - The day before arrival: a reminder email (time, location, host).
 * - After checkout: a rating request out of 5; a 5-star rating is offered the Google Reviews link.
 * - Guests who haven't come back within their usual gap: an invitation back (with the current promo code).
 * - Guests with too many cancelled stays are blocked from the chatbot.
 * WhatsApp joins these once it is activated.
 */
const cron = require('node-cron');
const crypto = require('crypto');
const { query } = require('../config/db');
const { loadSettings, getSettings } = require('../lib/inbox/settings');
const { autoBlockByCancellations } = require('../lib/chatbot/guests');
const { sendPrearrivalEmail, sendReviewRequestEmail, sendReengageEmail } = require('../services/guestCareEmails');

const TZ = 'Africa/Cairo';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const TAIL = (col) => `right(regexp_replace(COALESCE(${col}, ''), '\\D', '', 'g'), 10)`;

async function logOutreach(kind, reservationId, recipient, status, error = null) {
  await query(
    `INSERT INTO guest_outreach (kind, reservation_id, recipient, status, error) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (kind, reservation_id) DO NOTHING`,
    [kind, reservationId, recipient, status, error ? String(error).slice(0, 500) : null]
  );
}

async function runPrearrival() {
  await loadSettings();
  if (!getSettings().guest_prearrival_enabled) return { skipped: 'off' };
  const { rows } = await query(
    `SELECT r.id, r.guest_name, r.guest_email, r.check_in::text AS check_in, r.check_out::text AS check_out,
            COALESCE(u.title, u.unit_number, 'your home') AS unit_title, COALESCE(u.project, u.compound) AS project,
            lp.location_url, a.full_name AS agent_name
     FROM reservations r
     JOIN units u ON u.id = r.unit_id
     LEFT JOIN location_projects lp ON lower(trim(lp.name)) = lower(trim(COALESCE(u.project, u.compound)))
     LEFT JOIN staff_users a ON a.id = r.ops_assigned_to
     WHERE r.check_in::date = $1::date + 1
       AND r.status IS DISTINCT FROM 'cancelled'
       AND COALESCE(trim(r.guest_email), '') LIKE '%@%'
       AND NOT EXISTS (SELECT 1 FROM guest_outreach o WHERE o.kind = 'prearrival' AND o.reservation_id = r.id)
     LIMIT 200`,
    [today()]
  );
  let sent = 0;
  for (const r of rows) {
    try {
      await sendPrearrivalEmail(r);
      await logOutreach('prearrival', r.id, r.guest_email, 'sent');
      sent += 1;
    } catch (err) {
      await logOutreach('prearrival', r.id, r.guest_email, 'failed', err.message);
    }
  }
  return { sent, candidates: rows.length };
}

async function runReviewRequests() {
  await loadSettings();
  if (!getSettings().guest_review_enabled) return { skipped: 'off' };
  // Stays that ended in the last three days (the guest has left), not yet asked.
  const { rows } = await query(
    `SELECT r.id, r.guest_name, r.guest_email, COALESCE(u.title, u.unit_number, 'your stay') AS unit_title
     FROM reservations r JOIN units u ON u.id = r.unit_id
     WHERE r.status IS DISTINCT FROM 'cancelled'
       AND r.check_out::date BETWEEN $1::date - 3 AND $1::date
       AND (r.check_out::date < $1::date OR r.status = 'checked_out')
       AND COALESCE(trim(r.guest_email), '') LIKE '%@%'
       AND NOT EXISTS (SELECT 1 FROM guest_reviews g WHERE g.reservation_id = r.id)
     LIMIT 200`,
    [today()]
  );
  let sent = 0;
  for (const r of rows) {
    const token = crypto.randomBytes(18).toString('hex');
    await query(`INSERT INTO guest_reviews (reservation_id, token) VALUES ($1, $2) ON CONFLICT (reservation_id) DO NOTHING`, [r.id, token]);
    const { rows: saved } = await query(`SELECT token FROM guest_reviews WHERE reservation_id = $1`, [r.id]);
    try {
      await sendReviewRequestEmail(r, saved[0].token);
      await logOutreach('review_request', r.id, r.guest_email, 'sent');
      sent += 1;
    } catch (err) {
      await logOutreach('review_request', r.id, r.guest_email, 'failed', err.message);
    }
  }
  return { sent, candidates: rows.length };
}

/**
 * Guests whose last stay is longer ago than their usual gap (or the default for one-time guests),
 * with nothing booked ahead. Each last stay gets one invitation; at most 50 a run.
 */
async function runReengage() {
  await loadSettings();
  const s = getSettings();
  if (!s.guest_reengage_enabled) return { skipped: 'off' };
  const defaultDays = Math.max(Number(s.guest_reengage_default_days) || 180, 30);
  const { rows } = await query(
    `WITH stays AS (
       SELECT r.id, ${TAIL('r.guest_phone')} AS phone, r.guest_name, r.guest_email, r.check_in::date AS check_in,
              r.check_out::date AS check_out, COALESCE(u.title, u.unit_number, 'your last stay') AS unit_title
       FROM reservations r JOIN units u ON u.id = r.unit_id
       WHERE r.status IS DISTINCT FROM 'cancelled' AND length(${TAIL('r.guest_phone')}) >= 8
     ),
     per_guest AS (
       SELECT phone, COUNT(*) FILTER (WHERE check_out <= $1::date) AS visits,
              MAX(check_out) FILTER (WHERE check_out <= $1::date) AS last_out,
              BOOL_OR(check_out > $1::date) AS has_upcoming,
              CASE WHEN COUNT(*) FILTER (WHERE check_out <= $1::date) > 1
                   THEN (MAX(check_in) FILTER (WHERE check_out <= $1::date) - MIN(check_in)) / (COUNT(*) FILTER (WHERE check_out <= $1::date) - 1)
              END AS usual_gap
       FROM stays GROUP BY phone
     )
     SELECT DISTINCT ON (p.phone) s.id, s.guest_name, s.guest_email, s.unit_title, p.visits, p.usual_gap, p.last_out
     FROM per_guest p JOIN stays s ON s.phone = p.phone AND s.check_out = p.last_out
     WHERE NOT p.has_upcoming AND p.visits >= 1
       AND $1::date - p.last_out >= GREATEST(COALESCE(p.usual_gap, $2), 30)
       AND $1::date - p.last_out <= 730
       AND COALESCE(trim(s.guest_email), '') LIKE '%@%'
       AND NOT EXISTS (SELECT 1 FROM guest_outreach o WHERE o.kind = 'reengage' AND o.reservation_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM guest_blocklist b WHERE b.active AND b.phone = p.phone)
     ORDER BY p.phone, s.id DESC
     LIMIT 50`,
    [today(), defaultDays]
  );
  let offer = null;
  try {
    const { activeOffers } = require('../lib/chatbot/tools');
    const first = (await activeOffers()).offers?.[0];
    if (first) offer = { code: first.code, label: first.discount };
  } catch {
    offer = null;
  }
  let sent = 0;
  for (const r of rows) {
    try {
      await sendReengageEmail(r, offer);
      await logOutreach('reengage', r.id, r.guest_email, 'sent');
      sent += 1;
    } catch (err) {
      await logOutreach('reengage', r.id, r.guest_email, 'failed', err.message);
    }
  }
  return { sent, candidates: rows.length };
}

async function runAutoBlock() {
  await loadSettings();
  return autoBlockByCancellations(getSettings().auto_block_cancellations);
}

function safe(name, fn) {
  return () => fn().then((r) => console.log(`[guest care] ${name}`, JSON.stringify(r))).catch((err) => console.error(`[guest care] ${name} failed:`, err.message));
}

function startGuestCareJobs() {
  cron.schedule('0 12 * * *', safe('pre-arrival', runPrearrival), { timezone: TZ });
  cron.schedule('0 13 * * *', safe('rating requests', runReviewRequests), { timezone: TZ });
  cron.schedule('0 12 * * 1', safe('invite back', runReengage), { timezone: TZ });
  cron.schedule('30 3 * * *', safe('auto-block', runAutoBlock), { timezone: TZ });
}

module.exports = { startGuestCareJobs, runPrearrival, runReviewRequests, runReengage, runAutoBlock };
