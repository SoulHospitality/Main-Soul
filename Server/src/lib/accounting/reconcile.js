/**
 * Ledger ↔ subledger matching (gl-recon method): full outer join on a key, exact money comparison,
 * each break put in a bucket with a likely cause for the person resolving it.
 *
 * Buckets: matched · amount_break · timing_break · ledger_only · subledger_only
 */
const m = require('./money');

function reconcile(ledgerRows, subledgerRows, { key = (r) => r.key, tolerance = '0' } = {}) {
  const tol = m.money(tolerance);
  const left = new Map(ledgerRows.map((r) => [key(r), r]));
  const right = new Map(subledgerRows.map((r) => [key(r), r]));
  const keys = new Set([...left.keys(), ...right.keys()]);
  const out = { matched: [], amount_break: [], timing_break: [], ledger_only: [], subledger_only: [] };
  for (const k of keys) {
    const a = left.get(k);
    const b = right.get(k);
    if (!a) { out.subledger_only.push({ key: k, subledger: b, cause: 'missing post' }); continue; }
    if (!b) { out.ledger_only.push({ key: k, ledger: a, cause: 'missing or deleted source' }); continue; }
    const delta = m.sub(a.amount, b.amount);
    if (delta.abs().gt(tol)) {
      out.amount_break.push({ key: k, ledger: a, subledger: b, delta: m.toFixed(delta), cause: delta.abs().lte(1) ? 'rounding' : 'amount or mapping' });
    } else if (a.date && b.date && String(a.date).slice(0, 10) !== String(b.date).slice(0, 10)) {
      out.timing_break.push({ key: k, ledger: a, subledger: b, cause: 'posting date' });
    } else {
      out.matched.push({ key: k });
    }
  }
  const total = keys.size || 1;
  return {
    ...out,
    summary: {
      keys: keys.size,
      matched_pct: m.toFixed(m.div(out.matched.length * 100, total)),
      breaks: keys.size - out.matched.length,
    },
  };
}

module.exports = { reconcile };
