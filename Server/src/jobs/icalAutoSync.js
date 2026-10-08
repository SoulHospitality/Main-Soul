const { query } = require('../config/db');
const { refreshFeedBlocksDetailed, poolMap, MONTHS_AHEAD } = require('../services/ical');
const { writeSyncLog } = require('../lib/channelManager/syncLogs');
const { providerKeyForIcalPlatform } = require('../lib/channelManager/registry');

const DEFAULT_INTERVAL_MS = 60 * 1000;
const FAILED_FEED_RETRY_MINUTES = 5;
const CONCURRENCY = 8;

function localIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

let running = false;

/** Pull every enabled Airbnb / Booking.com calendar; only changed nights are written and logged. */
async function runIcalAutoSync() {
  if (running) return { skipped: true };
  running = true;
  try {
    await query(
      `DELETE FROM unit_ical_blocks b
       USING unit_ota_feeds f
       WHERE f.id = b.feed_id AND f.enabled = false`
    );

    const today = new Date();
    const from = localIso(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
    const to = localIso(new Date(today.getFullYear(), today.getMonth() + MONTHS_AHEAD, today.getDate()));

    const { rows: feeds } = await query(
      `SELECT f.id, f.unit_id, f.wp_post_id, f.platform, f.ical_url, f.last_sync_error
       FROM unit_ota_feeds f
       WHERE f.enabled = true
         AND f.ical_url IS NOT NULL AND f.ical_url <> ''
         AND NOT (
           f.sync_status = 'failed'
           AND f.updated_at > now() - ($1::int * interval '1 minute')
         )`,
      [FAILED_FEED_RETRY_MINUTES]
    );

    let changed = 0;
    let errors = 0;
    await poolMap(feeds, CONCURRENCY, async (feed) => {
      const providerKey = providerKeyForIcalPlatform(feed.platform);
      try {
        const { total, added, removed } = await refreshFeedBlocksDetailed(feed, { from, to });
        if (added.length || removed.length) {
          changed += 1;
          await writeSyncLog({
            feedId: feed.id,
            unitId: feed.unit_id,
            providerKey,
            direction: 'inbound',
            operation: 'availability_pull',
            status: 'success',
            message: `Auto-sync: ${added.length} night(s) blocked, ${removed.length} night(s) freed`,
            details: { total, added, removed },
          });
        }
      } catch (err) {
        errors += 1;
        await query(
          `UPDATE unit_ota_feeds
           SET sync_status = 'failed', last_sync_error = $2, updated_at = now()
           WHERE id = $1`,
          [feed.id, err.message]
        );
        if (feed.last_sync_error !== err.message) {
          await writeSyncLog({
            feedId: feed.id,
            unitId: feed.unit_id,
            providerKey,
            direction: 'inbound',
            operation: 'availability_pull',
            status: 'error',
            message: err.message,
          });
        }
      }
    });
    return { feeds: feeds.length, changed, errors };
  } finally {
    running = false;
  }
}

function startIcalAutoSyncJob() {
  const interval = Math.max(30000, Number(process.env.ICAL_SYNC_INTERVAL_MS) || DEFAULT_INTERVAL_MS);
  const tick = () =>
    runIcalAutoSync().catch((err) => console.error('[ical-auto-sync]', err.message));
  setTimeout(tick, 15000).unref?.();
  const timer = setInterval(tick, interval);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { startIcalAutoSyncJob, runIcalAutoSync };
