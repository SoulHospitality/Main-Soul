/**
 * Channel manager sync: every 15 minutes, each enabled channel connection pushes availability and
 * rates out and pulls bookings in. Does nothing until a connection is added.
 */
const cron = require('node-cron');
const { runChannelSync } = require('../lib/channelManager');

let running = false;

function startChannelSyncJob() {
  cron.schedule('*/15 * * * *', async () => {
    if (running) return;
    running = true;
    try {
      const result = await runChannelSync();
      if (result.api_connections) {
        console.log('[channel-sync]', JSON.stringify({ connections: result.api_connections, errors: result.api_errors }));
      }
    } catch (err) {
      console.error('[channel-sync] failed:', err.message);
    } finally {
      running = false;
    }
  });
}

module.exports = { startChannelSyncJob };
