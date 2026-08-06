/**
 * Apply Book1.xlsx August/September nightly rates onto unit_daily_prices.
 * Usage: node scripts/apply_book1_prices.js [--dry-run]
 */
require('dotenv').config();
const XLSX = require('xlsx');
const { query } = require('../src/config/db');

const FILE = 'C:/Users/hazem/Downloads/Book1.xlsx';
const YEAR = 2026;
const DRY = process.argv.includes('--dry-run');

const ALIASES = {
  'WEST-2803': 'WST-HZL-2803',
  'WST-2803': 'WST-HZL-2803',
};

function normCode(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');
}

function parseMoneyToken(tok) {
  const t = String(tok || '')
    .trim()
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/\s/g, '');
  const m = t.match(/^(\d+(?:\.\d+)?)k$/i);
  if (m) return Math.round(Number(m[1]) * 1000);
  const n = Number(t.replace(/[^\d.]/g, ''));
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  return null;
}

function parseMonthCell(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^blocked$/i.test(s)) return 'BLOCKED';

  const lower = s.toLowerCase().replace(/\r/g, '\n');
  const hasWeekend = /weekend/.test(lower);
  const hasWeekday = /week\s*day|weekday|week day/.test(lower);

  if (hasWeekend || hasWeekday) {
    let weekend = null;
    let weekday = null;
    for (const line of lower.split(/\n+/)) {
      const nums = [...line.matchAll(/(\d[\d,]*(?:\.\d+)?k?)/gi)].map((m) => parseMoneyToken(m[1]));
      const valid = nums.filter((n) => n > 0);
      if (!valid.length) continue;
      if (/weekend/.test(line)) weekend = valid[0];
      else if (/week\s*day|weekday/.test(line)) weekday = valid[0];
      else if (!(weekday > 0)) weekday = valid[0];
    }
    if (!(weekday > 0) || !(weekend > 0)) {
      const all = [...lower.matchAll(/(\d[\d,]*(?:\.\d+)?k?)/gi)].map((m) => parseMoneyToken(m[1]));
      const vals = all.filter((n) => n > 0);
      if (vals.length >= 2) {
        const sorted = [...vals].sort((a, b) => a - b);
        weekday = weekday || sorted[0];
        weekend = weekend || sorted[sorted.length - 1];
      } else if (vals.length === 1) {
        weekday = weekday || vals[0];
        weekend = weekend || vals[0];
      }
    }
    if (!(weekday > 0) && weekend > 0) weekday = weekend;
    if (!(weekend > 0) && weekday > 0) weekend = weekday;
    if (weekday > 0 && weekend > 0) return { weekday, weekend };
    return null;
  }

  const single = parseMoneyToken(s);
  if (single > 0) return { weekday: single, weekend: single };
  return null;
}

function daysInMonth(year, month1to12) {
  return new Date(year, month1to12, 0).getDate();
}

