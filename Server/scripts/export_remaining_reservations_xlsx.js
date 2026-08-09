/**
 * Export sheet rows that were NOT imported (unmatched units / still missing).
 * Writes to Downloads by default.
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { query } = require('../src/config/db');

// Reuse matching helpers from sync script by requiring a minimal inline copy
const FILE = process.env.RESERVATIONS_XLSX || 'C:/Users/hazem/Downloads/Reservations 2026 (4).xlsx';
const OUT =
  process.env.REMAINING_XLSX ||
  path.join('C:/Users/hazem/Downloads', 'Reservations 2026 - remaining unadded.xlsx');

const SHEETS = ['Sahel Reservations', 'Sokhna Reservations'];

const ALIASES = {
  'WEST-2803': 'WST-HZL-2803',
  'WST-2803': 'WST-HZL-2803',
  'WST-HAZ-3223': 'WST-HAZEL-3223',
  Z2202: 'Z22-02',
  'Z-2202': 'Z22-02',
  'GAIA-Z-106': 'Z-106',
  'R-16-3': 'R16-3',
  'B3-V4TW-6B': 'B3-V4-TW-6B',
  'CL11-CH21B-G': 'CL11-CH21-BG',
  'CL11-CH8-AG': 'CL11-CH8A-G',
  'CL11-CH17-AG': 'CL11-17A-G',
  'CL11-CH16-03': 'CL11-16-03',
  'ST5-CH79-01-01': 'ST5-79-01-01',
  'ST5-CH89-01-01': 'ST5-89-01-01',
  'ST5-CH89-02-02': 'ST5-89-02-02',
  'ST5-CH85-G01': 'ST5-85-G01',
  'ST5-CH94-G02': 'ST5-94-G02',
  'CL4-20-G01': 'CL4-CH20-G01',
  'CL4-19-02': 'CL4-CH19-02',
  'CL10-CH22A-03': 'CL10-22-03',
};

function normCode(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');
}

function codeVariants(raw) {
  const base = normCode(ALIASES[normCode(raw)] || raw);
  const set = new Set([base]);
  if (!base) return set;
  if (base.startsWith('GAIA-')) set.add(base.slice(5));
  set.add(base.replace(/-(\d)-(\d)$/, '$1-$2'));
  set.add(base.replace(/^([A-Z]+)-(\d+)-(\d+)$/, '$1$2-$3'));
  set.add(base.replace(/-CH(\d)/g, '-$1'));
  set.add(base.replace(/-CH-/g, '-'));
  const m2 = base.match(/^(.+)-([A-Z]*\d+)([A-Z]+)-([A-Z])$/);
  if (m2) set.add(`${m2[1]}-${m2[2]}-${m2[3]}${m2[4]}`);
  set.add(base.replace(/V(\d)TW-/i, 'V$1-TW-'));
  set.add(base.replace(/-/g, ''));
  return set;
}

function excelSerialToIso(n) {
  if (n == null || n === '') return null;
  if (typeof n === 'string' && /^\d{4}-\d{2}-\d{2}/.test(n)) return n.slice(0, 10);
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  const ms = Math.round((num - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function str(v) {
  if (v == null) return '';
  return String(v).trim();
}

function rowKey(unitId, checkIn, checkOut, guestName) {
  return `${unitId}|${checkIn}|${checkOut}|${str(guestName).toLowerCase()}`;
}

async function loadUnitMap() {
  const { rows } = await query(
    `SELECT id, unit_number, internal_code, wp_post_id, title
     FROM units
     WHERE COALESCE(status, '') NOT IN ('archived', 'cancelled')`
  );
  const byCode = new Map();
  const byDense = new Map();
  const add = (code, row) => {
    const k = normCode(code);
    if (!k) return;
    if (!byCode.has(k)) byCode.set(k, row);
    const dense = k.replace(/-/g, '');
    if (dense && !byDense.has(dense)) byDense.set(dense, row);
  };
  for (const u of rows) {
    add(u.unit_number, u);
    add(u.internal_code, u);
    add(u.title, u);
  }
  return { byCode, byDense };
}

function resolveUnit(unitRaw, byCode, byDense) {
  for (const v of codeVariants(unitRaw)) {
    if (byCode.has(v)) return byCode.get(v);
    const dense = v.replace(/-/g, '');
    if (byDense.has(dense)) return byDense.get(dense);
  }
  return null;
}

async function loadExistingKeys() {
  const { rows } = await query(
    `SELECT unit_id, check_in::text AS check_in, check_out::text AS check_out, guest_name
     FROM reservations
     WHERE status IS DISTINCT FROM 'cancelled'`
  );
  const keys = new Set();
  const loose = new Set();
  for (const r of rows) {
    keys.add(rowKey(r.unit_id, r.check_in, r.check_out, r.guest_name));
    loose.add(`${r.unit_id}|${r.check_in}|${r.check_out}`);
  }
  return { keys, loose };
}

(async () => {
  const wbIn = XLSX.readFile(FILE);
  const { byCode, byDense } = await loadUnitMap();
  const existing = await loadExistingKeys();

  const remainingBySheet = {};

  for (const sheetName of SHEETS) {
    const sheet = wbIn.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    const remaining = [];

    for (const r of rows) {
      const unitRaw = r['Unit No.'] ?? r['Unit No'] ?? r['Unit'];
      const checkIn = excelSerialToIso(r['Check In'] ?? r['Check in'] ?? r['CheckIn']);
      const checkOut = excelSerialToIso(r['Check out'] ?? r['Check Out'] ?? r['Checkout']);
      const guestName = str(r['Client Name'] || r['Guest Name'] || '');
      if (!unitRaw || !checkIn || !checkOut || !guestName) continue;
      if (checkOut <= checkIn) continue;

      const unit = resolveUnit(unitRaw, byCode, byDense);
      let reason = '';
      if (!unit) {
        reason = 'Unit not found on website';
      } else {
        const key = rowKey(unit.id, checkIn, checkOut, guestName);
        const loose = `${unit.id}|${checkIn}|${checkOut}`;
        if (existing.keys.has(key) || existing.loose.has(loose)) {
          continue; // already added
        }
        reason = 'Matched unit but still missing in DB';
      }

      remaining.push({
        Reason: reason,
        Sheet: sheetName,
        'Check In': checkIn,
        'Check out': checkOut,
        'Unit No.': str(unitRaw),
        'Client Name': guestName,
        'Mobile No.': r['Mobile No.'] ?? r['Mobile No'] ?? '',
        'Number Of Guests': r['Number Of Guests'] ?? '',
        'Payment Method': r['Payment Method'] ?? '',
        Nights: r['Nights '] ?? r['Nights'] ?? '',
        'Price per Night': r['Price per Night'] ?? '',
        'Total Reservation':
          r['Total Reservation'] ?? r['Total Reservation EGP'] ?? '',
        'Down Payment': r['Down Payment'] ?? '',
        'Amount to pay': r['Amount to pay'] ?? '',
        Insurance: r['Insurance '] ?? r['Insurance'] ?? '',
        Housekeeping: r['Housekeeping'] ?? '',
        'Beach Pass': r['Beach Pass'] ?? '',
        Source: r['Source'] ?? '',
        'Sales Name': r['Sales Name'] ?? '',
        Notes: r['Notes'] ?? '',
      });
    }

    remainingBySheet[sheetName] = remaining;
    console.log(`[export] ${sheetName}: ${remaining.length} remaining`);
  }

  const wbOut = XLSX.utils.book_new();
  let total = 0;
  for (const [name, rows] of Object.entries(remainingBySheet)) {
    total += rows.length;
    const ws = XLSX.utils.json_to_sheet(
      rows.length
        ? rows
        : [{ Reason: 'None remaining', Sheet: name }]
    );
    XLSX.utils.book_append_sheet(wbOut, ws, name.slice(0, 31));
  }

  // Summary sheet
  const summary = Object.entries(remainingBySheet).flatMap(([sheet, rows]) => {
    const byReason = {};
    for (const r of rows) {
      byReason[r.Reason] = (byReason[r.Reason] || 0) + 1;
    }
    return Object.entries(byReason).map(([reason, count]) => ({
      Sheet: sheet,
      Reason: reason,
      Count: count,
    }));
  });
  XLSX.utils.book_append_sheet(
    wbOut,
    XLSX.utils.json_to_sheet(summary.length ? summary : [{ Sheet: '-', Reason: 'none', Count: 0 }]),
    'Summary'
  );

  XLSX.writeFile(wbOut, OUT);
  console.log(`[export] wrote ${total} rows → ${OUT}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
