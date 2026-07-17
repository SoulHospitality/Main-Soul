const { query } = require('../config/db');

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

async function getIcalUrl(wpPostId) {
  const { rows } = await query(
    `SELECT ical_url FROM listing_ical
     WHERE wordpress_post_id = $1 AND ical_url IS NOT NULL AND ical_url <> ''`,
    [wpPostId]
  );
  return rows[0]?.ical_url || null;
}

/** Live upstream busy dates for guest availability (soul-website parity). */
async function fetchUpstreamBusyDates(wpPostId, from, to) {
  const url = await getIcalUrl(wpPostId);
  if (!url) return [];
  const text = await fetchWithTimeout(url);
  return parseIcalBusyDates(text, from, to);
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

/**
 * Refresh admin calendar cache `unit_ical_blocks`.
 * On feed failure: skip unit (do not wipe existing rows).
 */
async function refreshIcalBlocks({ monthsAhead = MONTHS_AHEAD } = {}) {
  const today = new Date();
  const from = localIso(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const toDate = new Date(today.getFullYear(), today.getMonth() + monthsAhead, today.getDate());
  const to = localIso(toDate);

  const { rows: listings } = await query(
    `SELECT li.wordpress_post_id, li.ical_url
     FROM listing_ical li
     JOIN units u ON u.wp_post_id = li.wordpress_post_id
     WHERE u.status = 'published'
       AND li.ical_url IS NOT NULL AND li.ical_url <> ''`
  );

  let datesWritten = 0;
  let errors = 0;

  await pool(listings, CONCURRENCY, async (listing) => {
    try {
      const text = await fetchWithTimeout(listing.ical_url);
      const dates = parseIcalBusyDates(text, from, to);
      await query(`BEGIN`);
      try {
        await query(
          `DELETE FROM unit_ical_blocks
           WHERE wp_post_id = $1 AND date >= $2 AND date < $3`,
          [listing.wordpress_post_id, from, to]
        );
        for (const date of dates) {
          await query(
            `INSERT INTO unit_ical_blocks (wp_post_id, date, updated_at)
             VALUES ($1,$2,now())
             ON CONFLICT (wp_post_id, date) DO UPDATE SET updated_at = now()`,
            [listing.wordpress_post_id, date]
          );
          datesWritten++;
        }
        await query(`COMMIT`);
      } catch (err) {
        await query(`ROLLBACK`);
        throw err;
      }
    } catch (err) {
      errors++;
      console.warn('[ical] skip', listing.wordpress_post_id, err.message);
    }
  });

  return {
    feeds: listings.length,
    datesWritten,
    errors,
    from,
    to,
  };
}

module.exports = {
  refreshIcalBlocks,
  parseIcalBusyDates,
  fetchUpstreamBusyDates,
  getIcalUrl,
  fetchWithTimeout,
};
