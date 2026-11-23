/**
 * The posting service: the only code that writes to ledger_entries / ledger_lines.
 *
 * - Refuses to post while financial_settings.ledger_posting is not 'on' (it stays 'off' until decision
 *   D-01 is approved in writing and the parallel run is signed off).
 * - Validates: at least two lines, accounts exist and are active, currency allowed on the account,
 *   one side per line, base-currency debits = credits (exact, Decimal), period not closed.
 * - Idempotent: the same idempotency key returns the entry already posted, never a second one.
 * - Corrections: reverseEntry() posts the mirror entry and marks the original reversed; posted rows
 *   are never edited or deleted (also enforced by database triggers, migration 176).
 * Runs inside the caller's transaction when given a client, so it succeeds or fails with the
 * operational change.
 */
const { pool } = require('../../config/db');
const m = require('./money');

class PostingError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const isoDate = (d) => {
  const s = d instanceof Date ? d.toISOString() : String(d || '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) throw new PostingError(`Invalid date ${d}`, 'BAD_DATE');
  return s.slice(0, 10);
};

async function postingEnabled(db) {
  const { rows } = await db.query(`SELECT value_text FROM financial_settings WHERE key = 'ledger_posting'`);
  return rows[0]?.value_text === 'on';
}

async function withClient(client, fn) {
  if (client) return fn(client);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/** Lines in base currency (EGP) with Decimal; foreign lines need their own rate. */
function prepareLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) throw new PostingError('An entry needs at least two lines', 'TOO_FEW_LINES');
  return lines.map((l, i) => {
    const currency = String(l.currency || 'EGP').toUpperCase();
    const debit = m.round(l.debit || 0, currency);
    const credit = m.round(l.credit || 0, currency);
    if (debit.isNegative() || credit.isNegative()) throw new PostingError(`Line ${i + 1}: amounts cannot be negative`, 'NEGATIVE');
    if (debit.isZero() === credit.isZero()) throw new PostingError(`Line ${i + 1}: exactly one of debit or credit`, 'ONE_SIDE');
    let fxRate = m.money(1);
    if (currency !== 'EGP') {
      if (l.fxRate == null) throw new PostingError(`Line ${i + 1}: a ${currency} line needs its exchange rate`, 'NO_FX_RATE');
      fxRate = m.money(l.fxRate);
      if (!fxRate.gt(0)) throw new PostingError(`Line ${i + 1}: invalid exchange rate`, 'BAD_FX_RATE');
    }
    return {
      line_no: i + 1,
      account_code: String(l.account || '').trim(),
      debit,
      credit,
      currency,
      fx_rate: fxRate,
      base_debit: currency === 'EGP' ? debit : m.convert(debit, fxRate),
      base_credit: currency === 'EGP' ? credit : m.convert(credit, fxRate),
      memo: l.memo || null,
      unit_id: l.unitId || null,
      project: l.project || null,
      reservation_id: l.reservationId ?? null,
      owner_id: l.ownerId ?? null,
      employee_id: l.employeeId ?? null,
      vendor_id: l.vendorId ?? null,
      tax_code: l.taxCode || null,
    };
  });
}

async function nextNumber(db, date) {
  const { rows } = await db.query(`SELECT nextval('ledger_entry_number_seq') AS n`);
  return `JE-${date.slice(0, 4)}-${String(rows[0].n).padStart(6, '0')}`;
}

/**
 * Post one entry. Returns { entry, duplicate } — duplicate=true when the idempotency key was already posted.
 * entry: { transactionDate, description, sourceModule, sourceType, sourceId, sourceVersion?, origin?,
 *          idempotencyKey, policyVersion?, actorId?, approvedBy?, reversesId?, allowClosedPeriod?, lines: [...] }
 */
