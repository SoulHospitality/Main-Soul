/**
 * Day-to-day ledger operation (Phases 5–7) once posting is on:
 *   autoSync()   nightly: posts the day's new activity under the approved policy in force (origin 'system');
 *                entries whose source changed are left for a person (pendingChanges).
 *   manualSync() "Sync changes" by a CEO or financial manager: also replaces changed entries (reversal + linked
 *                replacement), under that person's verified identity.
 * Both cover the approved policy's effective date to today (Cairo), so nothing before the books start is touched.
 */
const { query: defaultQuery } = require('../../config/db');
const mig = require('./historicalMigration');

function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** The approved policy in force today and its start date, or null (posting off, or no approved policy). */
async function liveRange({ query = defaultQuery, to = null } = {}) {
  const { rows } = await query(
    `SELECT (SELECT value_text FROM financial_settings WHERE key = 'ledger_posting') AS posting,
            p.version, p.effective_from::text AS effective_from
     FROM (SELECT public.ledger_policy_in_force($1::date) AS v) x
     LEFT JOIN ledger_policies p ON p.version = x.v`,
    [to || cairoToday()]
  ).catch((e) => {
    if (e.code === '42P01' || e.code === '42883') return { rows: [] };
    throw e;
  });
  const r = rows[0];
  if (!r || r.posting !== 'on' || !r.version) return null;
  return { policyVersion: r.version, from: r.effective_from, to: to || cairoToday() };
}

async function run({ actorId = null, replaceChanged, to = null } = {}, deps = {}) {
  const range = await liveRange({ query: deps.query || defaultQuery, to });
  if (!range) return { skipped: 'ledger posting is off or no approved policy is in force' };
  const p = await mig.plan(range, deps);
  if (p.errors.length || !p.balanced) return { failed: 'plan', errors: p.errors.slice(0, 20), accountDiffs: p.accountDiffs, range };
  const result = await mig.sync(p, { actorId, replaceChanged, origin: 'system', reason: 'Sync changes: the source record changed' }, deps);
  return { ...result, range };
}

const autoSync = (opts = {}, deps = {}) => run({ ...opts, actorId: null, replaceChanged: false }, deps);
const manualSync = ({ actorId, ...opts }, deps = {}) => run({ ...opts, actorId, replaceChanged: true }, deps);

module.exports = { autoSync, manualSync, liveRange, cairoToday };
