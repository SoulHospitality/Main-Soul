const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { reservationBill } = require('../../lib/reservationBill');
const { refreshBooksReset, booksResetAt } = require('../../lib/finance/booksReset');
const { refreshCustomAccounts } = require('../../lib/finance/customAccounts');
const { buildJournal } = require('../../lib/finance/ledgerEngine');

/**
 * The Financial System workspace: what needs finance today, live data-health checks,
 * search across money records, one reservation's money timeline, and change history.
 */
const router = express.Router();
const FINANCE = ['admin', 'finance', 'finance_manager'];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const todayCairo = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Runs a query; a missing table or column (older database) gives an empty result instead of an error. */
async function safe(sql, params = []) {
  try {
    return (await query(sql, params)).rows;
  } catch (err) {
    if (['42P01', '42703'].includes(err.code)) return [];
    throw err;
  }
}

const BILL_COLUMNS = `r.id, r.guest_name, r.guest_phone, r.status::text AS status, r.nights, r.price_per_night, r.total_amount,
  r.housekeeping_fees, r.beach_access_fees, r.insurance, r.service_fees, r.owner_collected_amount, r.owner_collected_type,
  r.down_payment, r.amount_paid, r.currency,
  to_char(r.check_in, 'YYYY-MM-DD') AS check_in, to_char(r.check_out, 'YYYY-MM-DD') AS check_out,
  COALESCE(u.unit_number, u.title, 'Unit') AS unit_name`;

