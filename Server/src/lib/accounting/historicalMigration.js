/**
 * Historical migration (DATA_MIGRATION_PLAN.md Step 2) and reconciliation (Step 3), also used for the parallel
 * run (Step 4): the existing engine stays the reference, and its journal is copied into the stored ledger
 * without changing any amount.
 *
 *   plan()      dry run: converts every reference entry and proves the planned ledger equals the reference,
 *               account by account. Writes nothing.
 *   execute()   posts a clean plan, one transaction per month, skipping entries already posted (resumable).
 *   sync()      parallel run: posts new reference entries, and replaces (reverse + linked replacement) any
 *               entry whose reference content changed. Needs a verified person.
 *   reconcile() reference vs stored ledger: totals, accounts, and every entry, each difference in a bucket.
 *
 * Nothing here can run in production by accident: the database refuses to post while the switch is off or
 * without an approved policy, and execute()/sync() refuse a plan with errors, an unbalanced plan, or an
 * approved policy whose treatment differs from the engine's (METHOD_MISMATCH).
 */
const { query: defaultQuery, pool: defaultPool } = require('../../config/db');
const m = require('./money');
const { toLedgerEntry, AdapterError } = require('./engineAdapter');
const posting = require('./posting');

/**
 * How the existing engine books history today. The importer copies amounts exactly, so it may only run under an
 * approved policy with this treatment. A different decision (e.g. net revenue, or VAT on the fee only) needs a
 * defined and approved transformation, or dated restating adjustments; until then the importer refuses.
 */
const ENGINE_TREATMENT = Object.freeze({ revenue_presentation: 'gross', vat_base: 'fee_plus_cleaning' });
/** While VAT is suspended (financial_settings.vat_suspended_from; accountant, 2026-11-25) the engine books no VAT. */
const ENGINE_TREATMENT_VAT_SUSPENDED = Object.freeze({ revenue_presentation: 'gross', vat_base: 'suspended' });

class MigrationError extends Error {
  constructor(message, code, detail) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

const monthOf = (d) => String(d || '').slice(0, 7);
const sum = (xs) => xs.reduce((s, x) => s.plus(x), m.money(0));

/** Base (EGP) debit/credit of a planned ledger line, as the posting service will compute it. */
function lineBase(l) {
  const rate = l.currency && l.currency !== 'EGP' ? m.money(l.fxRate) : m.money(1);
  return { account: l.account, debit: m.mul(m.money(l.debit || 0), rate), credit: m.mul(m.money(l.credit || 0), rate) };
}

/** Per-account totals (2 dp) from engine lines or planned ledger lines. */
function accountTotals(lines) {
  const out = new Map();
  for (const l of lines) {
    const cur = out.get(l.account) || { debit: m.money(0), credit: m.money(0) };
    cur.debit = cur.debit.plus(l.debit);
    cur.credit = cur.credit.plus(l.credit);
    out.set(l.account, cur);
  }
  return out;
}

/** Collapse lines to account → net (debit − credit), rounded to 2 dp: the comparison unit for entries. */
function netByAccount(lines) {
  const out = {};
  for (const l of lines) out[l.account] = m.money(out[l.account] || 0).plus(m.money(l.debit)).minus(m.money(l.credit));
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, m.toFixed(v)]).filter(([, v]) => !m.money(v).isZero()));
}

/** Every value of a policy setting (flat string, or per contract type / unit object). */
function settingValues(v) {
  if (v == null) return [];
  if (typeof v === 'string') return [v];
  if (typeof v === 'object') return Object.values(v).flatMap(settingValues);
  return [String(v)];
}

/** Whether an approved policy's treatment is what the engine produced (so amounts can be copied as they are). */
function methodCompatible(settings, treatment = ENGINE_TREATMENT) {
  const mismatches = [];
  for (const [key, want] of Object.entries(treatment)) {
    const vals = settingValues(settings?.[key]);
    if (!vals.length || vals.some((v) => v !== want)) mismatches.push({ setting: key, policy: vals, engine: want });
  }
  return { compatible: mismatches.length === 0, mismatches };
}

