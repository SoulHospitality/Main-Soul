/**
 * Reservations can be priced in EGP or USD. The books stay in EGP: USD amounts are stored as their
 * EGP equivalent at the reservation's exchange rate, and the rate is kept so the dollar figures can
 * be shown again. Utilities are an owner-side cost and always stay in EGP.
 */

const MONEY_FIELDS = [
  'price_per_night',
  'total_amount',
  'down_payment',
  'amount_paid',
  'housekeeping_fees',
  'insurance',
  'beach_access_fees',
  'broker_amount_per_night',
  'broker_total',
  'owner_collected_amount',
];

const { query } = require('../config/db');
const { getLiveUsdEgpRate } = require('./usdRate');

const BANK_ACCOUNTS = ['adib', 'cib'];

function normalizeBankAccount(value) {
  const v = String(value || '').trim().toLowerCase();
  return BANK_ACCOUNTS.includes(v) ? v : null;
}

/**
 * Only converts when the payload states its currency, so partial updates that send EGP amounts
 * for an existing USD reservation are left untouched.
 * The rate is never taken from the client: new USD bookings use the live market rate, and an
 * existing USD reservation keeps the rate it was booked at.
 * @returns {Promise<{ body: object, given: boolean, currency: string, rate: number|null } | { error: string }>}
 */
async function reservationCurrencyFromBody(body, { reservationId } = {}) {
  const given = body?.currency != null && body.currency !== '';
  if (!given) return { body, given: false, currency: null, rate: null };
  const currency = String(body.currency).trim().toUpperCase();
  if (!['EGP', 'USD'].includes(currency)) return { error: 'Currency must be EGP or USD' };
  if (currency === 'EGP') return { body, given: true, currency, rate: null };

  let rate = 0;
  if (reservationId) {
    const { rows } = await query('SELECT currency, exchange_rate FROM reservations WHERE id = $1', [reservationId]);
    if (String(rows[0]?.currency || '').toUpperCase() === 'USD') rate = parseFloat(rows[0].exchange_rate) || 0;
  }
  if (!(rate > 0)) {
    try {
      rate = (await getLiveUsdEgpRate()).rate;
    } catch (err) {
      return { error: err.message };
    }
  }
  const out = { ...body };
  for (const field of MONEY_FIELDS) {
    if (out[field] == null || out[field] === '') continue;
    const n = parseFloat(out[field]);
    if (Number.isFinite(n)) out[field] = Math.round(n * rate * 100) / 100;
  }
  return { body: out, given: true, currency, rate };
}

/** Saves currency / rate / InstaPay bank account from an edit payload; USD stays cash only. */
async function applyReservationCurrency(query, reservationId, cur, body) {
  const bankGiven = body?.bank_account !== undefined;
  if (!cur.given && !bankGiven) return null;
  const { rows } = await query(
    `UPDATE reservations SET
       currency = COALESCE($2::varchar, currency),
       exchange_rate = CASE WHEN $2::varchar IS NULL THEN exchange_rate ELSE $3::numeric END,
       payment_method = CASE
         WHEN $2::varchar = 'USD' AND payment_method IS NOT NULL THEN 'cash'
         ELSE payment_method
       END,
       bank_account = CASE
         WHEN $2::varchar = 'USD' THEN NULL
         WHEN $4::boolean THEN $5::varchar
         ELSE bank_account
       END
     WHERE id = $1
     RETURNING currency, exchange_rate, payment_method, bank_account`,
    [
      reservationId,
      cur.given ? cur.currency : null,
      cur.rate,
      bankGiven,
      normalizeBankAccount(body?.bank_account),
    ]
  );
  return rows[0] || null;
}

module.exports = {
  MONEY_FIELDS,
  BANK_ACCOUNTS,
  normalizeBankAccount,
  reservationCurrencyFromBody,
  applyReservationCurrency,
};