/** Everything waiting on finance, as one list sorted by money. */
router.get('/financial-system/today', requireRoles(...FINANCE), async (req, res, next) => {
  try {
    const today = todayCairo();
    const week = addDays(today, 7);
    const items = [];

    const [collection] = await safe(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::float AS amount,
              COUNT(*) FILTER (WHERE created_at < now() - interval '3 days')::int AS old
       FROM payments WHERE finance_review_status = 'pending'`
    );
    if (collection?.n) {
      items.push({ id: 'collection', tool: 'collection', count: collection.n, amount: round2(collection.amount), old: collection.old, severity: collection.old ? 'high' : 'normal' });
    }

    const refunds = await safe(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(requested_refund), 0)::float AS amount,
              COUNT(*) FILTER (WHERE manager_approved_at IS NULL)::int AS manager,
              COUNT(*) FILTER (WHERE manager_approved_at IS NOT NULL AND admin_approved_at IS NULL)::int AS ceo,
              COUNT(*) FILTER (WHERE manager_approved_at IS NOT NULL AND admin_approved_at IS NOT NULL)::int AS payout
       FROM reservation_cancel_requests WHERE status = 'pending'`
    );
    if (refunds[0]?.n) {
      const r = refunds[0];
      items.push({ id: 'refunds', tool: 'refunds', count: r.n, amount: round2(r.amount), detail: { manager: r.manager, ceo: r.ceo, payout: r.payout }, severity: r.payout ? 'high' : 'normal' });
    }

    const calendar = await safe(
      `SELECT COUNT(*) FILTER (WHERE due_date < $1::date)::int AS overdue,
              COALESCE(SUM(amount) FILTER (WHERE due_date < $1::date), 0)::float AS overdue_amount,
              COUNT(*) FILTER (WHERE due_date >= $1::date AND due_date <= $2::date)::int AS soon,
              COALESCE(SUM(amount) FILTER (WHERE due_date >= $1::date AND due_date <= $2::date), 0)::float AS soon_amount
       FROM finance_calendar_payments WHERE status = 'pending'`,
      [today, week]
    );
    if (calendar[0]?.overdue) {
      items.push({ id: 'calendar_overdue', tool: 'calendar', count: calendar[0].overdue, amount: round2(calendar[0].overdue_amount), severity: 'high' });
    }
    if (calendar[0]?.soon) {
      items.push({ id: 'calendar_soon', tool: 'calendar', count: calendar[0].soon, amount: round2(calendar[0].soon_amount), severity: 'normal' });
    }

    const insurance = await safe(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(insurance), 0)::float AS amount
       FROM reservations
       WHERE status::text <> 'cancelled' AND COALESCE(insurance, 0) > 0.009
         AND check_out <= $1::date AND check_out >= '2026-08-24'
         AND (insurance_refund_status IS NULL OR insurance_refund_status = 'pending')`,
      [today]
    );
    if (insurance[0]?.n) {
      items.push({ id: 'insurance', tool: 'insurance', count: insurance[0].n, amount: round2(insurance[0].amount), severity: 'normal' });
    }

    // Guests who already left and still owe money.
    const left = await safe(
      `SELECT ${BILL_COLUMNS}
       FROM reservations r LEFT JOIN units u ON u.id = r.unit_id
       WHERE r.status::text <> 'cancelled' AND r.check_out <= $1::date AND r.check_out >= $2::date
         AND COALESCE(r.is_owner_reservation, 0) = 0`,
      [today, addDays(today, -60)]
    );
    let owing = 0;
    let owingCount = 0;
    for (const r of left) {
      const due = reservationBill(r).toCollect;
      if (due > 0.5) {
        owing += due;
        owingCount += 1;
      }
    }
    if (owingCount) items.push({ id: 'left_owing', tool: 'outstanding', count: owingCount, amount: round2(owing), severity: 'high' });

    const bills = await safe(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(net_payable), 0)::float AS amount
       FROM vendor_invoices WHERE status IN ('pending', 'approved') AND due_date <= $1::date`,
      [week]
    );
    if (bills[0]?.n) items.push({ id: 'vendor_bills', tool: 'vendors', count: bills[0].n, amount: round2(bills[0].amount), severity: 'normal' });

    const payouts = await safe(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::float AS amount
       FROM owner_payout_requests WHERE status IN ('requested', 'approved')`
    );
    if (payouts[0]?.n) items.push({ id: 'owner_payouts', tool: 'owners', count: payouts[0].n, amount: round2(payouts[0].amount), severity: 'normal' });

    const order = { high: 0, normal: 1 };
    items.sort((a, b) => order[a.severity] - order[b.severity] || b.amount - a.amount);
    res.json({ as_of: today, items });
  } catch (e) {
    next(e);
  }
});

/** Live checks that catch money recorded wrongly. Each check names what to do about it. */
async function healthChecks() {
  await refreshBooksReset();
  const reset = booksResetAt();
  const today = todayCairo();
  const checks = [];
  const add = (c) => checks.push({ ...c, amount: round2(c.amount || 0), rows: (c.rows || []).slice(0, 25) });

  const dropped = await safe(
    `SELECT r.id, r.guest_name, to_char(r.check_in, 'YYYY-MM-DD') AS check_in,
            COALESCE(r.down_payment, 0)::float AS amount, COALESCE(r.amount_paid, 0)::float AS paid
     FROM reservations r
     WHERE r.down_payment > 0 AND r.status::text <> 'cancelled' AND r.booking_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.reservation_id = r.id
                       AND (p.is_down_payment OR p.notes = 'Down payment (manual reservation)'))
       AND EXISTS (SELECT 1 FROM payments p WHERE p.reservation_id = r.id
                   AND p.status = 'successful' AND COALESCE(p.is_approved, 0) = 1)
     ORDER BY r.check_in DESC`
  );
  add({ id: 'down_payment_dropped', severity: 'high', count: dropped.length, amount: dropped.reduce((s, r) => s + r.amount, 0), rows: dropped, tool: 'outstanding' });

  if (reset) {
    const preReset = await safe(
      `SELECT r.id, r.guest_name, to_char(r.check_in, 'YYYY-MM-DD') AS check_in, SUM(p.amount)::float AS amount
       FROM payments p JOIN reservations r ON r.id = p.reservation_id
       WHERE p.created_at >= $1::timestamptz AND r.created_at < $1::timestamptz
         AND p.status = 'successful' AND COALESCE(p.is_approved, 0) = 1
       GROUP BY r.id ORDER BY r.check_in DESC`,
      [reset]
    );
    add({ id: 'pre_reset_payments', severity: 'high', count: preReset.length, amount: preReset.reduce((s, r) => s + r.amount, 0), rows: preReset, tool: 'accounts' });
  }

  const invoices = await safe(
    `SELECT vi.id, COALESCE(v.name, 'Vendor') AS guest_name, vi.invoice_number AS ref, COALESCE(vi.net_payable, 0)::float AS amount
     FROM vendor_invoices vi LEFT JOIN vendors v ON v.id = vi.vendor_id WHERE vi.status = 'paid' ORDER BY vi.paid_at DESC`
  );
  add({ id: 'vendor_paid_not_booked', severity: 'high', count: invoices.length, amount: invoices.reduce((s, r) => s + r.amount, 0), rows: invoices, tool: 'vendors' });

  const writeOffs = await safe(
    `SELECT w.id, r.guest_name, w.reservation_id, COALESCE(w.amount, 0)::float AS amount
     FROM ar_write_offs w LEFT JOIN reservations r ON r.id = w.reservation_id WHERE w.status = 'approved'`
  );
  add({ id: 'write_offs_not_applied', severity: 'high', count: writeOffs.length, amount: writeOffs.reduce((s, r) => s + r.amount, 0), rows: writeOffs, tool: 'outstanding' });

  const placeholders = await safe(
    `SELECT p.id, p.reservation_id, r.guest_name, COALESCE(p.amount, 0)::float AS amount
     FROM payments p LEFT JOIN reservations r ON r.id = p.reservation_id
     WHERE p.status = 'pending' AND p.notes LIKE 'Awaiting collection (manual reservation)%'`
  );
  add({ id: 'placeholders', severity: 'medium', count: placeholders.length, amount: placeholders.reduce((s, r) => s + r.amount, 0), rows: placeholders, tool: 'collection' });

  const cardOrphans = await safe(
    `SELECT p.id, p.booking_id AS ref, COALESCE(p.amount, 0)::float AS amount, to_char(p.created_at, 'YYYY-MM-DD') AS check_in
     FROM payments p
     WHERE p.reservation_id IS NULL AND p.booking_id IS NOT NULL AND p.status = 'successful'
       AND p.created_at < now() - interval '2 days'`
  );
  add({ id: 'card_without_stay', severity: 'high', count: cardOrphans.length, amount: cardOrphans.reduce((s, r) => s + r.amount, 0), rows: cardOrphans, tool: 'search' });

  const stale = await safe(
    `SELECT p.id, p.reservation_id, r.guest_name, COALESCE(p.amount, 0)::float AS amount, to_char(p.created_at, 'YYYY-MM-DD') AS check_in
     FROM payments p LEFT JOIN reservations r ON r.id = p.reservation_id
     WHERE p.finance_review_status = 'pending' AND p.created_at < now() - interval '3 days'
     ORDER BY p.created_at`
  );
  add({ id: 'collection_waiting', severity: 'medium', count: stale.length, amount: stale.reduce((s, r) => s + r.amount, 0), rows: stale, tool: 'collection' });

  const overpaid = await safe(
    `SELECT ${BILL_COLUMNS} FROM reservations r LEFT JOIN units u ON u.id = r.unit_id
     WHERE r.status::text <> 'cancelled' AND COALESCE(r.amount_paid, 0) > 0 AND r.check_in >= $1::date`,
    [addDays(today, -120)]
  );
  const over = [];
  for (const r of overpaid) {
    const bill = reservationBill(r);
    const extra = round2(Number(r.amount_paid) - bill.total);
    if (bill.total > 0 && extra > 1) over.push({ id: r.id, guest_name: r.guest_name, check_in: r.check_in, amount: extra });
  }
  add({ id: 'overpaid', severity: 'medium', count: over.length, amount: over.reduce((s, r) => s + r.amount, 0), rows: over, tool: 'outstanding' });

  const snapshots = await safe(
    `SELECT account_code, MAX(statement_date) AS last FROM financial_bank_snapshots GROUP BY account_code`
  );
  const lastBy = Object.fromEntries(snapshots.map((s) => [s.account_code, String(s.last instanceof Date ? s.last.toISOString() : s.last).slice(0, 10)]));
  const unreconciled = ['101000', '102000'].filter((code) => !lastBy[code] || lastBy[code] < addDays(today, -35))
    .map((code) => ({ id: code, guest_name: code === '101000' ? 'ADIB' : 'CIB', check_in: lastBy[code] || null, amount: 0 }));
  add({ id: 'bank_not_reconciled', severity: 'medium', count: unreconciled.length, amount: 0, rows: unreconciled, tool: 'reconcile' });

  const closedEdits = await safe(
    `SELECT a.id, a.reservation_id, r.guest_name, to_char(a.created_at, 'YYYY-MM-DD') AS check_in, 0::float AS amount, a.actor_name AS ref
     FROM audit_log a
     JOIN reservations r ON r.id = a.reservation_id
     JOIN financial_period_closes c ON c.year_month = to_char(r.check_in, 'YYYY-MM')
     WHERE a.action IN ('UPDATE_RESERVATION', 'RECORD_PAYMENT', 'FINANCE_REVIEW_PAYMENT')
       AND a.created_at > c.closed_at
     ORDER BY a.created_at DESC`
  );
  add({ id: 'closed_month_edits', severity: 'medium', count: closedEdits.length, amount: 0, rows: closedEdits, tool: 'close' });

  return checks;
}

router.get('/financial-system/health', requireRoles(...FINANCE), async (_req, res, next) => {
  try {
    const checks = await healthChecks();
    res.json({ checks, issues: checks.filter((c) => c.count > 0).length });
  } catch (e) {
    next(e);
  }
});

/** Search reservations, payments, expenses, journals and vendor bills by name, phone, number, amount or reference. */
router.get('/financial-system/search', requireRoles(...FINANCE), async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (q.length < 2) return res.json({ q, reservations: [], payments: [], expenses: [], journals: [], bills: [] });
    const like = `%${q}%`;
    const digits = q.replace(/\D/g, '');
    const asNumber = /^[\d.,\s]+$/.test(q) ? Number(q.replace(/[,\s]/g, '')) : null;
    const id = /^#?\d{1,9}$/.test(q) ? Number(q.replace('#', '')) : null;

    const reservations = await safe(
      `SELECT ${BILL_COLUMNS}
       FROM reservations r LEFT JOIN units u ON u.id = r.unit_id
       WHERE r.id = $1 OR r.guest_name ILIKE $2
          OR ($3 <> '' AND length($3) >= 5 AND regexp_replace(COALESCE(r.guest_phone, ''), '\\D', '', 'g') LIKE '%' || $3 || '%')
       ORDER BY r.check_in DESC LIMIT 12`,
      [id ?? -1, like, digits]
    );
    const payments = await safe(
      `SELECT p.id, p.reservation_id, p.amount::float AS amount, p.payment_method, p.status, p.kind,
              COALESCE(p.reference_number, p.transaction_reference) AS reference,
              to_char(COALESCE(p.payment_date, p.created_at::date), 'YYYY-MM-DD') AS date, r.guest_name
       FROM payments p LEFT JOIN reservations r ON r.id = p.reservation_id
       WHERE ($1::numeric IS NOT NULL AND abs(abs(p.amount) - $1::numeric) < 0.5)
          OR COALESCE(p.reference_number, '') ILIKE $2 OR COALESCE(p.transaction_reference, '') ILIKE $2
          OR p.id = $3
       ORDER BY p.created_at DESC LIMIT 12`,
      [asNumber, like, id ?? -1]
    );
    const expenses = await safe(
      `SELECT id, description, amount::float AS amount, category, to_char(COALESCE(expense_date, created_at::date), 'YYYY-MM-DD') AS date
       FROM expenses
       WHERE description ILIKE $1 OR ($2::numeric IS NOT NULL AND abs(amount - $2::numeric) < 0.5)
       ORDER BY created_at DESC LIMIT 8`,
      [like, asNumber]
    );
    const journals = await safe(
      `SELECT id, description, amount::float AS amount, debit_account_code, credit_account_code,
              to_char(COALESCE(entry_date, created_at::date), 'YYYY-MM-DD') AS date
       FROM financial_manual_entries
       WHERE description ILIKE $1 OR COALESCE(notes, '') ILIKE $1 OR ($2::numeric IS NOT NULL AND abs(amount - $2::numeric) < 0.5)
       ORDER BY created_at DESC LIMIT 8`,
      [like, asNumber]
    );
    const bills = await safe(
      `SELECT vi.id, vi.invoice_number, vi.status, COALESCE(vi.net_payable, 0)::float AS amount, v.name AS vendor_name,
              to_char(vi.due_date, 'YYYY-MM-DD') AS date
       FROM vendor_invoices vi LEFT JOIN vendors v ON v.id = vi.vendor_id
       WHERE COALESCE(vi.invoice_number, '') ILIKE $1 OR COALESCE(v.name, '') ILIKE $1
          OR ($2::numeric IS NOT NULL AND abs(COALESCE(vi.net_payable, 0) - $2::numeric) < 0.5)
       ORDER BY vi.created_at DESC LIMIT 8`,
      [like, asNumber]
    );
    const calendar = await safe(
      `SELECT id, title, amount::float AS amount, status, direction, to_char(due_date, 'YYYY-MM-DD') AS date
       FROM finance_calendar_payments
       WHERE title ILIKE $1 OR COALESCE(notes, '') ILIKE $1 OR ($2::numeric IS NOT NULL AND abs(amount - $2::numeric) < 0.5)
       ORDER BY due_date DESC LIMIT 8`,
      [like, asNumber]
    );
    res.json({
      q,
      reservations: reservations.map((r) => ({ ...r, bill: reservationBill(r) })),
      payments,
      expenses,
      journals,
      bills,
      calendar,
    });
  } catch (e) {
    next(e);
  }
});

/** One reservation's money story: bill, every payment and refund, approvals, book entries and history. */
router.get('/financial-system/reservations/:id/money', requireRoles(...FINANCE), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid reservation' });
    await refreshCustomAccounts();
    const { rows } = await query(
      `SELECT r.*,
              to_char(r.check_in, 'YYYY-MM-DD') AS check_in, to_char(r.check_out, 'YYYY-MM-DD') AS check_out,
              to_char(r.created_at, 'YYYY-MM-DD') AS created_at, to_char(r.check_in, 'YYYY-MM-DD') AS period_date,
              COALESCE(u.unit_number, u.title, 'Unit') AS unit_name, COALESCE(u.project, u.compound) AS project,
              u.commission_mode, u.company_commission_pct, u.company_commission_owner_pct, u.commission_tenant_pct,
              COALESCE(u.utilities_cost, 0) AS utilities_cost,
              COALESCE(sp.full_name, '—') AS sales_person_name, COALESCE(sp.sales_commission_pct, 0) AS agent_commission_pct,
              ops.full_name AS ops_collected_by_name
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       LEFT JOIN staff_users sp ON sp.id = r.sales_person_id
       LEFT JOIN staff_users ops ON ops.id = r.ops_money_collected_by
       WHERE r.id = $1`,
      [id]
    );
    const r = rows[0];
    if (!r) return res.status(404).json({ error: 'Reservation not found' });

    const payments = await safe(
      `SELECT p.*, p.amount::float AS amount,
              to_char(COALESCE(p.payment_date, p.created_at::date), 'YYYY-MM-DD') AS date,
              c.full_name AS created_by_name, a.full_name AS approved_by_name, f.full_name AS reviewed_by_name
       FROM payments p
       LEFT JOIN staff_users c ON c.id = p.created_by
       LEFT JOIN staff_users a ON a.id = p.approved_by
       LEFT JOIN staff_users f ON f.id = p.finance_reviewed_by
       WHERE p.reservation_id = $1
       ORDER BY p.created_at`,
      [id]
    );
    const cancelRequests = await safe(
      `SELECT cr.*, u.full_name AS requested_by_name FROM reservation_cancel_requests cr
       LEFT JOIN staff_users u ON u.id = cr.requested_by WHERE cr.reservation_id = $1 ORDER BY cr.requested_at`,
      [id]
    );
    const writeOffs = await safe(`SELECT * FROM ar_write_offs WHERE reservation_id = $1 ORDER BY created_at`, [id]);
    const customBills = await safe(
      `SELECT b.*, u.full_name AS requested_by_name FROM ops_custom_bill_requests b
       LEFT JOIN staff_users u ON u.id = b.requested_by WHERE b.reservation_id = $1 ORDER BY b.created_at`,
      [id]
    );
    const history = await safe(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at, COALESCE(a.actor_name, s.full_name) AS actor_name
       FROM audit_log a LEFT JOIN staff_users s ON s.id = a.user_id
       WHERE a.reservation_id = $1
          OR (a.entity_type = 'reservation' AND a.entity_id = $2)
          OR (a.entity_type = 'payment' AND a.entity_id = ANY($3::text[]))
       ORDER BY a.created_at DESC LIMIT 100`,
      [id, String(id), payments.map((p) => String(p.id))]
    );

    // The book entries this stay produces, built the same way as the Financial System builds them.
    let entries = [];
    try {
      const journal = buildJournal(
        { reservations: [r], payments, stayPayments: payments, expenses: [], manuals: [], payouts: [], holdbacks: [], recurring: [], closes: [], settings: {} },
        null,
        null,
        { includeCloses: false }
      );
      entries = journal.filter((e) => String(e.meta?.reservation_id ?? '') === String(id));
    } catch (err) {
      console.warn('[finance timeline] journal failed', err.message);
    }

    res.json({
      reservation: {
        id: r.id, guest_name: r.guest_name, guest_phone: r.guest_phone, unit_name: r.unit_name, project: r.project,
        check_in: r.check_in, check_out: r.check_out, nights: r.nights, status: r.status, currency: r.currency,
        booking_source: r.booking_source, sales_person_name: r.sales_person_name, created_at: r.created_at,
        payment_method: r.payment_method, ops_money_collected_at: r.ops_money_collected_at, ops_collected_by_name: r.ops_collected_by_name,
        insurance_refund_status: r.insurance_refund_status, insurance_refunded_amount: r.insurance_refunded_amount,
        insurance_damage_amount: r.insurance_damage_amount, service_fee_percent: r.service_fee_percent,
      },
      bill: reservationBill(r),
      payments,
      cancel_requests: cancelRequests,
      write_offs: writeOffs,
      custom_bills: customBills,
      entries,
      history,
    });
  } catch (e) {
    next(e);
  }
});

/** Who created, changed or approved a record, newest first. */
router.get('/financial-system/history', requireRoles(...FINANCE), async (req, res, next) => {
  try {
    const type = String(req.query.entity_type || '').slice(0, 60);
    const entityId = String(req.query.entity_id || '').slice(0, 60);
    if (!type || !entityId) return res.json({ items: [] });
    const items = await safe(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at, COALESCE(a.actor_name, s.full_name) AS actor_name
       FROM audit_log a LEFT JOIN staff_users s ON s.id = a.user_id
       WHERE a.entity_type = $1 AND a.entity_id = $2
       ORDER BY a.created_at DESC LIMIT 50`,
      [type, entityId]
    );
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
module.exports.healthChecks = healthChecks;
