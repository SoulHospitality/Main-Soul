/**
 * Nightly stored-ledger operation (Phases 5–7), Cairo time: post the day's new activity, then reconcile. Does nothing
 * until ledger posting is on and an approved policy is in force.
 */
const cron = require('node-cron');
const { runReconciliation } = require('../lib/accounting/reconciliationMonitor');
const { autoSync } = require('../lib/accounting/ledgerOperations');

function startLedgerReconciliationJob() {
  cron.schedule('30 4 * * *', () => {
    autoSync()
      .then((s) => {
        if (!s.skipped) console.log('[ledger-sync] nightly', JSON.stringify({ posted: s.posted, pendingChanges: s.pendingChanges, failed: s.failed?.length ?? s.failed }));
      })
      .catch((err) => console.error('[ledger-sync] nightly failed:', err.message))
      .then(() => runReconciliation({ trigger: 'nightly' }))
      .then((r) => {
        if (r.skipped) return;
        const level = r.clean ? 'log' : 'error';
        console[level]('[ledger-reconciliation] nightly', JSON.stringify({ clean: r.clean, buckets: r.buckets, from: r.period_from, to: r.period_to }));
      })
      .catch((err) => console.error('[ledger-reconciliation] nightly failed:', err.message));
  }, { timezone: 'Africa/Cairo' });
}

module.exports = { startLedgerReconciliationJob };
