/**
 * Guests seen by the chatbot: the blocklist (the single source of truth for who the bot ignores)
 * and what we know about a returning guest (stays, spend, usual unit).
 */
const { query } = require('../../config/db');

// Phones are compared on their last 10 digits, the same way the inbox matches PMS reservations.
const tail = (phone) => {
  const digits = String(phone || '').replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-10) : null;
};
const TAIL_SQL = (col) => `right(regexp_replace(COALESCE(${col}, ''), '\\D', '', 'g'), 10)`;

/** True when this inbox customer or phone is on the blocklist. */
async function isBlocked({ customerId = null, phone = null } = {}) {
  const t = tail(phone);
  if (!customerId && !t) return false;
  const { rows } = await query(
    `SELECT 1 FROM guest_blocklist
     WHERE active AND (($1::int IS NOT NULL AND inbox_customer_id = $1) OR ($2::text IS NOT NULL AND phone = $2))
     LIMIT 1`,
    [customerId, t]
  );
  return rows.length > 0;
}

async function block({ customerId = null, phone = null, reason = '', source = 'manual', userId = null }) {
  const t = tail(phone);
  if (!customerId && !t) {
    const err = new Error('A phone number or a customer is needed to block');
    err.status = 400;
    throw err;
  }
  if (await isBlocked({ customerId, phone: t })) return { already: true };
  const { rows } = await query(
    `INSERT INTO guest_blocklist (phone, inbox_customer_id, reason, source, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [t, customerId, String(reason || '').slice(0, 300), source, userId]
  );
  return rows[0];
}

/** Lifts every active block on this customer or phone. */
async function unblock({ id = null, customerId = null, phone = null, userId = null }) {
  const t = tail(phone);
  const { rowCount } = await query(
    `UPDATE guest_blocklist SET active = false, removed_by = $4, removed_at = now()
     WHERE active AND (id = $1 OR ($2::int IS NOT NULL AND inbox_customer_id = $2) OR ($3::text IS NOT NULL AND phone = $3))`,
    [id, customerId, t, userId]
  );
  return { removed: rowCount };
}

async function listBlocked() {
  const { rows } = await query(
    `SELECT b.id, b.phone, b.inbox_customer_id, b.reason, b.source, b.created_at,
            c.name AS customer_name, s.full_name AS created_by_name
     FROM guest_blocklist b
     LEFT JOIN inbox_customers c ON c.id = b.inbox_customer_id
     LEFT JOIN staff_users s ON s.id = b.created_by
     WHERE b.active ORDER BY b.created_at DESC LIMIT 300`
  );
  return rows;
}

/**
 * Blocks every phone with `threshold` or more cancelled stays. A guest someone unblocked by hand
 * is never blocked again automatically.
 */
async function autoBlockByCancellations(threshold) {
  const n = Number(threshold) || 0;
  if (n < 1) return { blocked: 0 };
  const { rows } = await query(
    `SELECT ${TAIL_SQL('r.guest_phone')} AS phone, COUNT(*)::int AS cancelled, MAX(r.guest_name) AS name
     FROM reservations r
     WHERE r.status = 'cancelled' AND length(${TAIL_SQL('r.guest_phone')}) >= 8
     GROUP BY 1 HAVING COUNT(*) >= $1`,
    [n]
  );
  let blocked = 0;
  for (const r of rows) {
    const { rows: seen } = await query(`SELECT 1 FROM guest_blocklist WHERE phone = $1 AND (active OR removed_at IS NOT NULL) LIMIT 1`, [r.phone]);
    if (seen.length) continue;
    await query(
      `INSERT INTO guest_blocklist (phone, reason, source) VALUES ($1, $2, 'auto_cancellations')`,
      [r.phone, `${r.cancelled} cancelled bookings${r.name ? ` (${r.name})` : ''}`]
    );
    blocked += 1;
  }
  return { blocked };
}

/**
 * A returning guest's history: past stays, total spent, the unit they book most, and their usual
 * gap between stays. Null when the phone has no past stay.
 */
async function guestProfile(phone) {
  const t = tail(phone);
  if (!t) return null;
  const { rows } = await query(
    `SELECT r.id, r.guest_name, r.check_in::text AS check_in, r.check_out::text AS check_out, r.status,
            COALESCE(r.total_amount, 0)::float AS total, u.id::text AS unit_id, u.title AS unit_title,
            u.unit_number, COALESCE(u.project, u.compound) AS project, u.slug
     FROM reservations r JOIN units u ON u.id = r.unit_id
     WHERE ${TAIL_SQL('r.guest_phone')} = $1 AND r.status IS DISTINCT FROM 'cancelled'
     ORDER BY r.check_in ASC`,
    [t]
  );
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const past = rows.filter((r) => r.check_out <= today);
  const upcoming = rows.filter((r) => r.check_out > today);
  if (!past.length && !upcoming.length) return null;
  const counts = new Map();
  for (const r of past) counts.set(r.unit_id, (counts.get(r.unit_id) || 0) + 1);
  const favId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const fav = favId ? past.filter((r) => r.unit_id === favId).at(-1) : null;
  const gaps = [];
  for (let i = 1; i < past.length; i += 1) {
    gaps.push((Date.parse(past[i].check_in) - Date.parse(past[i - 1].check_in)) / 86400000);
  }
  const last = past.at(-1) || null;
  return {
    name: (last || upcoming[0])?.guest_name || null,
    visits: past.length,
    total_spent: Math.round(past.reduce((s, r) => s + r.total, 0)),
    favourite_unit: fav ? { id: fav.unit_id, title: fav.unit_title, unit_number: fav.unit_number, project: fav.project, slug: fav.slug, stays: counts.get(favId) } : null,
    last_stay: last ? { id: last.id, check_in: last.check_in, check_out: last.check_out, unit_title: last.unit_title, project: last.project } : null,
    usual_gap_days: gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null,
    upcoming: upcoming[0] ? { id: upcoming[0].id, check_in: upcoming[0].check_in, check_out: upcoming[0].check_out, unit_title: upcoming[0].unit_title } : null,
  };
}

/** One line for the bot about a returning guest (no money figures: those are for the team). */
function profileLine(p) {
  if (!p) return '';
  const bits = [];
  if (p.visits) bits.push(`${p.visits} past stay${p.visits === 1 ? '' : 's'} with us`);
  if (p.last_stay) bits.push(`last stay ${p.last_stay.check_in} at ${p.last_stay.project || p.last_stay.unit_title}`);
  if (p.favourite_unit && p.favourite_unit.stays > 1) bits.push(`usually books "${p.favourite_unit.title}" (${p.favourite_unit.project || ''}), link https://soulhospitality.co/listings/${p.favourite_unit.slug}`);
  if (p.upcoming) bits.push(`has an upcoming stay ${p.upcoming.check_in} → ${p.upcoming.check_out}`);
  return `This customer is a returning guest: ${bits.join('; ')}. Welcome them back in a few words${p.favourite_unit && p.favourite_unit.stays > 1 ? ', and when they search, you may mention their usual unit first if it is available' : ''}. You already have their name and phone number: don't ask for them again.`;
}

module.exports = { tail, isBlocked, block, unblock, listBlocked, autoBlockByCancellations, guestProfile, profileLine };
