/**
 * Import blocked nights from "Soul Availability" workbook.
 * Colored (non-white) cells + merged spans = blocked dates.
 *
 * Usage: node scripts/apply_availability_blocks.js [--dry-run]
 */
require('dotenv').config();
const XLSX = require('xlsx');
const { query } = require('../src/config/db');

const FILE = 'C:/Users/hazem/Downloads/Soul Availability  (7).xlsx';
const DRY = process.argv.includes('--dry-run');

const AVAILABILITY_SHEETS = [
  'Foukabay availability',
  'Gaia availability',
  'Sokhna availability',
  'Hacienda west & D-bay availabil',
];

const ALIASES = {
  'WEST-2803': 'WST-HZL-2803',
  'WST-2803': 'WST-HZL-2803',
  'WST-HAZEL-3223': 'WST-HAZEL-3223',
  'WST-HAZ-3223': 'WST-HAZEL-3223',
  Z2202: 'Z22-02',
  'Z-2202': 'Z22-02',
  'Z-106': 'Z-106',
};

function normCode(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');
}

function excelSerialToIso(n) {
  const ms = Math.round((Number(n) - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function normalizeRgb(rgb) {
  if (!rgb) return null;
  let c = String(rgb).toUpperCase();
  if (c.length === 8) c = c.slice(2);
  return c;
}

function isWhiteRgb(c) {
  return !c || c === 'FFFFFF' || c === 'FFFFFE' || c === 'FEFEFE' || c === 'F2F2F2';
}

/** Resolve style from master of merge if needed. */
function buildMergeMasterMap(sheet) {
  const map = new Map(); // "r,c" -> {r,c} master
  for (const m of sheet['!merges'] || []) {
    const mr = m.s.r;
    const mc = m.s.c;
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        map.set(`${r},${c}`, { r: mr, c: mc });
      }
    }
  }
  return map;
}

function getCell(sheet, r, c) {
  return sheet[XLSX.utils.encode_cell({ r, c })];
}

function isBlockedCell(cell) {
  if (!cell) return false;
  const hasText = cell.v != null && String(cell.v).trim() !== '';
  const style = cell.s;
  if (!style) return hasText;

  const fg = style.fgColor || {};
  const bg = style.bgColor || {};
  const rgb = normalizeRgb(fg.rgb || bg.rgb);

  if (rgb) {
    if (isWhiteRgb(rgb)) return hasText; // white + text still occupied
    // any non-white solid/other fill
    return true;
  }

  if (style.patternType === 'none' || style.patternType == null) {
    return hasText;
  }

  // theme / indexed without resolvable rgb
  const theme = fg.theme ?? bg.theme;
  if (theme === 1) return hasText; // light
  if (theme != null && theme !== 1) return true;
  const indexed = fg.indexed ?? bg.indexed;
  if (indexed === 64 || indexed === 65) return hasText;
  if (indexed != null) return true;

  return hasText;
}

function parseSheetBlocks(sheet) {
  const ref = XLSX.utils.decode_range(sheet['!ref']);
  const mergeMaster = buildMergeMasterMap(sheet);

  // Unit headers on row 0 (Excel row 1)
  const units = [];
  for (let c = 1; c <= ref.e.c; c++) {
    const cell = getCell(sheet, 0, c);
    const code = cell?.v != null ? String(cell.v).trim() : '';
    if (code && !/^unit/i.test(code)) units.push({ c, code });
  }

  // Date rows from column A
  const datesByRow = new Map();
  let minDate = null;
  let maxDate = null;
  for (let r = 0; r <= ref.e.r; r++) {
    const a = getCell(sheet, r, 0);
    if (!a || a.t !== 'n' || !(Number(a.v) > 30000)) continue;
    const iso = excelSerialToIso(a.v);
    if (!iso || iso < '2024-01-01' || iso > '2030-12-31') continue;
    datesByRow.set(r, iso);
    if (!minDate || iso < minDate) minDate = iso;
    if (!maxDate || iso > maxDate) maxDate = iso;
  }

  /** unitCode -> Set(iso dates) */
  const blocked = new Map();
  for (const u of units) blocked.set(u.code, new Set());

  for (const [r, iso] of datesByRow) {
    for (const u of units) {
      const master = mergeMaster.get(`${r},${u.c}`) || { r, c: u.c };
      const cell = getCell(sheet, master.r, master.c);
      if (isBlockedCell(cell)) blocked.get(u.code).add(iso);
    }
  }

  return { units: units.map((u) => u.code), minDate, maxDate, blocked };
}

function resolveUnit(code, byNorm) {
  const tried = [];
  const push = (k) => {
    const key = normCode(k);
    if (!key || tried.includes(key)) return;
    tried.push(key);
  };
  push(code);
  if (ALIASES[normCode(code)]) push(ALIASES[normCode(code)]);

  // CL10-14A-G ↔ CL10-CH14A-G ; CL10-CH11B-02 ↔ CL10-11B-02
  for (const base of [...tried]) {
    const m = base.match(/^([A-Z]+\d+|ST\d+|CL\d+|B\d+|C\d+)-(.+)$/);
    if (!m) continue;
    const [, prefix, rest] = m;
    if (rest.startsWith('CH')) push(`${prefix}-${rest.slice(2)}`);
    else push(`${prefix}-CH${rest}`);
  }

  // zero-pad trailing segment: CL1-TW42-3 → CL1-TW42-03
  for (const base of [...tried]) {
    push(base.replace(/-(\d)$/, '-0$1'));
  }

  for (const key of tried) {
    if (byNorm.has(key)) return byNorm.get(key);
  }

  const looseTried = tried.map((k) => k.replace(/-/g, ''));
  for (const [k, u] of byNorm) {
    const loose = k.replace(/-/g, '');
    if (looseTried.includes(loose)) return u;
  }
  return null;
}

(async () => {
  const wb = XLSX.readFile(FILE, { cellStyles: true });

  const { rows: dbUnits } = await query(
    `SELECT id, unit_number, wp_post_id, status
     FROM units
     WHERE unit_number IS NOT NULL AND btrim(unit_number) <> ''`
  );
  const byNorm = new Map();
  for (const u of dbUnits) byNorm.set(normCode(u.unit_number), u);

  const allBlocks = []; // { wp, date, unit }
  const clearRanges = new Map(); // wp -> { from, to }
  const missing = new Map(); // code -> count
  const matchedUnits = new Set();
  const sheetStats = [];

  for (const name of AVAILABILITY_SHEETS) {
    const sheet = wb.Sheets[name];
    if (!sheet) {
      sheetStats.push({ name, error: 'missing' });
      continue;
    }
    const parsed = parseSheetBlocks(sheet);
    let sheetBlockCount = 0;
    let sheetMatched = 0;

    for (const code of parsed.units) {
      const unit = resolveUnit(code, byNorm);
      if (!unit?.wp_post_id) {
        missing.set(code, (missing.get(code) || 0) + 1);
        continue;
      }
      sheetMatched += 1;
      matchedUnits.add(unit.unit_number);

      const dates = parsed.blocked.get(code) || new Set();
      sheetBlockCount += dates.size;

      const prev = clearRanges.get(unit.wp_post_id);
      if (!prev) {
        clearRanges.set(unit.wp_post_id, { from: parsed.minDate, to: parsed.maxDate });
      } else {
        if (parsed.minDate < prev.from) prev.from = parsed.minDate;
        if (parsed.maxDate > prev.to) prev.to = parsed.maxDate;
      }

      for (const date of dates) {
        allBlocks.push({ wp: unit.wp_post_id, date, unit: unit.unit_number });
      }
    }

    sheetStats.push({
      name,
      units: parsed.units.length,
      matched: sheetMatched,
      dateRange: [parsed.minDate, parsed.maxDate],
      blockedCells: sheetBlockCount,
    });
  }

  // Dedupe blocks
  const uniq = new Map();
  for (const b of allBlocks) uniq.set(`${b.wp}|${b.date}`, b);
  const blocks = [...uniq.values()];

  const summary = {
    dry: DRY,
    sheets: sheetStats,
    matchedUnits: matchedUnits.size,
    blockNights: blocks.length,
    missingCodes: [...missing.keys()].sort(),
  };

  if (DRY) {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  // Clear prior manual blocks in each unit's sheet coverage window (exclusive end+1 day)
  for (const [wp, range] of clearRanges) {
    if (!range.from || !range.to) continue;
    const toExclusive = new Date(`${range.to}T12:00:00Z`);
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
    const to = toExclusive.toISOString().slice(0, 10);
    await query(
      `DELETE FROM unit_blocked_dates
       WHERE wp_post_id = $1
         AND source = 'manual'
         AND date >= $2::date
         AND date < $3::date`,
      [wp, range.from, to]
    );
  }

  const chunk = 500;
  for (let i = 0; i < blocks.length; i += chunk) {
    const slice = blocks.slice(i, i + chunk);
    await query(
      `INSERT INTO unit_blocked_dates (wp_post_id, date, source, updated_at)
       SELECT wp, d::date, 'manual', now()
       FROM unnest($1::bigint[], $2::text[]) AS t(wp, d)
       ON CONFLICT (wp_post_id, date) DO UPDATE SET source = 'manual', updated_at = now()`,
      [slice.map((b) => b.wp), slice.map((b) => b.date)]
    );
    console.log(`blocks ${Math.min(i + chunk, blocks.length)}/${blocks.length}`);
  }

  // Spot checks
  const { rows: spot } = await query(
    `SELECT u.unit_number, count(*)::int AS blocked_days,
            min(b.date)::text AS first_day, max(b.date)::text AS last_day
     FROM unit_blocked_dates b
     JOIN units u ON u.wp_post_id = b.wp_post_id
     WHERE b.source = 'manual'
       AND u.unit_number IN ('ST3-V20','CL8-V11','WST-HZL-2803','A27-6')
       AND b.date >= '2026-05-01' AND b.date <= '2026-10-31'
     GROUP BY u.unit_number
     ORDER BY u.unit_number`
  );
  summary.spotCheck = spot;

  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
