/** Nightly stored-ledger reconciliation (Phase 7), Cairo time. Does nothing until ledger posting is on. */
const cron = require('node-cron');
const { runReconciliation } = require('../lib/accounting/reconciliationMonitor');

function startLedgerReconciliationJob() {
  cron.schedule('30 4 * * *', () => {
    runReconciliation({ trigger: 'nightly' })
      .then((r) => {
        if (r.skipped) return;
        const level = r.clean ? 'log' : 'error';
        console[level]('[ledger-reconciliation] nightly', JSON.stringify({ clean: r.clean, buckets: r.buckets, from: r.period_from, to: r.period_to }));
      })
      .catch((err) => console.error('[ledger-reconciliation] nightly failed:', err.message));
  }, { timezone: 'Africa/Cairo' });
}

module.exports = { startLedgerReconciliationJob };
