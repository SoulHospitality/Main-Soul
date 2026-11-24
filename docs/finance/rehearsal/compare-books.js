/**
 * Rehearsal: fingerprint of the books the app shows (trial balance from the existing engine), so the
 * output before and after migrations 175/176 can be compared. READ-ONLY: the engine only runs SELECTs.
 *
 *   REHEARSAL_DATABASE_URL=postgres://…restored-copy… node docs/finance/rehearsal/compare-books.js 2026-10-01 2026-11-30
 *
 * Refuses to run without REHEARSAL_DATABASE_URL, so it never falls back to the production URL in .env.
 * Prints per-account totals (numbers only, no names of people) and one hash of the whole trial balance.
 */
const path = require('path');

async function fingerprint(from, to) {
  const engine = require(path.join(__dirname, '../../../Server/src/lib/finance/ledgerEngine.js'));
  const data = await engine.loadPortalData(from, to);
  const journal = engine.buildJournal(data, from, to);
  const rows = engine.balancesFromJournal(journal)
    .map((b) => [b.code, Number(b.debit || 0).toFixed(2), Number(b.credit || 0).toFixed(2), b.txn_count])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const crypto = require('crypto');
  const sha = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
  // Every entry's id, date and lines (hashed only: entries carry guest details that are never printed).
  const journalHash = sha(journal.map((e) => [e.id, e.date, (e.lines || []).map((l) => [l.account, l.debit || 0, l.credit || 0])]));
  return { from, to, entries: journal.length, accounts: rows.length, trialBalanceHash: sha(rows), journalHash, rows };
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
