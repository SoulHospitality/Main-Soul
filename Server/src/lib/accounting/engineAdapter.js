/**
 * Engine → stored-ledger adapter. Turns an entry from the existing computed engine
 * (lib/finance/ledgerEngine.js, the reference) into the posting-service format, WITHOUT changing any
 * amount. Used by parity tests now, and by the historical migration later (DATA_MIGRATION_PLAN Step 2,
 * blocked until D-01, VAT base and the commission methodology are approved).
 *
 * Representation fixes (balances and gross amounts are unchanged; each one is reported in `notes`):
 *  - a line with a negative debit or credit is moved to the other side (the stored ledger only takes
 *    positive one-sided lines);
 *  - a line with both a debit and a credit is split into two one-sided lines (never netted);
 *  - zero lines are dropped;
 *  - the unit dimension is filled from `unitOf` (reservation id → unit id) when given;
 *  - lines on a USD-only account (104000 Cash USD) post in USD using the line's dollar figure and the
 *    line's effective rate (EGP ÷ USD), so the EGP base equals the engine's EGP amount exactly.
 * Anything it cannot represent faithfully throws, so a migration never silently alters the books.
 */
const m = require('./money');

class AdapterError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function toLedgerEntry(engineEntry, { policyVersion, usdAccounts = ['104000'], keyPrefix = 'engine', actorId = null, unitOf = null } = {}) {
  const notes = [];
  const lines = [];
  const reservationId = engineEntry.meta?.reservation_id ?? null;
  const unitId = reservationId != null && unitOf ? (unitOf instanceof Map ? unitOf.get(reservationId) : unitOf[reservationId]) || null : null;
  for (const [i, l] of (engineEntry.lines || []).entries()) {
    const debit = m.money(l.debit || 0);
    const credit = m.money(l.credit || 0);
    // Gross amounts per side: a negative debit is a credit and vice versa. A line with both sides is
    // split into two one-sided lines (not netted), so both the balance and the gross turnover are kept.
    const dr = m.max(debit, 0).plus(m.max(credit.neg(), 0));
    const cr = m.max(credit, 0).plus(m.max(debit.neg(), 0));
    if (debit.isNegative() || credit.isNegative()) notes.push(`line ${i + 1} (${l.account}): negative amount moved to the other side`);
    if (dr.gt(0) && cr.gt(0)) notes.push(`line ${i + 1} (${l.account}): debit and credit on one line split into two lines`);
    if (dr.isZero() && cr.isZero()) continue;
    const account = String(l.account);
    if (usdAccounts.includes(account)) {
      if (!(Number(l.usd) > 0)) {
        throw new AdapterError(`Entry ${engineEntry.id} line ${i + 1}: USD account ${account} without a dollar amount`, 'NO_USD_AMOUNT');
      }
      if (dr.gt(0) && cr.gt(0)) {
        throw new AdapterError(`Entry ${engineEntry.id} line ${i + 1}: a USD line with both sides cannot be represented faithfully`, 'USD_TWO_SIDED');
      }
    }
    for (const [side, amount] of [['debit', dr], ['credit', cr]]) {
      if (!amount.gt(0)) continue;
      const out = { account, debit: '0', credit: '0', memo: l.memo || null };
      out[side] = m.toFixed(amount);
      if (usdAccounts.includes(account)) {
        const usd = m.money(l.usd);
        out.currency = 'USD';
        out.fxRate = m.div(amount, usd).toString(); // effective rate: base reproduces the engine's EGP exactly
        out[side] = m.toFixed(usd);
        out.memo = `${out.memo || ''} [engine EGP ${m.toFixed(amount)}]`.trim();
      }
      if (reservationId != null) out.reservationId = reservationId;
      if (unitId) out.unitId = unitId;
      lines.push(out);
    }
  }
  if (lines.length < 2) throw new AdapterError(`Entry ${engineEntry.id} has fewer than two non-zero lines`, 'TOO_FEW_LINES');
  return {
    entry: {
      transactionDate: String(engineEntry.date).slice(0, 10),
      description: String(engineEntry.description || engineEntry.type || 'Migrated entry').slice(0, 500),
      sourceModule: 'engine',
      sourceType: String(engineEntry.type || 'entry'),
      sourceId: String(engineEntry.id),
      origin: 'migrated',
      idempotencyKey: `${keyPrefix}:${engineEntry.id}`,
      policyVersion,
      actorId,
      lines,
    },
    notes,
  };
}

module.exports = { toLedgerEntry, AdapterError };
