/**
 * An owner's money in one place, shared by the owner portal and the finance team:
 *   earned (owner share of stays that have checked out) − owner expenses − paid out − requests in progress
 *   = available to request now. Stays not finished yet show as upcoming earnings.
 * Same books period as the Financial System (from the books restart).
 */
const { query } = require('../config/db');
const { calcReservationFinancials, round2 } = require('./commission');
const { refreshBooksReset, afterReset, booksResetAt } = require('./finance/booksReset');
const { reservationResetFilter } = require('./finance/ledgerEngine');
const { notifyStaff } = require('../services/pmsNotifications');
const { logAudit } = require('./audit');
const { isTreasuryCode } = require('./finance/chartOfAccounts');

const FINANCE_ROLES = ['admin', 'finance', 'finance_manager'];
const METHODS = ['bank_transfer', 'instapay', 'cash'];

function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function ownerWallet(ownerId) {
  await refreshBooksReset();
  const today = cairoToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const { rows: links } = await query(`SELECT unit_id FROM owner_units WHERE owner_id = $1`, [ownerId]);
  const unitIds = links.map((r) => r.unit_id);
  const wallet = {
    owner_id: ownerId,
    unit_count: unitIds.length,
    earned: 0,
    earned_this_month: 0,
    upcoming: 0,
    upcoming_stays: 0,
    upcoming_nights: 0,
    expenses: 0,
    paid_out: 0,
    in_progress: 0,
    available: 0,
    as_of: today,
    since: booksResetAt()
      ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(booksResetAt()))
      : null,
  };
  if (!unitIds.length) return wallet;

  const { rows: stays } = await query(
    `SELECT r.nights, r.price_per_night, r.total_amount, r.utilities_amount, r.utilities_custom,
            r.broker_total, r.broker_amount_per_night, r.housekeeping_fees, r.insurance, r.beach_access_fees,
            r.is_owner_reservation, r.status, to_char(r.check_in, 'YYYY-MM-DD') AS check_in,
            to_char(r.check_out, 'YYYY-MM-DD') AS check_out,
            u.commission_mode, u.company_commission_pct, u.company_commission_owner_pct, u.commission_tenant_pct,
            COALESCE(u.utilities_cost, 0) AS utilities_cost
     FROM reservations r JOIN units u ON u.id = r.unit_id
     WHERE r.unit_id = ANY($1::uuid[]) AND r.status::text <> 'cancelled'${reservationResetFilter('r')}`,
    [unitIds]
  );
  for (const r of stays) {
    const share = Number(calcReservationFinancials(r, r).ownerNet) || 0;
    if (r.check_out && r.check_out <= today) {
      wallet.earned += share;
      if (r.check_out >= monthStart) wallet.earned_this_month += share;
    } else {
      wallet.upcoming += share;
      wallet.upcoming_stays += 1;
      wallet.upcoming_nights += Number(r.nights) || 0;
    }
  }

  const { rows: exp } = await query(
    `SELECT COALESCE(SUM(amount), 0)::float AS total FROM expenses
     WHERE paid_by = 'owner' AND (owner_id = $2 OR (owner_id IS NULL AND unit_id = ANY($1::uuid[])))${afterReset('created_at')}`,
    [unitIds, ownerId]
  );
  wallet.expenses = Number(exp[0]?.total) || 0;

  const { rows: pays } = await query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)::float AS paid,
            COALESCE(SUM(amount) FILTER (WHERE status IN ('requested', 'approved')), 0)::float AS open
     FROM owner_payout_requests WHERE owner_id = $1${afterReset('created_at')}`,
    [ownerId]
  );
  wallet.paid_out = Number(pays[0]?.paid) || 0;
  wallet.in_progress = Number(pays[0]?.open) || 0;

  for (const k of ['earned', 'earned_this_month', 'upcoming', 'expenses', 'paid_out', 'in_progress']) wallet[k] = round2(wallet[k]);
  wallet.balance = round2(wallet.earned - wallet.expenses - wallet.paid_out);
  wallet.available = round2(Math.max(0, wallet.balance - wallet.in_progress));
  return wallet;
}

async function getPayoutDetails(ownerId) {
  const { rows } = await query(`SELECT * FROM owner_payout_details WHERE owner_id = $1`, [ownerId]);
  return rows[0] || null;
}

const clean = (v, max = 120) => String(v ?? '').trim().slice(0, max);

/** Validates and saves where the owner wants to be paid. */
async function savePayoutDetails(ownerId, body) {
  const method = METHODS.includes(body?.method) ? body.method : 'bank_transfer';
  const d = {
    method,
    bank_name: clean(body?.bank_name, 80),
    account_name: clean(body?.account_name, 120),
    account_number: clean(body?.account_number, 40).replace(/\s+/g, ''),
    iban: clean(body?.iban, 40).replace(/\s+/g, '').toUpperCase(),
    instapay: clean(body?.instapay, 80),
    phone: clean(body?.phone, 30),
  };
  const missing =
    method === 'bank_transfer'
      ? !d.bank_name || !d.account_name || (!d.account_number && !d.iban)
      : method === 'instapay'
        ? !d.instapay
        : !d.phone;
  if (missing) {
    const err = new Error(
      method === 'bank_transfer'
        ? 'Add the bank, the account holder name and the account number or IBAN'
        : method === 'instapay'
          ? 'Add your InstaPay address or phone number'
          : 'Add a phone number we can call when the cash is ready'
    );
    err.status = 400;
    throw err;
  }
  const { rows } = await query(
    `INSERT INTO owner_payout_details (owner_id, method, bank_name, account_name, account_number, iban, instapay, phone, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
     ON CONFLICT (owner_id) DO UPDATE SET method = EXCLUDED.method, bank_name = EXCLUDED.bank_name,
       account_name = EXCLUDED.account_name, account_number = EXCLUDED.account_number, iban = EXCLUDED.iban,
       instapay = EXCLUDED.instapay, phone = EXCLUDED.phone, updated_at = now()
     RETURNING *`,
    [ownerId, d.method, d.bank_name || null, d.account_name || null, d.account_number || null, d.iban || null, d.instapay || null, d.phone || null]
  );
  return rows[0];
}

/** One line finance can copy into the bank app. */
function describePayoutDetails(d) {
  if (!d) return '';
  if (d.method === 'instapay') return `InstaPay · ${d.instapay}`;
  if (d.method === 'cash') return `Cash pickup · ${d.phone}`;
  return [d.bank_name, d.account_name, d.iban || d.account_number].filter(Boolean).join(' · ');
}

async function notifyOwner(ownerId, { type, title, message, id }) {
  try {
    await notifyStaff({ userIds: [ownerId], type, title, message, entity_type: 'owner_payout_request', entity_id: id });
  } catch (e) {
    console.warn('[owner payouts] notify owner failed', e.message);
  }
}

async function notifyFinance({ type, title, message, id }) {
  try {
    await notifyStaff({ roles: FINANCE_ROLES, type, title, message, entity_type: 'owner_payout_request', entity_id: id });
  } catch (e) {
    console.warn('[owner payouts] notify finance failed', e.message);
  }
}

/**
 * Marks an owner payout paid from a treasury account, with the transfer reference. One path for the
 * owner portal review and the Financial System, so the books, the owner and the request always agree.
 */
async function markOwnerPayoutPaid({ id, treasury, reference, userId }) {
  const { rows: found } = await query(`SELECT * FROM owner_payout_requests WHERE id = $1`, [id]);
  const p = found[0];
  if (!p) throw Object.assign(new Error('Payout not found'), { status: 404 });
  if (p.status === 'paid') return p;
  if (['rejected', 'cancelled'].includes(p.status)) throw Object.assign(new Error(`This request was ${p.status}`), { status: 400 });
  const code = String(treasury || '').trim() || '101000';
  if (!isTreasuryCode(code)) throw Object.assign(new Error('Choose a bank or cash treasury account'), { status: 400 });
  await require('./finance/periodLock').assertPeriodOpen(new Date().toISOString().slice(0, 10), 'Today');
  const { rows } = await query(
    `UPDATE owner_payout_requests SET status = 'paid', paid_from_account = $2, payment_reference = $3,
       paid_at = now(), paid_by = $4, reviewed_by = COALESCE(reviewed_by, $4), reviewed_at = COALESCE(reviewed_at, now()),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, code, String(reference || '').trim().slice(0, 120) || null, userId]
  );
  if (rows[0].settlement_id) {
    await query(`UPDATE owner_settlements SET status = 'paid', updated_at = now() WHERE id = $1`, [rows[0].settlement_id]).catch(() => {});
  }
  await logAudit({
    userId,
    action: 'PAY_OWNER_PAYOUT',
    entityType: 'owner_payout_request',
    entityId: id,
    details: { amount: Number(rows[0].amount), paid_from_account: code, reference: rows[0].payment_reference },
  });
  await notifyOwner(rows[0].owner_id, {
    type: 'owner_payout_paid',
    title: 'Your payout was sent',
    message: `EGP ${Number(rows[0].amount).toLocaleString('en-US')} was sent${rows[0].payment_reference ? ` (ref ${rows[0].payment_reference})` : ''}.`,
    id: rows[0].id,
  });
  return rows[0];
}

module.exports = {
  markOwnerPayoutPaid,
  ownerWallet,
  getPayoutDetails,
  savePayoutDetails,
  describePayoutDetails,
  notifyOwner,
  notifyFinance,
  PAYOUT_METHODS: METHODS,
};
