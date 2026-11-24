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
const { attestActor } = require('./identity');

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

// Private: only reverseEntry may pass explicit base (EGP) amounts, so a reversal copies the original's EGP
// exactly instead of recomputing it from the stored (8-decimal) rate. Not exported, so no caller can use it.
const MIRROR_BASE = Symbol('mirrorBase');

/** Lines in base currency (EGP) with Decimal; foreign lines need their own rate. */
function prepareLines(lines, { mirrorBase = false } = {}) {
  if (!Array.isArray(lines) || lines.length < 2) throw new PostingError('An entry needs at least two lines', 'TOO_FEW_LINES');
  return lines.map((l, i) => {
    const prepared = prepareLine(l, i);
    if (mirrorBase && prepared.currency !== 'EGP' && l.baseDebit != null && l.baseCredit != null) {
      prepared.base_debit = m.round(l.baseDebit, 'EGP');
      prepared.base_credit = m.round(l.baseCredit, 'EGP');
    }
    return prepared;
  });
}

function prepareLine(l, i) {
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
}

async function nextNumber(db, date) {
  const { rows } = await db.query(`SELECT nextval('ledger_entry_number_seq') AS n`);
  return `JE-${date.slice(0, 4)}-${String(rows[0].n).padStart(6, '0')}`;
}

/**
 * Fingerprint of everything material an entry posts (header and every line field), so a genuine retry
 * with the same key is recognised and anything else under that key is refused.
 */
function payloadHash(header, lines) {
  const canonical = lines.map((l) => [
    l.account_code, l.currency, m.toDb(l.debit), m.toDb(l.credit), l.fx_rate.toString(), m.toDb(l.base_debit), m.toDb(l.base_credit),
    l.memo, l.unit_id, l.project, l.reservation_id, l.owner_id, l.employee_id, l.vendor_id, l.tax_code,
  ]);
  const h = [header.date, header.description, header.sourceModule, header.sourceType, header.sourceId, header.sourceVersion,
    header.origin, header.reversesId, header.replacesId, header.policyVersion, header.approvedBy];
  return require('crypto').createHash('sha256').update(JSON.stringify([h, canonical])).digest('hex');
}

/**
 * The policy an entry must carry: for a reversal, the reversed entry's policy (approved or retired, so
 * corrections survive a policy change); otherwise the policy in force on the date (latest approved policy
 * effective on or before it). The database enforces the same rule.
 */
async function resolvePolicy(db, entry, date, origin) {
  if (origin === 'reversal') {
    const { rows } = await db.query(
      `SELECT e.policy_version, p.status FROM ledger_entries e LEFT JOIN ledger_policies p ON p.version = e.policy_version WHERE e.id = $1`,
      [entry.reversesId]
    );
    const r = rows[0];
    if (!r || !['approved', 'retired'].includes(r.status)) {
      throw new PostingError('The entry being reversed has no approved or retired policy', 'NO_POLICY', 409);
    }
    if (entry.policyVersion && entry.policyVersion !== r.policy_version) {
      throw new PostingError(`A reversal keeps the original entry's policy (${r.policy_version})`, 'POLICY_NOT_IN_FORCE', 409);
    }
    return r.policy_version;
  }
  const { rows } = await db.query(`SELECT public.ledger_policy_in_force($1::date) AS version`, [date]);
  const inForce = rows[0]?.version || null;
  if (!inForce) throw new PostingError('No approved accounting policy (D-01 and VAT base) is in force for this date', 'NO_POLICY', 409);
  if (entry.policyVersion && entry.policyVersion !== inForce) {
    throw new PostingError(`Policy ${entry.policyVersion} is not the policy in force on ${date} (${inForce})`, 'POLICY_NOT_IN_FORCE', 409);
  }
  return inForce;
}

const ACTOR_REQUIRED = new Set(['manual', 'adjustment', 'reversal']);

/**
 * Post one entry. Returns { entry, duplicate } — duplicate=true when the idempotency key was already posted.
 * entry: { transactionDate, description, sourceModule, sourceType, sourceId, sourceVersion?, origin?,
 *          idempotencyKey, policyVersion (an approved ledger_policies version), actorId?, approvedBy?, reversesId?, allowClosedPeriod?, lines: [...] }
 */
