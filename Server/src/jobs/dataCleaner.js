/** Data cleaner schedule (Cairo time): a full run every night, and a size check every 6 hours. */
const cron = require('node-cron');
const { runCleaner, checkPressure } = require('../lib/dataCleaner');

const TZ = 'Africa/Cairo';

function startDataCleanerJob() {
  cron.schedule('45 3 * * *', () => {
    runCleaner({ trigger: 'auto' })
      .then((r) => console.log('[data-cleaner] nightly', JSON.stringify({ sizeBefore: r.sizeBefore, sizeAfter: r.sizeAfter, tight: r.tight })))
      .catch((err) => console.error('[data-cleaner] nightly failed:', err.message));
  }, { timezone: TZ });
  cron.schedule('15 */6 * * *', () => {
    checkPressure().catch((err) => console.error('[data-cleaner] size check failed:', err.message));
  }, { timezone: TZ });
}

module.exports = { startDataCleanerJob };