async function loadReference({ from, to, engine, query }) {
  const data = await engine.loadPortalData(from, to);
  const journal = engine.buildJournal(data, from, to, { includeCloses: false });
  // Which ids came from saved (frozen or adjustment) copies: their idempotency keys say so (plan Step 2.1).
  const { rows: posted } = await query(
    `SELECT year_month, kind, entry_id FROM financial_posted_entries WHERE entry_date >= $1::date AND entry_date <= $2::date`,
    [from, to]
  ).catch((e) => {
    if (e.code === '42P01') return { rows: [] };
    throw e;
  });
  const savedKey = new Map(posted.map((r) => [String(r.entry_id), `${r.kind}:${r.year_month}`]));
  const unitOf = new Map((data.reservations || []).filter((r) => r.unit_id).map((r) => [r.id, r.unit_id]));
  return { journal, savedKey, unitOf };
}

/**
 * Dry run. Returns a plan: entries to post, adapter notes, errors, and the account-by-account proof that the
 * planned ledger equals the reference. Writes nothing.
 * openingBalances: optional [{ account, debit, credit }] supplied by the accountant (plan Step 2.3); never invented.
 */
async function plan({ from, to, policyVersion, openingBalances = null }, deps = {}) {
  const engine = deps.engine || require('../finance/ledgerEngine');
  const query = deps.query || defaultQuery;
  if (!from || !to || from > to) throw new MigrationError('A valid from/to range is required', 'BAD_RANGE');
  if (!policyVersion) throw new MigrationError('The approved policy version to post under is required', 'NO_POLICY');
  const { journal, savedKey, unitOf } = await loadReference({ from, to, engine, query });

  const entries = [];
  const errors = [];
  const notes = [];
  const byType = {};
  for (const e of journal) {
    const keyPrefix = savedKey.get(String(e.id)) ? `${savedKey.get(String(e.id))}` : 'engine';
    try {
      const { entry, notes: n } = toLedgerEntry(e, { policyVersion, keyPrefix, unitOf });
      entries.push(entry);
      if (n.length) notes.push({ id: e.id, notes: n });
      byType[e.type || 'entry'] = (byType[e.type || 'entry'] || 0) + 1;
    } catch (err) {
      if (!(err instanceof AdapterError)) throw err;
      errors.push({ id: e.id, date: e.date, type: e.type, code: err.code, message: err.message });
    }
  }

  if (openingBalances && openingBalances.length) {
    const lines = openingBalances.map((l) => ({ account: String(l.account), debit: m.toFixed(m.money(l.debit || 0)), credit: m.toFixed(m.money(l.credit || 0)), memo: 'Opening balance' }));
    const dr = sum(lines.map((l) => m.money(l.debit)));
    const cr = sum(lines.map((l) => m.money(l.credit)));
    if (!dr.eq(cr)) errors.push({ id: 'OPENING', code: 'OPENING_UNBALANCED', message: `Opening balances do not balance: ${m.toFixed(dr)} ≠ ${m.toFixed(cr)}` });
    else entries.unshift({ transactionDate: from, description: `Opening balances at ${from}`, sourceModule: 'migration', sourceType: 'opening_balance', sourceId: `opening:${from}`, origin: 'migrated', idempotencyKey: `opening:${from}`, policyVersion, lines });
  }

  // Proof: planned lines (in base EGP) equal the engine's lines, account by account.
  const refLines = journal.flatMap((e) => (e.lines || []).map((l) => ({ account: String(l.account), debit: m.money(l.debit || 0), credit: m.money(l.credit || 0) })));
  const planLines = entries.filter((x) => x.sourceType !== 'opening_balance').flatMap((x) => x.lines.map(lineBase));
  const ref = accountTotals(refLines);
  const planned = accountTotals(planLines);
  const accountDiffs = [];
  for (const acct of new Set([...ref.keys(), ...planned.keys()])) {
    const a = ref.get(acct) || { debit: m.money(0), credit: m.money(0) };
    const b = planned.get(acct) || { debit: m.money(0), credit: m.money(0) };
    const netA = m.round(a.debit.minus(a.credit));
    const netB = m.round(b.debit.minus(b.credit));
    if (!netA.eq(netB)) accountDiffs.push({ account: acct, reference: m.toFixed(netA), planned: m.toFixed(netB) });
  }
  const months = [...new Set(entries.map((x) => monthOf(x.transactionDate)))].sort();
  return {
    from,
    to,
    policyVersion,
    createdAt: new Date().toISOString(),
    counts: { reference: journal.length, planned: entries.length, errors: errors.length, withNotes: notes.length, months: months.length },
    byType,
    months,
    balanced: accountDiffs.length === 0,
    accountDiffs,
    errors,
    notes,
    entries,
  };
}

