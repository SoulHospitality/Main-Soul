/**
 * Closed months are immutable. Closing a month saves its journal exactly as it stood; the books then
 * read that saved copy. When something dated in a closed month changes later (an edited stay, a late
 * payment, a deleted journal), the difference is posted as a correction dated in the open month,
 * the way a prior-period adjustment is booked (IAS 8), so no closed figure ever moves.
 */
const { query } = require('../../config/db');
const { round2 } = require('../commission');
const { runWithPeriodBasis, STAY } = require('./periodBasis');

let lastSync = 0;
let syncing = null;

function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function monthBounds(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${yearMonth}-01`, to: `${yearMonth}-${String(last).padStart(2, '0')}` };
}

/** Live journal of one month as the operational records say today (closing entries excluded). */
async function liveMonthJournal(yearMonth) {
  const { loadPortalData, buildJournal } = require('./ledgerEngine');
  const { from, to } = monthBounds(yearMonth);
  return runWithPeriodBasis(STAY, async () => {
    const data = await loadPortalData(from, to);
    return buildJournal(data, from, to, { includeCloses: false, useFrozen: false })
      .filter((e) => e.type !== 'period_close' && String(e.date).slice(0, 7) === yearMonth);
  });
}

function totalsByAccount(entries) {
  const map = {};
  for (const e of entries) {
    for (const l of e.lines || []) {
      map[l.account] = round2((map[l.account] || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0));
    }
  }
  return map;
}

/** Save the month's journal as closed. Replaces an earlier copy (re-close after a reopen). */
async function freezeMonth(yearMonth, journal) {
  const entries = journal || (await liveMonthJournal(yearMonth));
  await query(`DELETE FROM financial_posted_entries WHERE year_month = $1 AND kind = 'frozen'`, [yearMonth]);
  for (const e of entries) {
    await query(
      `INSERT INTO financial_posted_entries (year_month, kind, entry_id, entry_date, entry) VALUES ($1, 'frozen', $2, $3, $4)`,
      [yearMonth, e.id, String(e.date).slice(0, 10), JSON.stringify(e)]
    );
  }
  lastSync = 0;
  return entries.length;
}

/** Reopening a month drops its frozen copy and the corrections not yet locked inside another closed month. */
async function unfreezeMonth(yearMonth) {
  await query(`DELETE FROM financial_posted_entries WHERE year_month = $1 AND kind = 'frozen'`, [yearMonth]);
  await query(
    `DELETE FROM financial_posted_entries a
     WHERE a.year_month = $1 AND a.kind = 'adjustment'
       AND NOT EXISTS (
         SELECT 1 FROM financial_posted_entries f
         WHERE f.kind = 'frozen' AND f.year_month = to_char(a.entry_date, 'YYYY-MM')
       )`,
    [yearMonth]
  );
  lastSync = 0;
}

/**
 * Compare every closed month with what its records say now and post the difference to today.
 * Months closed before freezing existed are frozen as they stand. Throttled; safe to call often.
 */
async function syncPriorPeriodAdjustments({ force = false } = {}) {
  if (!force && Date.now() - lastSync < 60000) return { skipped: true };
  if (syncing) return syncing;
  syncing = (async () => {
    const posted = [];
    try {
      const { rows: closes } = await query(
        `SELECT year_month FROM financial_period_closes ORDER BY year_month DESC LIMIT 18`
      );
      if (!closes.length) return { posted };
      const closed = new Set(closes.map((c) => c.year_month));
      const today = cairoToday();
      const todayClosed = closed.has(today.slice(0, 7));
      const { rows: frozenRows } = await query(
        `SELECT year_month, kind, entry FROM financial_posted_entries WHERE year_month = ANY($1)`,
        [[...closed]]
      );
      for (const { year_month: month } of closes) {
        const frozen = frozenRows.filter((r) => r.year_month === month && r.kind === 'frozen').map((r) => r.entry);
        const live = await liveMonthJournal(month);
        if (!frozen.length) {
          await freezeMonth(month, live);
          continue;
        }
        if (todayClosed) continue;
        const corrections = frozenRows.filter((r) => r.year_month === month && r.kind === 'adjustment').map((r) => r.entry);
        const before = totalsByAccount([...frozen, ...corrections]);
        const now = totalsByAccount(live);
        const lines = [];
        const { accountLabel } = require('./ledgerEngine');
        for (const acct of new Set([...Object.keys(before), ...Object.keys(now)])) {
          const delta = round2((now[acct] || 0) - (before[acct] || 0));
          if (Math.abs(delta) < 0.01) continue;
          lines.push({
            account: acct,
            account_name: accountLabel(acct),
            debit: delta > 0 ? delta : 0,
            credit: delta < 0 ? -delta : 0,
            memo: `Late change to closed ${month}`,
          });
        }
        if (!lines.length) continue;
        const debit = round2(lines.reduce((s, l) => s + l.debit, 0));
        const credit = round2(lines.reduce((s, l) => s + l.credit, 0));
        // Lines from a balanced journal always balance; guard against rounding drift on retained earnings.
        if (Math.abs(debit - credit) >= 0.01) {
          const gap = round2(debit - credit);
          lines.push({ account: '302000', account_name: accountLabel('302000'), debit: gap < 0 ? -gap : 0, credit: gap > 0 ? gap : 0, memo: 'Rounding' });
        }
        const { rows: seq } = await query(
          `SELECT COUNT(*)::int AS n FROM financial_posted_entries WHERE year_month = $1 AND kind = 'adjustment'`,
          [month]
        );
        const id = `PPA-${month}-${(seq[0]?.n || 0) + 1}`;
        const entry = {
          id,
          date: today,
          type: 'prior_period_adjustment',
          description: `Correction to closed ${month} (records changed after closing)`,
          lines,
          debit: round2(lines.reduce((s, l) => s + l.debit, 0)),
          credit: round2(lines.reduce((s, l) => s + l.credit, 0)),
          balanced: true,
          meta: { corrects_month: month, automatic: true },
        };
        await query(
          `INSERT INTO financial_posted_entries (year_month, kind, entry_id, entry_date, entry) VALUES ($1, 'adjustment', $2, $3, $4)`,
          [month, id, today, JSON.stringify(entry)]
        );
        posted.push(entry);
      }
    } catch (e) {
      if (e.code !== '42P01') console.warn('[finance] prior-period sync failed', e.message);
    } finally {
      lastSync = Date.now();
    }
    return { posted };
  })();
  try {
    return await syncing;
  } finally {
    syncing = null;
  }
}

module.exports = { freezeMonth, unfreezeMonth, syncPriorPeriodAdjustments, liveMonthJournal };
