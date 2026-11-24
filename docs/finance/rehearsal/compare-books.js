/**
 * Rehearsal: fingerprint of the books the app shows (trial balance, every journal line, and each month's
 * closing entry) from a chosen version of the existing engine. READ-ONLY: the engine only runs SELECTs.
 *
 *   REHEARSAL_DATABASE_URL=postgres://…restored-copy… node docs/finance/rehearsal/compare-books.js 2026-10-01 2026-11-30
 *
 * Which code to use (separates the two sources of change, see rehearsal/README.md §4):
 *   REHEARSAL_SERVER_DIR=/path/to/a/checkout/of/main/Server   → the code production runs today
 *   (unset)                                                     → this repository's Server (the new code)
 * Run it with the SAME code before and after the migrations to see the migrations' effect (must be none),
 * and with old vs new code on the SAME database to see the engine fixes' effect (expected differences).
 *
 * Refuses to run without REHEARSAL_DATABASE_URL, so it never falls back to the production URL in .env.
 * Output: per-account totals and closing-entry lines (account codes and amounts only, no personal data).
 */
const path = require('path');

function serverDir() {
  return process.env.REHEARSAL_SERVER_DIR || path.join(__dirname, '../../../Server');
}

async function fingerprint(from, to) {
  const engine = require(path.join(serverDir(), 'src/lib/finance/ledgerEngine.js'));
  const data = await engine.loadPortalData(from, to);
  const journal = engine.buildJournal(data, from, to);
  const rows = engine.balancesFromJournal(journal)
    .map((b) => [b.code, Number(b.debit || 0).toFixed(2), Number(b.credit || 0).toFixed(2), b.txn_count])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const crypto = require('crypto');
  const sha = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
  // Every entry's id, date and lines (hashed only: entries carry guest details that are never printed).
  const journalHash = sha(journal.map((e) => [e.id, e.date, (e.lines || []).map((l) => [l.account, l.debit || 0, l.credit || 0])]));
  // Closing entries month by month (regenerated live by the engine, never stored), so old and new code
  // can be compared line by line for every closed month.
  const closes = journal
    .filter((e) => e.type === 'period_close')
    .map((e) => ({
      id: e.id,
      balanced: Math.abs((e.debit || 0) - (e.credit || 0)) < 0.005,
      lines: (e.lines || []).map((l) => [l.account, Number(l.debit || 0).toFixed(2), Number(l.credit || 0).toFixed(2)]),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { server: serverDir(), from, to, entries: journal.length, accounts: rows.length, trialBalanceHash: sha(rows), journalHash, closes, rows };
}

if (require.main === module) {
  const url = process.env.REHEARSAL_DATABASE_URL;
  if (!url) {
    console.error('Set REHEARSAL_DATABASE_URL to the restored copy. This script never uses the .env database.');
    process.exit(2);
  }
  process.env.DATABASE_URL = url; // dotenv does not override an existing variable
  const [from = '2026-10-01', to = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
  fingerprint(from, to)
    .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { fingerprint };