/**
 * The treatment the engine applies over a range: VAT suspended (the whole range on or after vat_suspended_from) or
 * standard (the whole range before it). A range that straddles the date is refused: split it at the date.
 */
async function engineTreatmentFor(db, from, to) {
  const { rows } = await db.query(`SELECT value_text FROM financial_settings WHERE key = 'vat_suspended_from'`);
  const since = String(rows[0]?.value_text || '').slice(0, 10) || null;
  if (!since || to < since) return ENGINE_TREATMENT;
  if (from >= since) return ENGINE_TREATMENT_VAT_SUSPENDED;
  throw new MigrationError(`The range ${from} → ${to} straddles the VAT suspension date ${since}; run it as two ranges split at that date`, 'RANGE_SPANS_VAT_CHANGE');
}

async function policyCheck(db, policyVersion, from, to) {
  const { rows } = await db.query(`SELECT status, settings FROM ledger_policies WHERE version = $1`, [policyVersion]);
  const p = rows[0];
  if (!p) throw new MigrationError(`Policy ${policyVersion} does not exist`, 'NO_POLICY');
  if (p.status !== 'approved') throw new MigrationError(`Policy ${policyVersion} is not approved (${p.status})`, 'POLICY_NOT_APPROVED');
  const check = methodCompatible(p.settings, from && to ? await engineTreatmentFor(db, from, to) : ENGINE_TREATMENT);
  if (!check.compatible) {
    throw new MigrationError(
      'The approved policy treats revenue or VAT differently from the engine; copying engine history would book it under the wrong treatment. Define and approve a transformation or restating adjustments first.',
      'METHOD_MISMATCH',
      check.mismatches
    );
  }
}

function assertPlanClean(p) {
  if (p.errors.length) throw new MigrationError(`The plan has ${p.errors.length} errors; fix them before posting`, 'PLAN_ERRORS', p.errors.slice(0, 20));
  if (!p.balanced) throw new MigrationError('The plan does not reproduce the reference account by account', 'PLAN_UNBALANCED', p.accountDiffs);
}

/**
 * Post a clean plan. One transaction per month; entries already posted under the same key are skipped
 * (identical content) or stop the run (different content: use sync()). Returns a run record.
 */
async function execute(p, { actorId = null, runBy = null } = {}, deps = {}) {
  const pool = deps.pool || defaultPool;
  assertPlanClean(p);
  const startedAt = new Date().toISOString();
  const months = [];
  {
    const c = await pool.connect();
    try {
      await policyCheck(c, p.policyVersion, p.from, p.to);
    } finally {
      c.release();
    }
  }
  for (const month of p.months) {
    const list = p.entries.filter((x) => monthOf(x.transactionDate) === month);
    const client = await pool.connect();
    let posted = 0;
    let skipped = 0;
    try {
      await client.query('BEGIN');
      for (const entry of list) {
        const r = await posting.postEntry({ ...entry, actorId: actorId || entry.actorId || null }, { client });
        if (r.duplicate) skipped++;
        else posted++;
      }
      await client.query('COMMIT');
      months.push({ month, posted, skipped });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      months.push({ month, failed: true, error: err.message, code: err.code });
      return { ok: false, startedAt, finishedAt: new Date().toISOString(), policyVersion: p.policyVersion, runBy, months };
    } finally {
      client.release();
    }
  }
  return { ok: true, startedAt, finishedAt: new Date().toISOString(), policyVersion: p.policyVersion, runBy, months, totals: { posted: months.reduce((s, x) => s + (x.posted || 0), 0), skipped: months.reduce((s, x) => s + (x.skipped || 0), 0) } };
}

