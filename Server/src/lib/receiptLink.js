const crypto = require('crypto');
const { query } = require('../config/db');

/**
 * Guest receipt links: /receipt/<id>-<signature>. The signature (HMAC of the reservation id with the
 * server secret) means a link can't be guessed or changed to open someone else's receipt.
 */
function secret() {
  const s = process.env.RECEIPT_LINK_SECRET || process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

function sign(id) {
  return crypto.createHmac('sha256', secret()).update(`receipt:${id}`).digest('base64url').slice(0, 22);
}

function receiptToken(id) {
  return `${Number(id)}-${sign(Number(id))}`;
}

function idFromToken(token) {
  const m = String(token || '').match(/^(\d{1,10})-([A-Za-z0-9_-]{22})$/);
  if (!m) return null;
  const expected = sign(Number(m[1]));
  const a = Buffer.from(m[2]);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? Number(m[1]) : null;
}

function receiptUrl(id) {
  const base = String(process.env.FRONTEND_URL || 'https://soulhospitality.co').replace(/\/+$/, '');
  return `${base}/receipt/${receiptToken(id)}`;
}

/** What the guest's receipt shows (no internal fields). */
async function guestReceipt(id) {
  const { rows } = await query(
    `SELECT r.id, r.guest_name, r.guest_phone, r.check_in::text AS check_in, r.check_out::text AS check_out, r.nights,
            r.price_per_night, r.total_amount, r.housekeeping_fees, r.beach_access_fees, r.insurance, r.amount_paid,
            r.adults, r.children, r.status, r.currency,
            COALESCE(u.unit_number, u.title) AS unit_number, u.title AS unit_title, COALESCE(u.compound, u.project) AS project
     FROM reservations r JOIN units u ON u.id = r.unit_id
     WHERE r.id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const { rows: payments } = await query(
    `SELECT amount, payment_date::text AS payment_date, payment_method, status, is_approved, kind
     FROM payments
     WHERE reservation_id = $1 AND COALESCE(status, '') NOT IN ('rejected', 'failed', 'cancelled')
     ORDER BY payment_date, id`,
    [id]
  );
  return { ...rows[0], payments };
}

/** Egyptian mobile numbers to WhatsApp's international form (digits only). */
function whatsappNumber(phone) {
  let d = String(phone || '').replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (/^01\d{9}$/.test(d)) d = `2${d}`;
  return d.length >= 10 ? d : null;
}

module.exports = { receiptToken, idFromToken, receiptUrl, guestReceipt, whatsappNumber };
