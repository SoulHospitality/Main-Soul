/**
 * Read-only views of the stored ledger (migration 176) and the commission snapshots (migration 175) for the
 * Financial System. Nothing here writes: switching posting on, approving policies and correcting snapshots stay
 * in the verified, logged procedures (docs/finance/db-security). Works before the migrations are applied too:
 * each section then reports `deployed: false` instead of failing.
 */
const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { identityKey } = require('../../lib/accounting/identity');

const router = express.Router();
const FINANCE = requireRoles('admin', 'finance', 'finance_manager');

async function relationExists(name) {
  const { rows } = await query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${name}`]);
  return Boolean(rows[0]?.ok);
}

/** Whether the server can attest staff identity to the ledger. Reports configured/missing/invalid, never the key. */
function identityStatus() {
  try {
    return identityKey() ? 'configured' : 'missing';
  } catch {
    return 'invalid';
  }
}

router.get('/financial-system/ledger-controls', FINANCE, async (_req, res, next) => {
  try {
    const deployed = await relationExists('ledger_entries');
    const migrations = (
      await query(
        `SELECT id, applied_at FROM _schema_migrations WHERE id IN ('175_commission_snapshots.sql', '176_ledger_core.sql') ORDER BY id`
      ).catch(() => ({ rows: [] }))
    ).rows;
    if (!deployed) {
      return res.json({ deployed: false, migrations, identity: identityStatus() });
    }

    const [posting, policies, approvals, totals, periods, log, reports] = await Promise.all([
      query(`SELECT value_text FROM financial_settings WHERE key = 'ledger_posting'`),
      query(
        `SELECT p.version, p.effective_from, p.status, p.created_at,
                p.settings->>'revenue_presentation' AS revenue_presentation, p.settings->>'vat_base' AS vat_base,
                p.approved_at, p.approval_ref, p.vat_approved_at, p.vat_approval_ref,
                cb.full_name AS created_by_name, ab.full_name AS approved_by_name, vb.full_name AS vat_approved_by_name
         FROM ledger_policies p
         LEFT JOIN staff_users cb ON cb.id = p.created_by
         LEFT JOIN staff_users ab ON ab.id = p.approved_by
         LEFT JOIN staff_users vb ON vb.id = p.vat_approved_by
         ORDER BY p.effective_from DESC, p.created_at DESC`
      ),
      query(
        `SELECT a.purpose, a.subject, a.approved_at, s.full_name AS approver_name
         FROM ledger_approvals a LEFT JOIN staff_users s ON s.id = a.approver_id
         ORDER BY a.approved_at DESC LIMIT 50`
      ),
      query(
        `SELECT COUNT(*)::int AS entries,
                COUNT(*) FILTER (WHERE status = 'reversed')::int AS reversed,
                COUNT(*) FILTER (WHERE origin = 'manual')::int AS manual,
                COUNT(*) FILTER (WHERE origin = 'migrated')::int AS migrated,
                MAX(created_at) AS last_entry_at,
                (SELECT COUNT(*)::int FROM ledger_lines) AS lines
         FROM ledger_entries`
      ),
      query(
        `SELECT p.period, p.status, p.closed_at, p.reopened_at, p.reopen_reason, c.full_name AS closed_by_name
         FROM ledger_periods p LEFT JOIN staff_users c ON c.id = p.closed_by
         ORDER BY p.period DESC LIMIT 24`
      ),
      query(
        `SELECT l.control, l.old_value, l.new_value, l.reason, l.changed_at, s.full_name AS actor_name
         FROM ledger_control_log l LEFT JOIN staff_users s ON s.id = l.actor_id
         ORDER BY l.changed_at DESC LIMIT 25`
      ),
      query(`SELECT value_text FROM financial_settings WHERE key = 'ledger_reports'`),
    ]);

    const policyRows = policies.rows.map((p) => ({
      ...p,
      d01_approved: Boolean(p.approved_at),
      vat_approved: Boolean(p.vat_approved_at),
    }));
    const inForce = policyRows.find((p) => p.status === 'approved') || null;
    res.json({
      deployed: true,
      migrations,
      identity: identityStatus(),
      posting: { state: posting.rows[0]?.value_text || 'off', last_change: log.rows.find((r) => r.control === 'ledger_posting') || null },
      // Phase 6 (migration 177): which source the statements read; 'engine' until switched by a verified admin.
      reports: { source: reports.rows[0]?.value_text || 'engine', installed: reports.rows.length > 0, last_change: log.rows.find((r) => r.control === 'ledger_reports') || null },
      gates: {
        revenue_presentation: Boolean(inForce?.d01_approved),
        vat_base: Boolean(inForce?.vat_approved),
        // The historical commission method is a written decision kept outside the system (ACCOUNTANT_DECISION_TRACKER.md).
        commission_method: null,
      },
      policy_in_force: inForce,
      policies: policyRows,
      approvals: approvals.rows,
      ledger: totals.rows[0],
      periods: periods.rows,
      control_log: log.rows,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/commission-review', FINANCE, async (_req, res, next) => {
  try {
    const deployed = await relationExists('reservation_commission_review');
    if (!deployed) return res.json({ deployed: false });
    const [since, counts, rows, corrections] = await Promise.all([
      query(`SELECT value_text FROM financial_settings WHERE key = 'commission_snapshots_since'`),
      query(
        `SELECT COALESCE(commission_snapshot_status, 'none') AS status, COUNT(*)::int AS n
         FROM reservations WHERE status IN ('confirmed', 'checked_in', 'checked_out')
         GROUP BY 1`
      ),
      query(
        `SELECT v.reservation_id, v.status, v.check_in, v.check_out, v.commission_snapshot_status, v.review_reason,
                r.guest_name, r.total_amount, r.currency, u.title AS unit_title, s.full_name AS salesperson
         FROM reservation_commission_review v
         JOIN reservations r ON r.id = v.reservation_id
         LEFT JOIN units u ON u.id = v.unit_id
         LEFT JOIN staff_users s ON s.id = v.sales_person_id
         ORDER BY v.check_in DESC NULLS LAST
         LIMIT 500`
      ),
      query(
        `SELECT COUNT(*)::int AS n, MAX(created_at) AS last_at FROM reservation_commission_corrections`
      ).catch(() => ({ rows: [{ n: 0, last_at: null }] })),
    ]);
    const byStatus = Object.fromEntries(counts.rows.map((r) => [r.status, r.n]));
    res.json({
      deployed: true,
      since: since.rows[0]?.value_text || null,
      counts: {
        captured: byStatus.captured || 0,
        needs_review: byStatus.needs_review || 0,
        corrected: byStatus.corrected || 0,
        none: byStatus.none || 0,
      },
      review_total: rows.rows.length,
      rows: rows.rows,
      corrections: corrections.rows[0],
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