/**
 * Parallel-run sync (plan Step 4). Posts new reference entries; when an entry's reference content changed,
 * reverses the posted one and posts a linked replacement (versioned key). A verified person (actorId) is
 * required because replacements are corrections. Reference entries that disappeared are reported, not
 * reversed automatically.
 */
async function sync(p, { actorId, reason = 'Parallel-run sync: reference changed' }, deps = {}) {
  const pool = deps.pool || defaultPool;
  if (!actorId) throw new MigrationError('A verified person is required to sync (replacements are corrections)', 'NO_ACTOR');
  assertPlanClean(p);
  const c0 = await pool.connect();
  try {
    await policyCheck(c0, p.policyVersion, p.from, p.to);
  } finally {
    c0.release();
  }
  const result = { posted: 0, unchanged: 0, replaced: 0, failed: [] };
  for (const entry of p.entries) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, idempotency_key FROM ledger_entries
         WHERE source_id = $1 AND source_module = $2 AND status = 'posted' AND origin <> 'reversal'
         ORDER BY id DESC LIMIT 1`,
        [entry.sourceId, entry.sourceModule]
      );
      const current = rows[0];
      if (!current) {
        // Never posted, or posted and later reversed outright (not replaced): a reused key would be a silent
        // no-op, so a reversed source gets the next version key.
        const { rows: prior } = await client.query(
          `SELECT idempotency_key FROM ledger_entries WHERE source_id = $1 AND source_module = $2 AND origin <> 'reversal' ORDER BY id DESC LIMIT 1`,
          [entry.sourceId, entry.sourceModule]
        );
        const key = prior[0] ? `${entry.idempotencyKey}#v${Number(String(prior[0].idempotency_key).split('#v')[1] || 1) + 1}` : entry.idempotencyKey;
        await posting.postEntry({ ...entry, idempotencyKey: key, ...(prior[0] ? { origin: 'adjustment', actorId } : {}) }, { client });
        result.posted++;
      } else {
        const lines = (await client.query(`SELECT account_code AS account, base_debit AS debit, base_credit AS credit FROM ledger_lines WHERE entry_id = $1`, [current.id])).rows;
        const same = JSON.stringify(netByAccount(lines)) === JSON.stringify(netByAccount(entry.lines.map(lineBase)));
        if (same) result.unchanged++;
        else {
          const version = Number(String(current.idempotency_key).split('#v')[1] || 1) + 1;
          await posting.replaceEntry(current.id, { ...entry, origin: 'adjustment', idempotencyKey: `${entry.idempotencyKey}#v${version}` }, { reason, actorId }, { client });
          result.replaced++;
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      result.failed.push({ key: entry.idempotencyKey, code: err.code, message: err.message });
    } finally {
      client.release();
    }
  }
  return result;
}

/**
 * Reconciliation (plan Step 3): reference vs stored ledger for a range. Buckets: matched, rounding (≤ 0.01 per
 * entry), amount_break, timing_break (same entry, different month), reference_only, ledger_only. Subledgers
 * (owner, guest, cash) follow from the entry level: entries carry their reservation and unit.
 */
