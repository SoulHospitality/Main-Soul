/**
 * One-shot: demote published incomplete units to draft; leave complete drafts alone.
 * Usage: DATABASE_URL=... node scripts/sync-unit-listing-status.js
 */
require('dotenv').config();
const { query, pool } = require('../src/config/db');
const { syncUnitListingStatus } = require('../src/lib/unitListingStatus');

async function main() {
  const { rows } = await query(
    `SELECT id, title, status FROM units WHERE status IN ('published', 'draft') ORDER BY title`
  );
  let demoted = 0;
  let unchanged = 0;
  for (const row of rows) {
    const before = row.status;
    const synced = await syncUnitListingStatus(row.id, { requestedStatus: row.status });
    if (!synced) continue;
    if (synced.status !== before) {
      demoted += 1;
      const missing = synced._completeness?.missing?.join(', ') || '';
      console.log(`${before} → ${synced.status}: ${row.title} (${missing})`);
    } else {
      unchanged += 1;
    }
  }
  console.log(`Done. Changed: ${demoted}, unchanged: ${unchanged}, total: ${rows.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