function eachDate(year, month1to12) {
  const n = daysInMonth(year, month1to12);
  const out = [];
  for (let d = 1; d <= n; d++) {
    out.push(`${year}-${String(month1to12).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return out;
}

function isWeekend(iso) {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return day === 5 || day === 6;
}

function monthRange(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const toMonth = month === 12 ? 1 : month + 1;
  const toYear = month === 12 ? year + 1 : year;
  const to = `${toYear}-${String(toMonth).padStart(2, '0')}-01`;
  return { from, to };
}

(async () => {
  const wb = XLSX.readFile(FILE);
  const sheetRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null, raw: false });

  const sheet = sheetRows
    .map((r) => ({
      code: String(r.__EMPTY || '').trim(),
      aug: parseMonthCell(r.AUGUST ?? r.August),
      sep: parseMonthCell(r.September ?? r.SEPTEMBER),
    }))
    .filter((r) => r.code);

  const { rows: units } = await query(
    `SELECT id, unit_number, wp_post_id, status, price_fallback
     FROM units
     WHERE unit_number IS NOT NULL AND btrim(unit_number) <> ''`
  );
  const byNorm = new Map();
  for (const u of units) byNorm.set(normCode(u.unit_number), u);

  const priceRows = []; // { wp, date, price }
  const blockRows = []; // { wp, date }
  const clearPriceRanges = []; // { wp, from, to }
  const clearBlockRanges = []; // { wp, from, to }
  const fallbackUpdates = []; // { id, price }
  const summary = {
    dry: DRY,
    unitsTouched: 0,
    missing: [],
    skippedNoWp: [],
  };

  for (const row of sheet) {
    let key = normCode(row.code);
    if (ALIASES[key]) key = normCode(ALIASES[key]);
    let unit = byNorm.get(key);
    if (!unit) {
      const loose = key.replace(/-/g, '');
      for (const [k, u] of byNorm) {
        if (k.replace(/-/g, '') === loose) {
          unit = u;
          break;
        }
      }
    }
    if (!unit) {
      summary.missing.push(row.code);
      continue;
    }
    if (!unit.wp_post_id) {
      summary.skippedNoWp.push(unit.unit_number);
      continue;
    }

    summary.unitsTouched += 1;
    const months = [
      { month: 8, spec: row.aug },
      { month: 9, spec: row.sep },
    ];

    for (const { month, spec } of months) {
      if (spec == null) continue;
      const { from, to } = monthRange(YEAR, month);
      if (spec === 'BLOCKED') {
        clearPriceRanges.push({ wp: unit.wp_post_id, from, to });
        for (const date of eachDate(YEAR, month)) {
          blockRows.push({ wp: unit.wp_post_id, date });
        }
        continue;
      }
      clearBlockRanges.push({ wp: unit.wp_post_id, from, to });
      for (const date of eachDate(YEAR, month)) {
        const price = isWeekend(date) ? spec.weekend : spec.weekday;
        if (price > 0) priceRows.push({ wp: unit.wp_post_id, date, price });
      }
    }

    const fallbackSrc =
      row.aug && row.aug !== 'BLOCKED'
        ? row.aug.weekday
        : row.sep && row.sep !== 'BLOCKED'
          ? row.sep.weekday
          : null;
    if (fallbackSrc > 0) fallbackUpdates.push({ id: unit.id, price: fallbackSrc });
  }

  summary.priceRows = priceRows.length;
  summary.blockRows = blockRows.length;
  summary.fallbackUpdates = fallbackUpdates.length;

  if (DRY) {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  // Clear prices for blocked months
  for (const r of clearPriceRanges) {
    await query(
      `DELETE FROM unit_daily_prices WHERE wp_post_id = $1 AND date >= $2::date AND date < $3::date`,
      [r.wp, r.from, r.to]
    );
  }

  // Unblock manual blocks for priced months
  for (const r of clearBlockRanges) {
    await query(
      `DELETE FROM unit_blocked_dates
       WHERE wp_post_id = $1 AND source = 'manual' AND date >= $2::date AND date < $3::date`,
      [r.wp, r.from, r.to]
    );
  }

  // Batch upsert prices (chunks of 500)
  const chunk = 500;
  for (let i = 0; i < priceRows.length; i += chunk) {
    const slice = priceRows.slice(i, i + chunk);
    const wps = slice.map((r) => r.wp);
    const dates = slice.map((r) => r.date);
    const prices = slice.map((r) => r.price);
    await query(
      `INSERT INTO unit_daily_prices (wp_post_id, date, price, currency, source, updated_at)
       SELECT wp, d::date, p, 'EGP', 'manual', now()
       FROM unnest($1::bigint[], $2::text[], $3::numeric[]) AS t(wp, d, p)
       ON CONFLICT (wp_post_id, date) DO UPDATE SET
         price = EXCLUDED.price,
         currency = 'EGP',
         source = 'manual',
         updated_at = now()`,
      [wps, dates, prices]
    );
    console.log(`prices ${Math.min(i + chunk, priceRows.length)}/${priceRows.length}`);
  }

  // Batch upsert blocks
  for (let i = 0; i < blockRows.length; i += chunk) {
    const slice = blockRows.slice(i, i + chunk);
    const wps = slice.map((r) => r.wp);
    const dates = slice.map((r) => r.date);
    await query(
      `INSERT INTO unit_blocked_dates (wp_post_id, date, source, updated_at)
       SELECT wp, d::date, 'manual', now()
       FROM unnest($1::bigint[], $2::text[]) AS t(wp, d)
       ON CONFLICT (wp_post_id, date) DO UPDATE SET source = 'manual', updated_at = now()`,
      [wps, dates]
    );
  }

  // Fallback prices
  for (let i = 0; i < fallbackUpdates.length; i += chunk) {
    const slice = fallbackUpdates.slice(i, i + chunk);
    const ids = slice.map((r) => r.id);
    const prices = slice.map((r) => r.price);
    await query(
      `UPDATE units u SET price_fallback = v.price, updated_at = now()
       FROM unnest($1::uuid[], $2::numeric[]) AS v(id, price)
       WHERE u.id = v.id`,
      [ids, prices]
    );
  }

  // Spot-check a few units
  const { rows: checks } = await query(
    `SELECT u.unit_number, u.price_fallback,
            (SELECT price FROM unit_daily_prices udp
             WHERE udp.wp_post_id = u.wp_post_id AND udp.date = '2026-08-06'::date) AS aug6,
            (SELECT price FROM unit_daily_prices udp
             WHERE udp.wp_post_id = u.wp_post_id AND udp.date = '2026-09-01'::date) AS sep1
     FROM units u
     WHERE u.unit_number IN ('CL8-V11','CL8-V9','WST-HZL-2803','ST3-V20')
     ORDER BY u.unit_number`
  );
  summary.spotCheck = checks;

  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