async function reconcile({ from, to }, deps = {}) {
  const engine = deps.engine || require('../finance/ledgerEngine');
  const query = deps.query || defaultQuery;
  const { journal } = await loadReference({ from, to, engine, query });
  const ref = new Map(journal.map((e) => [String(e.id), e]));
  const { rows: ledgerEntries } = await query(
    `SELECT e.id, e.number, e.source_id, e.transaction_date::text AS date, e.origin
     FROM ledger_entries e
     WHERE e.status = 'posted' AND e.origin <> 'reversal' AND e.source_module = 'engine'
       AND e.transaction_date BETWEEN ($1::date - interval '1 month') AND ($2::date + interval '1 month')`,
    [from, to]
  );
  const { rows: allLines } = ledgerEntries.length
    ? await query(`SELECT entry_id, account_code AS account, base_debit AS debit, base_credit AS credit FROM ledger_lines WHERE entry_id = ANY($1::bigint[])`, [ledgerEntries.map((e) => e.id)])
    : { rows: [] };
  const linesOf = new Map();
  for (const l of allLines) {
    if (!linesOf.has(String(l.entry_id))) linesOf.set(String(l.entry_id), []);
    linesOf.get(String(l.entry_id)).push(l);
  }
  const ledgerBySource = new Map(ledgerEntries.map((e) => [String(e.source_id), e]));
  const rows = [];
  const bucket = { matched: 0, rounding: 0, amount_break: 0, timing_break: 0, reference_only: 0, ledger_only: 0 };
  for (const [id, e] of ref) {
    const l = ledgerBySource.get(id);
    const refNet = netByAccount((e.lines || []).map((x) => ({ account: String(x.account), debit: x.debit || 0, credit: x.credit || 0 })));
    if (!l) {
      bucket.reference_only++;
      rows.push({ id, bucket: 'reference_only', date: e.date, reference: refNet });
      continue;
    }
    const ledNet = netByAccount(linesOf.get(String(l.id)) || []);
    let maxDiff = m.money(0);
    for (const acct of new Set([...Object.keys(refNet), ...Object.keys(ledNet)])) {
      const d = m.money(refNet[acct] || 0).minus(m.money(ledNet[acct] || 0)).abs();
      if (d.gt(maxDiff)) maxDiff = d;
    }
    let b = maxDiff.isZero() ? 'matched' : maxDiff.lte(m.money('0.01')) ? 'rounding' : 'amount_break';
    if (b === 'matched' && monthOf(e.date) !== monthOf(l.date)) b = 'timing_break';
    bucket[b]++;
    if (b !== 'matched') rows.push({ id, bucket: b, date: e.date, ledgerDate: l.date, entry: l.number, maxDiff: m.toFixed(maxDiff), reference: refNet, ledger: ledNet });
  }
  for (const l of ledgerEntries) {
    if (l.date < from || l.date > to) continue;
    if (!ref.has(String(l.source_id))) {
      bucket.ledger_only++;
      rows.push({ id: l.source_id, bucket: 'ledger_only', ledgerDate: l.date, entry: l.number });
    }
  }
  // Account level: every account in the reference journal (including any missing from the chart) vs the stored
  // trial balance for the same range.
  const refTotals = accountTotals(journal.flatMap((e) => (e.lines || []).map((x) => ({ account: String(x.account), debit: m.money(x.debit || 0), credit: m.money(x.credit || 0) }))));
  const ledTb = await posting.trialBalance({ from, to }, { client: { query } });
  const ledBy = new Map(ledTb.map((r) => [r.account, r]));
  const accounts = [];
  for (const [code, r] of refTotals) {
    const refNet = m.round(r.debit.minus(r.credit));
    const led = ledBy.get(code);
    const ledNet = led ? m.round(m.money(led.balance)) : m.money(0);
    accounts.push({ account: code, reference: m.toFixed(refNet), ledger: m.toFixed(ledNet), difference: m.toFixed(refNet.minus(ledNet)) });
    ledBy.delete(code);
  }
  for (const [code, led] of ledBy) accounts.push({ account: code, reference: '0.00', ledger: m.toFixed(m.money(led.balance)), difference: m.toFixed(m.money(led.balance).neg()) });
  const blocking = bucket.amount_break + bucket.reference_only + bucket.ledger_only;
  return {
    from,
    to,
    ranAt: new Date().toISOString(),
    totals: { reference: ref.size, ledger: ledgerEntries.filter((l) => l.date >= from && l.date <= to).length },
    buckets: bucket,
    accountsWithDifferences: accounts.filter((a) => !m.money(a.difference).isZero()),
    accounts,
    rows,
    clean: blocking === 0 && accounts.every((a) => m.money(a.difference).abs().lte(m.money('0.01'))),
  };
}

/** CSV of a reconciliation's rows (plan Step 3 output). */
function reconciliationCsv(r) {
  const head = 'source_id,bucket,reference_date,ledger_date,ledger_entry,max_difference';
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [head, ...r.rows.map((x) => [x.id, x.bucket, x.date, x.ledgerDate, x.entry, x.maxDiff].map(esc).join(','))].join('\n') + '\n';
}

module.exports = { plan, execute, sync, reconcile, reconciliationCsv, methodCompatible, engineTreatmentFor, ENGINE_TREATMENT, ENGINE_TREATMENT_VAT_SUSPENDED, MigrationError };