async function postEntry(entry, options = {}) {
  const { client = null } = options;
  return withClient(client, async (db) => {
    if (!(await postingEnabled(db))) {
      throw new PostingError('Ledger posting is switched off (waiting for decision D-01 and sign-off)', 'POSTING_OFF', 409);
    }
    const key = String(entry.idempotencyKey || '').trim();
    if (!key) throw new PostingError('An idempotency key is required', 'NO_KEY');
    const origin = entry.origin || 'system';
    if (ACTOR_REQUIRED.has(origin) && !entry.actorId) {
      throw new PostingError(`A ${origin} entry must name the person posting it`, 'NO_ACTOR');
    }
    const date = isoDate(entry.transactionDate);
    const period = date.slice(0, 7);
    const lines = prepareLines(entry.lines, { mirrorBase: options[MIRROR_BASE] === true && origin === 'reversal' });
    // Every entry carries the policy the rules require (D-01 presentation + VAT base); the database checks it too.
    const policyVersion = await resolvePolicy(db, entry, date, origin);
    const header = {
      date,
      description: String(entry.description || '').slice(0, 500) || 'Entry',
      sourceModule: entry.sourceModule || 'finance',
      sourceType: entry.sourceType || 'manual',
      sourceId: String(entry.sourceId ?? key),
      sourceVersion: entry.sourceVersion || 1,
      origin,
      reversesId: entry.reversesId ? Number(entry.reversesId) : null,
      replacesId: entry.replacesId ? Number(entry.replacesId) : null,
      policyVersion,
      approvedBy: entry.approvedBy ? Number(entry.approvedBy) : null,
    };
    const hash = payloadHash(header, lines);
    const sameKey = async (row) => {
      if (row.payload_hash && row.payload_hash !== hash) {
        throw new PostingError(`Idempotency key ${key} was already used for different content (entry ${row.number})`, 'IDEMPOTENCY_CONFLICT', 409);
      }
      return { entry: row, duplicate: true };
    };
    const existing = await db.query(`SELECT * FROM ledger_entries WHERE idempotency_key = $1`, [key]);
    if (existing.rows[0]) return sameKey(existing.rows[0]);
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
    if (periodRows[0]?.status === 'closed') {
      const approved = entry.allowClosedPeriod && origin === 'adjustment' && entry.approvedBy && Number(entry.approvedBy) !== Number(entry.actorId);
      if (!approved) {
        throw new PostingError(`Period ${period} is closed: only an adjustment approved by a different admin can be posted`, 'PERIOD_CLOSED', 409);
      }
    }

    // Verified identity: the named actor signs a claim for this transaction (the database checks it).
    if (entry.actorId != null) await attestActor(db, entry.actorId);
    const number = await nextNumber(db, date);
    // ON CONFLICT: a concurrent retry with the same key that committed first wins; this one returns it.
    const { rows: inserted } = await db.query(
      `INSERT INTO ledger_entries (number, transaction_date, period, description, source_module, source_type, source_id,
         source_version, origin, reverses_id, replaces_id, idempotency_key, policy_version, payload_hash, created_by, approved_by)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [
        number, date, period, header.description, header.sourceModule, header.sourceType, header.sourceId,
        header.sourceVersion, origin, header.reversesId, header.replacesId, key,
        policyVersion, hash, entry.actorId || null, header.approvedBy,
      ]
    );
    if (!inserted[0]) {
      // Another transaction posted this key first. Under READ COMMITTED its row is visible now; under a
      // caller's REPEATABLE READ / SERIALIZABLE snapshot it may not be: report a retryable race, never crash.
      const raced = await db.query(`SELECT * FROM ledger_entries WHERE idempotency_key = $1`, [key]);
      if (!raced.rows[0]) {
        throw new PostingError(`Idempotency key ${key} was posted by a concurrent transaction; retry to read it`, 'IDEMPOTENCY_RACE', 409);
      }
      return sameKey(raced.rows[0]);
    }
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
    if (original.origin === 'reversal') {
      throw new PostingError(`Entry ${original.number} is a reversal; post a new entry instead of reversing it`, 'REVERSAL_OF_REVERSAL', 409);
    }
    const { rows: lines } = await db.query(`SELECT * FROM ledger_lines WHERE entry_id = $1 ORDER BY line_no`, [entryId]);
    const when = date || new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    if (when < String(isoDate(original.transaction_date))) {
      throw new PostingError(`A reversal cannot be dated before ${original.number} (${isoDate(original.transaction_date)})`, 'BAD_DATE');
    }
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
        // Copy the original EGP amounts swapped, so the mirror is exact for foreign-currency lines too.
        baseDebit: l.base_credit,
        baseCredit: l.base_debit,
      })),
    }, { client: db, [MIRROR_BASE]: true });
    await db.query(`UPDATE ledger_entries SET status = 'reversed', reversed_by_id = $2 WHERE id = $1`, [original.id, entry.id]);
    return entry;
  });
}

/**
 * Correct a posted entry: reverse it and post the replacement, in one transaction, so the books never
 * show only half of a correction. The replacement records which entry it replaces.
 */
async function replaceEntry(entryId, replacement, { reason, actorId, date = null } = {}, { client = null } = {}) {
  return withClient(client, async (db) => {
    const reversal = await reverseEntry(entryId, { reason, actorId, date }, { client: db });
    const { entry } = await postEntry({
      ...replacement,
      origin: replacement.origin || 'manual',
      actorId: replacement.actorId || actorId,
      replacesId: entryId,
      idempotencyKey: replacement.idempotencyKey || `replacement:${entryId}`,
    }, { client: db });
    return { reversal, replacement: entry };
  });
}

/** Close a period (an active admin; enforced by the database too). */
async function closePeriod(period, { actorId }, { client = null } = {}) {
  if (!/^\d{4}-\d{2}$/.test(String(period))) throw new PostingError('Period must be YYYY-MM', 'BAD_PERIOD');
  return withClient(client, async (db) => {
    await attestActor(db, actorId);
    const { rows } = await db.query(
      `INSERT INTO ledger_periods (period, status, closed_by) VALUES ($1, 'closed', $2)
       ON CONFLICT (period) DO UPDATE SET status = 'closed', closed_by = $2
       RETURNING *`,
      [period, actorId || null]
    );
    return rows[0];
  });
}

/** Reopen a closed period: an active admin and a reason (enforced by the database too). */
async function reopenPeriod(period, { actorId, reason }, { client = null } = {}) {
  if (!reason || String(reason).trim().length < 10) throw new PostingError('Give a reason of at least 10 characters to reopen a period', 'NO_REASON');
  return withClient(client, async (db) => {
    await attestActor(db, actorId);
    const { rows } = await db.query(
      `UPDATE ledger_periods SET status = 'open', reopened_by = $2, reopen_reason = $3 WHERE period = $1 AND status = 'closed' RETURNING *`,
      [period, actorId || null, String(reason).trim()]
    );
    if (!rows[0]) throw new PostingError(`Period ${period} is not closed`, 'NOT_CLOSED', 409);
    return rows[0];
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

/**
 * Switch posting on or off. Turning it on needs an approved policy and a VERIFIED active admin (signed
 * identity claim) with a reason; every change is written to the append-only ledger_control_log.
 */
async function setPostingSwitch(value, { actorId, reason }, { client = null } = {}) {
  if (!['on', 'off'].includes(value)) throw new PostingError('The posting switch is on or off', 'BAD_SWITCH');
  return withClient(client, async (db) => {
    await attestActor(db, actorId);
    await db.query(`SELECT set_config('app.control_reason', $1, true)`, [String(reason || '')]);
    const { rows } = await db.query(`UPDATE financial_settings SET value_text = $1 WHERE key = 'ledger_posting' RETURNING value_text`, [value]);
    return rows[0]?.value_text;
  });
}

module.exports = { postEntry, reverseEntry, replaceEntry, closePeriod, reopenPeriod, setPostingSwitch, trialBalance, PostingError, prepareLines, payloadHash };
