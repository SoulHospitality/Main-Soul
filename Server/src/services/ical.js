const { query } = require('../config/db');
const { icalSourceForPlatform } = require('../lib/otaPlatforms');

const FEED_TIMEOUT_MS = 9000;
const CONCURRENCY = 8;
const MONTHS_AHEAD = 8;

function localIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysIso(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localIso(d);
}

function ymd(s) {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function parseIcalBusyDates(ics, fromIso, toIso) {
  const dates = new Set();
  const normalized = String(ics || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '');
  const events = normalized.split('BEGIN:VEVENT');
  const toExcl = toIso || '9999-12-31';
  const from = fromIso || '1970-01-01';

  for (const ev of events.slice(1)) {
    const startRaw = /DTSTART[^:]*:([0-9]{8})/.exec(ev)?.[1];
    const endRaw = /DTEND[^:]*:([0-9]{8})/.exec(ev)?.[1];
    if (!startRaw) continue;
    const start = ymd(startRaw);
    const end = endRaw ? ymd(endRaw) : addDaysIso(start, 1);
    const walkStart = start > from ? start : from;
    const walkEnd = end < toExcl ? end : toExcl;
    for (let d = new Date(`${walkStart}T00:00:00`); localIso(d) < walkEnd; d.setDate(d.getDate() + 1)) {
      dates.add(localIso(d));
    }
  }
  return [...dates];
}

async function fetchWithTimeout(url, ms = FEED_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function getEnabledOtaFeeds({ unitId = null } = {}) {
  const params = [];
  let filter = '';
  if (unitId) {
    filter = 'AND f.unit_id = $1';
    params.push(unitId);
  }
  const { rows } = await query(
    `SELECT f.id, f.unit_id, f.wp_post_id, f.platform, f.label, f.ical_url, f.enabled,
            f.last_sync_at, f.last_sync_error, f.updated_at,
            u.slug AS unit_slug, u.title AS unit_title, u.status AS unit_status
     FROM unit_ota_feeds f
     JOIN units u ON u.id = f.unit_id
     WHERE f.enabled = true
       AND f.ical_url IS NOT NULL AND f.ical_url <> ''
       AND u.status = 'published'
       ${filter}
     ORDER BY u.title NULLS LAST, f.platform`,
    params
  );
  return rows;
}

async function pool(items, concurrency, fn) {
  let i = 0;
  const n = Math.min(concurrency, items.length || 1);
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx]);
      }
    })
  );
}

async function refreshFeedBlocks(feed, { from, to }) {
  const text = await fetchWithTimeout(feed.ical_url);
  const dates = parseIcalBusyDates(text, from, to);
  await query(`BEGIN`);
  try {
    await query(
      `DELETE FROM unit_ical_blocks
       WHERE feed_id = $1 AND date >= $2 AND date < $3`,
      [feed.id, from, to]
    );
    for (const date of dates) {
      await query(
        `INSERT INTO unit_ical_blocks (feed_id, wp_post_id, platform, date, updated_at)
         VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (feed_id, date) DO UPDATE SET updated_at = now(), platform = EXCLUDED.platform`,
        [feed.id, feed.wp_post_id, feed.platform, date]
      );
    }
    await query(
      `UPDATE unit_ota_feeds
       SET last_sync_at = now(), last_sync_error = NULL, updated_at = now()
       WHERE id = $1`,
      [feed.id]
    );
    await query(`COMMIT`);
  } catch (err) {
    await query(`ROLLBACK`);
    throw err;
  }
  return dates.length;
}

async function refreshIcalBlocks({ monthsAhead = MONTHS_AHEAD, unitId = null } = {}) {
  const today = new Date();
  const from = localIso(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const toDate = new Date(today.getFullYear(), today.getMonth() + monthsAhead, today.getDate());
  const to = localIso(toDate);

  const feeds = await getEnabledOtaFeeds({ unitId });

  let datesWritten = 0;
  let errors = 0;
  const feedErrors = [];

  await pool(feeds, CONCURRENCY, async (feed) => {
    try {
      const count = await refreshFeedBlocks(feed, { from, to });
      datesWritten += count;
    } catch (err) {
      errors++;
      feedErrors.push({ feed_id: feed.id, platform: feed.platform, error: err.message });
      await query(
        `UPDATE unit_ota_feeds
         SET last_sync_error = $2, updated_at = now()
         WHERE id = $1`,
        [feed.id, err.message]
      );
      console.warn('[ical] skip', feed.platform, feed.unit_slug, err.message);
    }
  });

  return {
    feeds: feeds.length,
    datesWritten,
    errors,
    feedErrors,
    from,
    to,
  };
}

/** @deprecated legacy single-feed helper */
async function getIcalUrl(wpPostId) {
  const { rows } = await query(
    `SELECT ical_url FROM unit_ota_feeds
     WHERE wp_post_id = $1 AND enabled = true AND ical_url IS NOT NULL AND ical_url <> ''
     ORDER BY updated_at DESC
     LIMIT 1`,
    [wpPostId]
  );
  return rows[0]?.ical_url || null;
}

async function fetchUpstreamBusyDates(wpPostId, from, to) {
  const { rows: feeds } = await query(
    `SELECT id, wp_post_id, platform, ical_url
     FROM unit_ota_feeds
     WHERE wp_post_id = $1 AND enabled = true AND ical_url IS NOT NULL AND ical_url <> ''`,
    [wpPostId]
  );
  const dates = new Set();
  for (const feed of feeds) {
    try {
      const text = await fetchWithTimeout(feed.ical_url);
      for (const date of parseIcalBusyDates(text, from, to)) dates.add(date);
    } catch (err) {
      console.warn('[ical] upstream skip', feed.platform, err.message);
    }
  }
  return [...dates];
}

module.exports = {
  refreshIcalBlocks,
  parseIcalBusyDates,
  fetchUpstreamBusyDates,
  getIcalUrl,
  fetchWithTimeout,
  getEnabledOtaFeeds,
  refreshFeedBlocks,
  icalSourceForPlatform,
};
