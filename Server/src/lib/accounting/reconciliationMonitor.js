/**
 * Phase 7: recurring reconciliation and exception monitoring. Reconciles the stored ledger against the reference
 * calculation for the previous and current month and records the result (migration 178). Only reads the ledger;
 * runs only while posting is on (before that there is nothing to reconcile, and nothing is recorded).
 */
const { query: defaultQuery } = require('../../config/db');
const { reconcile } = require('./historicalMigration');

/** How old the last clean run may be before Data health flags it (a nightly job plus slack). */
const STALE_HOURS = 36;

function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function previousMonthStart(isoDate) {
  const [y, m] = isoDate.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 10);
}

async function state(query) {
  const { rows } = await query(
    `SELECT to_regclass('public.ledger_reconciliation_runs') IS NOT NULL AS installed,
            (SELECT value_text FROM financial_settings WHERE key = 'ledger_posting') AS posting`
  );
  return { installed: Boolean(rows[0]?.installed), live: rows[0]?.posting === 'on' };
}

/** Run and record one reconciliation. Returns the stored run, or { skipped } with the reason. */
async function runReconciliation({ trigger = 'nightly', runBy = null, from = null, to = null } = {}, deps = {}) {
  const query = deps.query || defaultQuery;
  const st = await state(query);
  if (!st.installed) return { skipped: 'not installed (migration 178)' };
  if (!st.live) return { skipped: 'ledger posting is off' };
  const periodTo = to || cairoToday();
  const periodFrom = from || previousMonthStart(periodTo);
  const r = await reconcile({ from: periodFrom, to: periodTo }, deps);
  const { rows } = await query(
    `INSERT INTO ledger_reconciliation_runs (trigger, run_by, period_from, period_to, clean, buckets, account_differences, sample)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb) RETURNING *`,
    [trigger, runBy, periodFrom, periodTo, r.clean, JSON.stringify(r.buckets), JSON.stringify(r.accountsWithDifferences), JSON.stringify(r.rows.slice(0, 50))]
  );
  return rows[0];
}

/** Latest runs for the Ledger controls page. */
async function recentRuns(limit = 10, deps = {}) {
  const query = deps.query || defaultQuery;
  const st = await state(query);
  if (!st.installed) return { installed: false, live: st.live, runs: [] };
  const { rows } = await query(
    `SELECT r.id, r.ran_at, r.trigger, r.period_from::text AS period_from, r.period_to::text AS period_to, r.clean, r.buckets,
            jsonb_array_length(r.account_differences) AS accounts_off, s.full_name AS run_by_name
     FROM ledger_reconciliation_runs r LEFT JOIN staff_users s ON s.id = r.run_by
     ORDER BY r.ran_at DESC, r.id DESC LIMIT $1`,
    [limit]
  );
  return { installed: true, live: st.live, runs: rows };
}

/**
 * Exception for Data health: while the ledger is live, the latest run must exist, be clean and be recent.
 * Returns null when there is nothing to check (not installed, or posting off).
 */
async function healthCheck(deps = {}) {
  const query = deps.query || defaultQuery;
  const st = await state(query);
  if (!st.installed || !st.live) return null;
  const { rows } = await query(
    `SELECT id, ran_at, clean, buckets, period_from::text AS period_from, period_to::text AS period_to,
            EXTRACT(EPOCH FROM (now() - ran_at)) / 3600 AS hours
     FROM ledger_reconciliation_runs ORDER BY ran_at DESC, id DESC LIMIT 1`
  );
  const last = rows[0];
  const problem = !last ? 'never' : !last.clean ? 'differences' : Number(last.hours) > STALE_HOURS ? 'stale' : null;
  return {
    id: 'ledger_not_reconciled',
    severity: 'high',
    count: problem ? 1 : 0,
    amount: 0,
    tool: 'ledger',
    rows: problem
      ? [{ id: last?.id || 'none', ref: problem, check_in: last?.ran_at ? String(last.ran_at).slice(0, 10) : null, guest_name: last ? `${last.period_from} → ${last.period_to}` : null }]
      : [],
  };
}

module.exports = { runReconciliation, recentRuns, healthCheck, STALE_HOURS };
