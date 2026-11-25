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
const monitor = require('../../lib/accounting/reconciliationMonitor');
const POLICY = require('../../lib/accounting/policies/2026.11.json');

// CEOs (role admin) and financial managers run the go-live and the ledger (owner's decision, 2026-11-25; migration 179).
const MANAGE = requireRoles('admin', 'finance_manager');

/** A database refusal (a guard or rule) is the user's answer, not a server fault. */
function refusal(res, e) {
  const msg = String(e.message || e);
  return res.status(409).json({ error: msg.replace(/^.*?ERROR:s*/, '') });
}

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

/** The policy to approve (from the server's policy file), its recorded approvals, and what this user may do. */
async function goliveState(user) {
  const { rows: approvals } = await query(
    `SELECT a.purpose, a.approver_id, s.full_name AS approver_name, a.approved_at
     FROM ledger_approvals a LEFT JOIN staff_users s ON s.id = a.approver_id
     WHERE a.subject = $1 AND a.purpose IN ('policy_d01', 'policy_vat') ORDER BY a.approved_at`,
    [POLICY.version]
  );
  const { rows: rec } = await query(`SELECT status FROM ledger_policies WHERE version = $1`, [POLICY.version]);
  const role = user?.role;
  return {
    policy: { version: POLICY.version, effective_from: POLICY.effective_from, settings: POLICY.settings, source: POLICY.source },
    approvals,
    status: rec[0]?.status || null,
    me: { id: user?.id || null, can_manage: role === 'admin' || role === 'finance_manager', approved: approvals.filter((a) => a.approver_id === user?.id).map((a) => a.purpose) },
  };
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
      reconciliation: await monitor.recentRuns(10),
      golive: await goliveState(_req.user),
    });
  } catch (e) {
    next(e);
  }
});

/** Accountant's decisions in force (2026-11-25): VAT suspension date and the historical-commission decision. */
router.get('/financial-system/vat-policy', FINANCE, async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT key, value_text FROM financial_settings WHERE key IN ('vat_suspended_from', 'wht_suspended_from', 'commission_history_decision')`);
    const s = Object.fromEntries(rows.map((r) => [r.key, r.value_text]));
    res.json({ vat_suspended_from: s.vat_suspended_from || null, wht_suspended_from: s.wht_suspended_from || null, commission_history_decision: s.commission_history_decision || null });
  } catch (e) {
    next(e);
  }
});

/** Go-live step: the logged-in CEO or financial manager records their own approval ('d01' revenue, or 'vat' taxes). */
router.post('/financial-system/ledger/approve', MANAGE, async (req, res, next) => {
  try {
    const purpose = req.body?.purpose;
    if (!['d01', 'vat'].includes(purpose)) return res.status(400).json({ error: 'purpose must be d01 or vat' });
    await require('../../lib/accounting/policy').approve({ version: POLICY.version, purpose, actorId: req.user.id });
    res.json({ approved: purpose, version: POLICY.version });
  } catch (e) {
    if (e.code && /^[0-9A-Z]{5}$/.test(e.code)) return refusal(res, e);
    if (/approval|admin|identity|claim/i.test(e.message || '')) return refusal(res, e);
    next(e);
  }
});

/** Go-live step: a CEO or financial manager who did NOT approve records the policy as approved, citing the basis. */
router.post('/financial-system/ledger/record', MANAGE, async (req, res, next) => {
  try {
    const reference = String(req.body?.reference || '').trim();
    if (reference.length < 10) return res.status(400).json({ error: 'Give the basis of the approval (10+ characters)' });
    const { rows } = await query(
      `SELECT purpose, approver_id FROM ledger_approvals WHERE subject = $1 AND purpose IN ('policy_d01', 'policy_vat') ORDER BY approved_at DESC`,
      [POLICY.version]
    );
    const d01 = rows.find((r) => r.purpose === 'policy_d01');
    const vat = rows.find((r) => r.purpose === 'policy_vat');
    if (!d01 || !vat) return res.status(409).json({ error: 'Both approvals (revenue and taxes) must be recorded first' });
    const row = await require('../../lib/accounting/policy').recordApproved({
      version: POLICY.version, effectiveFrom: POLICY.effective_from, settings: POLICY.settings, recorderId: req.user.id,
      d01ApproverId: d01.approver_id, d01Ref: reference, vatApproverId: vat.approver_id, vatRef: reference,
    });
    res.json(row);
  } catch (e) {
    if (e.code && /^[0-9A-Z]{5}$/.test(e.code)) return refusal(res, e);
    next(e);
  }
});

/** Posting switch and report source: a CEO or financial manager, with a reason; verified and logged by the database. */
router.post('/financial-system/ledger/switch', MANAGE, async (req, res, next) => {
  try {
    const { control, value, reason } = req.body || {};
    if (String(reason || '').trim().length < 10) return res.status(400).json({ error: 'Give a reason (10+ characters)' });
    if (control === 'posting' && ['on', 'off'].includes(value)) {
      await require('../../lib/accounting/posting').setPostingSwitch(value, { actorId: req.user.id, reason: String(reason) });
    } else if (control === 'reports' && ['ledger', 'engine'].includes(value)) {
      await require('../../lib/accounting/reportSource').setReportSource(value, { actorId: req.user.id, reason: String(reason) });
    } else return res.status(400).json({ error: 'control/value must be posting on|off or reports ledger|engine' });
    res.json({ control, value });
  } catch (e) {
    if ((e.code && /^[0-9A-Z]{5}$/.test(e.code)) || /posting|report|admin|policy/i.test(e.message || '')) return refusal(res, e);
    next(e);
  }
});

/** "Sync changes": post new activity and replace changed entries under this person's identity, then reconcile. */
router.post('/financial-system/ledger/sync', MANAGE, async (req, res, next) => {
  try {
    const s = await require('../../lib/accounting/ledgerOperations').manualSync({ actorId: req.user.id });
    if (s.skipped) return res.status(409).json({ error: s.skipped });
    const run = await monitor.runReconciliation({ trigger: 'manual', runBy: req.user.id });
    res.json({ sync: s, reconciliation: run });
  } catch (e) {
    if (e.code && /^[0-9A-Z]{5}$/.test(e.code)) return refusal(res, e);
    next(e);
  }
});

/** Phase 7: reconcile now (reads the ledger; records the result). Refused unless posting is on. */
router.post('/financial-system/ledger-reconcile', FINANCE, async (req, res, next) => {
  try {
    const run = await monitor.runReconciliation({ trigger: 'manual', runBy: req.user?.id || null });
    if (run.skipped) return res.status(409).json({ error: run.skipped });
    res.json(run);
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/commission-review', FINANCE, async (_req, res, next) => {
  try {
    const deployed = await relationExists('reservation_commission_review');
    if (!deployed) return res.json({ deployed: false });
    const [since, counts, rows, corrections, decision] = await Promise.all([
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
      query(`SELECT value_text FROM financial_settings WHERE key = 'commission_history_decision'`),
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
      // Accountant, 2026-11-25: historical commissions were already paid; no rate reconstruction is needed.
      history_decision: decision.rows[0]?.value_text || null,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
