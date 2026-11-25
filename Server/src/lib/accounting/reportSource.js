/**
 * Phase 6: Financial System reports from the stored ledger. The source is the guarded setting
 * financial_settings.ledger_reports ('engine' by default, or 'ledger'; migration 177). The statements are built
 * by the SAME builder as today (ledgerEngine.buildStatements) from a journal read out of ledger_lines, with
 * month-end closing entries generated exactly as the engine does, so the two sources can be compared line for line.
 */
const { query: defaultQuery, pool: defaultPool } = require('../../config/db');
const engine = require('../finance/ledgerEngine');
const { attestActor } = require('./identity');

/** 'engine' or 'ledger'. Before migration 177 (or on any read problem with a missing table) it is 'engine'. */
async function reportSource({ query = defaultQuery } = {}) {
  try {
    const { rows } = await query(`SELECT value_text FROM financial_settings WHERE key = 'ledger_reports'`);
    return rows[0]?.value_text === 'ledger' ? 'ledger' : 'engine';
  } catch (e) {
    if (e.code === '42P01') return 'engine';
    throw e;
  }
}

/**
 * Stored entries in the engine's journal shape. Every posted entry counts, including reversed ones and their
 * reversals (they net to zero), exactly as the trial balance sums ledger_lines.
 */
async function storedJournal(from, to, { query = defaultQuery } = {}) {
  const { rows: entries } = await query(
    `SELECT id, number, transaction_date::text AS date, source_type, source_id, description, origin, status
     FROM ledger_entries WHERE transaction_date BETWEEN $1::date AND $2::date ORDER BY transaction_date, id`,
    [from, to]
  );
  if (!entries.length) return [];
  const { rows: lines } = await query(
    `SELECT entry_id, account_code, base_debit::text AS debit, base_credit::text AS credit, reservation_id
     FROM ledger_lines WHERE entry_id = ANY($1::bigint[]) ORDER BY entry_id, id`,
    [entries.map((e) => e.id)]
  );
  const byEntry = new Map();
  for (const l of lines) {
    if (!byEntry.has(l.entry_id)) byEntry.set(l.entry_id, []);
    byEntry.get(l.entry_id).push(l);
  }
  return entries.map((e) => {
    const ls = byEntry.get(e.id) || [];
    const reservationId = ls.find((l) => l.reservation_id != null)?.reservation_id ?? null;
    return {
      id: e.number,
      date: e.date,
      type: e.source_type,
      description: e.description,
      lines: ls.map((l) => ({ account: l.account_code, debit: Number(l.debit), credit: Number(l.credit) })),
      meta: { reservation_id: reservationId, ledger_entry_id: Number(e.id), source_id: e.source_id, origin: e.origin, status: e.status },
    };
  });
}

/** Statements for a range from the stored ledger, in the same shape as engine.buildYtdStatements(). */
async function ledgerYtdStatements(to, fromDate, { query = defaultQuery } = {}) {
  const from = fromDate || engine.FINANCIAL_EPOCH;
  const asOf = to || new Date().toISOString().slice(0, 10);
  const data = await engine.loadPortalData(from, asOf);
  const journal = await storedJournal(from, asOf, { query });
  // Month-end closing entries, exactly as the engine generates them for closed months.
  const closed = new Set((data.closes || []).map((c) => c.year_month));
  for (const month of engine.monthsInRange(from, asOf)) {
    if (!closed.has(month)) continue;
    const monthJournal = journal.filter((e) => e.date >= `${month}-01` && e.date <= engine.lastDayOfMonth(month) && e.type !== 'period_close');
    const close = engine.closeMonthEntry(month, monthJournal);
    if (close.lines.length) journal.push(close);
  }
  const statements = engine.buildStatements(journal, data.reservations, from, asOf, data.reservationTotals);
  return {
    from_date: from,
    to_date: asOf,
    ...statements,
    cash_flow: await engine.buildCashFlowStatement(from, asOf),
    vat_return: engine.vatReturn(journal),
    journal,
  };
}

/**
 * Switch the report source. A verified active admin and a reason (10+ characters) are required; the database
 * checks both, refuses 'ledger' while posting is off, and logs the change permanently.
 */
async function setReportSource(value, { actorId, reason }, { client = null } = {}) {
  const pool = defaultPool;
  const db = client || (await pool.connect());
  try {
    if (!client) await db.query('BEGIN');
    await attestActor(db, actorId);
    await db.query(`SELECT set_config('app.control_reason', $1, true)`, [String(reason || '')]);
    await db.query(`UPDATE financial_settings SET value_text = $1 WHERE key = 'ledger_reports'`, [value]);
    if (!client) await db.query('COMMIT');
    return value;
  } catch (e) {
    if (!client) await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    if (!client) db.release();
  }
}

module.exports = { reportSource, storedJournal, ledgerYtdStatements, setReportSource };