async function postEntry(entry, { client = null } = {}) {
  return withClient(client, async (db) => {
    if (!(await postingEnabled(db))) {
      throw new PostingError('Ledger posting is switched off (waiting for decision D-01 and sign-off)', 'POSTING_OFF', 409);
    }
    const key = String(entry.idempotencyKey || '').trim();
    if (!key) throw new PostingError('An idempotency key is required', 'NO_KEY');
    const existing = await db.query(`SELECT * FROM ledger_entries WHERE idempotency_key = $1`, [key]);
    if (existing.rows[0]) return { entry: existing.rows[0], duplicate: true };

    const date = isoDate(entry.transactionDate);
    const period = date.slice(0, 7);
    const lines = prepareLines(entry.lines);
    const debit = lines.reduce((s, l) => s.plus(l.base_debit), m.money(0));
    const credit = lines.reduce((s, l) => s.plus(l.base_credit), m.money(0));
    if (!debit.eq(credit)) {
      throw new PostingError(`Unbalanced entry: debits ${m.toFixed(debit)} ≠ credits ${m.toFixed(credit)}`, 'UNBALANCED');
    }

    const codes = [...new Set(lines.map((l) => l.account_code))];
    const { rows: accounts } = await db.query(`SELECT code, active, currency FROM ledger_accounts WHERE code = ANY($1)`, [codes]);
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    for (const l of lines) {
      const a = byCode.get(l.account_code);
      if (!a) throw new PostingError(`Unknown account ${l.account_code}`, 'UNKNOWN_ACCOUNT');
      if (!a.active) throw new PostingError(`Account ${l.account_code} is inactive`, 'INACTIVE_ACCOUNT');
      if (a.currency && String(a.currency).trim() !== l.currency) {
        throw new PostingError(`Account ${l.account_code} only takes ${String(a.currency).trim()}`, 'CURRENCY_NOT_ALLOWED');
      }
    }

    const { rows: periodRows } = await db.query(`SELECT status FROM ledger_periods WHERE period = $1`, [period]);
    if (periodRows[0]?.status === 'closed' && !(entry.allowClosedPeriod && entry.origin === 'adjustment')) {
      throw new PostingError(`Period ${period} is closed`, 'PERIOD_CLOSED', 409);
    }

    const number = await nextNumber(db, date);
    const { rows: inserted } = await db.query(
      `INSERT INTO ledger_entries (number, transaction_date, period, description, source_module, source_type, source_id,
         source_version, origin, reverses_id, idempotency_key, policy_version, created_by, approved_by)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        number, date, period, String(entry.description || '').slice(0, 500) || 'Entry',
        entry.sourceModule || 'finance', entry.sourceType || 'manual', String(entry.sourceId ?? key),
        entry.sourceVersion || 1, entry.origin || 'system', entry.reversesId || null, key,
        entry.policyVersion || null, entry.actorId || null, entry.approvedBy || null,
      ]
    );
    const row = inserted[0];
    for (const l of lines) {
      await db.query(
        `INSERT INTO ledger_lines (entry_id, line_no, account_code, debit, credit, currency, fx_rate, base_debit, base_credit,
           memo, unit_id, project, reservation_id, owner_id, employee_id, vendor_id, tax_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          row.id, l.line_no, l.account_code, m.toDb(l.debit), m.toDb(l.credit), l.currency, l.fx_rate.toString(),
          m.toDb(l.base_debit), m.toDb(l.base_credit), l.memo, l.unit_id, l.project, l.reservation_id,
          l.owner_id, l.employee_id, l.vendor_id, l.tax_code,
        ]
      );
    }
    return { entry: row, duplicate: false };
  });
}

/** Reverse a posted entry: the mirror entry (debits ↔ credits), dated `date` (default: today in Cairo). */
async function reverseEntry(entryId, { reason, actorId, date = null } = {}, { client = null } = {}) {
  if (!reason || String(reason).trim().length < 5) throw new PostingError('A reason is required to reverse an entry', 'NO_REASON');
  return withClient(client, async (db) => {
    const { rows } = await db.query(`SELECT * FROM ledger_entries WHERE id = $1 FOR UPDATE`, [entryId]);
    const original = rows[0];
    if (!original) throw new PostingError('Entry not found', 'NOT_FOUND', 404);
    if (original.status === 'reversed') throw new PostingError(`Entry ${original.number} is already reversed`, 'ALREADY_REVERSED', 409);
    const { rows: lines } = await db.query(`SELECT * FROM ledger_lines WHERE entry_id = $1 ORDER BY line_no`, [entryId]);
    const when = date || new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    const { entry } = await postEntry({
      transactionDate: when,
      description: `Reversal of ${original.number}: ${String(reason).trim()}`,
      sourceModule: original.source_module,
      sourceType: original.source_type,
      sourceId: original.source_id,
      sourceVersion: original.source_version,
      origin: 'reversal',
      reversesId: original.id,
      idempotencyKey: `reversal:${original.id}`,
      policyVersion: original.policy_version,
      actorId,
      lines: lines.map((l) => ({
        account: l.account_code,
        debit: l.credit,
        credit: l.debit,
        currency: l.currency,
        fxRate: l.currency === 'EGP' ? undefined : l.fx_rate,
        memo: l.memo,
        unitId: l.unit_id,
        project: l.project,
        reservationId: l.reservation_id,
        ownerId: l.owner_id,
        employeeId: l.employee_id,
        vendorId: l.vendor_id,
        taxCode: l.tax_code,
      })),
    }, { client: db });
    await db.query(`UPDATE ledger_entries SET status = 'reversed', reversed_by_id = $2 WHERE id = $1`, [original.id, entry.id]);
    return entry;
  });
}

/** Trial balance from the stored ledger (base currency). */
async function trialBalance({ from = null, to = null } = {}, { client = null } = {}) {
  const db = client || pool;
  const { rows } = await db.query(
    `SELECT l.account_code, SUM(l.base_debit) AS debit, SUM(l.base_credit) AS credit
     FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
     WHERE ($1::date IS NULL OR e.transaction_date >= $1::date) AND ($2::date IS NULL OR e.transaction_date <= $2::date)
     GROUP BY l.account_code ORDER BY l.account_code`,
    [from, to]
  );
  return rows.map((r) => ({ account: r.account_code, debit: m.toFixed(r.debit), credit: m.toFixed(r.credit), balance: m.toFixed(m.sub(r.debit, r.credit)) }));
}

module.exports = { postEntry, reverseEntry, trialBalance, PostingError, prepareLines };
