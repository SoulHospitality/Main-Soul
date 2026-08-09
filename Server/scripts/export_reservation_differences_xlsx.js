/**
 * Compare Reservations Excel vs website DB and export field-level differences.
 *
 * Default source: full Reservations 2026 (4).xlsx (needed for price/date diffs).
 * Usage: node scripts/export_reservation_differences_xlsx.js
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { query } = require('../src/config/db');

const FILE =
  process.env.RESERVATIONS_XLSX || 'C:/Users/hazem/Downloads/Reservations 2026 (4).xlsx';
const OUT =
  process.env.DIFF_XLSX ||
  path.join('C:/Users/hazem/Downloads', 'Reservations 2026 - differences vs website.xlsx');

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

function normName(v) {
  return str(v).toLowerCase().replace(/\s+/g, ' ');
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function nightsBetween(checkIn, checkOut) {
  const a = new Date(`${checkIn}T00:00:00Z`);
  const b = new Date(`${checkOut}T00:00:00Z`);
  return Math.max(1, Math.round((b - a) / 86400000));
}

function moneyClose(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) < 1;
}

function textClose(a, b) {
  return normName(a) === normName(b);
}

async function loadUnitMap() {
  const { rows } = await query(
    `SELECT id, unit_number, internal_code, title
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

function parseSheetRows(wb) {
  const out = [];
  for (const sheetName of SHEETS) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    for (const r of rows) {
      const unitRaw = r['Unit No.'] ?? r['Unit No'] ?? r['Unit'];
      const checkIn = excelSerialToIso(r['Check In'] ?? r['Check in'] ?? r['CheckIn']);
      const checkOut = excelSerialToIso(r['Check out'] ?? r['Check Out'] ?? r['Checkout']);
      const guestName = str(r['Client Name'] || r['Guest Name'] || '');
      if (!unitRaw || !checkIn || !checkOut || !guestName) continue;
      if (checkOut <= checkIn) continue;

      const total =
        num(r['Total Reservation']) ?? num(r['Total Reservation EGP']) ?? null;
      const nights = num(r['Nights ']) ?? num(r['Nights']) ?? nightsBetween(checkIn, checkOut);
      const pricePerNight =
        num(r['Price per Night']) ??
        (nights && total != null ? total / nights : null);

      out.push({
        sheet: sheetName,
        unitRaw: str(unitRaw),
        checkIn,
        checkOut,
        nights,
        guestName,
        guestPhone: str(r['Mobile No.'] ?? r['Mobile No'] ?? '') || null,
        total,
        amountPaid: num(r['Down Payment']),
        amountToPay: num(r['Amount to pay']),
        pricePerNight,
        insurance: num(r['Insurance ']) ?? num(r['Insurance']),
        housekeeping: num(r['Housekeeping']),
        beachPass: num(r['Beach Pass']),
        paymentMethod: str(r['Payment Method'] || '') || null,
        source: str(r['Source'] || '') || null,
        salesName: str(r['Sales Name'] || '') || null,
        notes: str(r['Notes'] || '') || null,
      });
    }
  }
  return out;
}

function findBestMatch(excel, dbRowsForUnit) {
  if (!dbRowsForUnit?.length) return null;

  const exact = dbRowsForUnit.find(
    (d) => d.check_in === excel.checkIn && d.check_out === excel.checkOut
  );
  if (exact) return { db: exact, matchType: 'exact_dates' };

  const exactGuestDates = dbRowsForUnit.find(
    (d) =>
      d.check_in === excel.checkIn &&
      d.check_out === excel.checkOut &&
      textClose(d.guest_name, excel.guestName)
  );
  if (exactGuestDates) return { db: exactGuestDates, matchType: 'exact_dates_guest' };

  const sameGuest = dbRowsForUnit.filter((d) => textClose(d.guest_name, excel.guestName));
  const overlapping = sameGuest.find((d) => d.check_in < excel.checkOut && d.check_out > excel.checkIn);
  if (overlapping) return { db: overlapping, matchType: 'guest_overlap' };

  const sameCheckIn = sameGuest.find((d) => d.check_in === excel.checkIn);
  if (sameCheckIn) return { db: sameCheckIn, matchType: 'guest_same_checkin' };

  const sameCheckOut = sameGuest.find((d) => d.check_out === excel.checkOut);
  if (sameCheckOut) return { db: sameCheckOut, matchType: 'guest_same_checkout' };

  // Same unit + exact dates even if guest name differs
  if (exact) return { db: exact, matchType: 'exact_dates' };

  const datesOnly = dbRowsForUnit.find(
    (d) => d.check_in === excel.checkIn && d.check_out === excel.checkOut
  );
  if (datesOnly) return { db: datesOnly, matchType: 'exact_dates_other_guest' };

  return null;
}

function buildDiffRow(excel, unit, match) {
  const db = match.db;
  const changed = [];

  const pairs = [
    ['check_in', excel.checkIn, db.check_in, 'text'],
    ['check_out', excel.checkOut, db.check_out, 'text'],
    ['nights', excel.nights, db.nights, 'num'],
    ['guest_name', excel.guestName, db.guest_name, 'text'],
    ['guest_phone', excel.guestPhone, db.guest_phone, 'text'],
    ['total_amount', excel.total, db.total_amount, 'money'],
    ['amount_paid', excel.amountPaid, db.amount_paid, 'money'],
    ['price_per_night', excel.pricePerNight, db.price_per_night, 'money'],
    ['insurance', excel.insurance, db.insurance, 'money'],
    ['housekeeping_fees', excel.housekeeping, db.housekeeping_fees, 'money'],
    ['booking_source', excel.source, db.booking_source, 'text'],
    ['sales_label', excel.salesName, db.sales_label, 'text'],
    ['payment_method', excel.paymentMethod, db.payment_method, 'text'],
  ];

  const row = {
    Status: 'Fields differ',
    Match_type: match.matchType,
    Sheet: excel.sheet,
    Unit: unit.unit_number || excel.unitRaw,
    Website_reservation_id: db.id,
    Changed_fields: '',
  };

  for (const [field, excelVal, dbVal, kind] of pairs) {
    let same = true;
    if (kind === 'money') same = moneyClose(excelVal, dbVal);
    else if (kind === 'num') {
      same =
        excelVal == null && dbVal == null
          ? true
          : Number(excelVal) === Number(dbVal);
    } else {
      // soft compare phones / payment / source
      if (field === 'guest_phone') {
        const a = str(excelVal).replace(/\D/g, '');
        const b = str(dbVal).replace(/\D/g, '');
        same = !a || !b ? textClose(excelVal, dbVal) : a === b || a.endsWith(b) || b.endsWith(a);
      } else if (field === 'payment_method' || field === 'booking_source') {
        same =
          !str(excelVal) ||
          !str(dbVal) ||
          normName(excelVal).includes(normName(dbVal)) ||
          normName(dbVal).includes(normName(excelVal)) ||
          textClose(excelVal, dbVal);
      } else {
        same = textClose(excelVal, dbVal);
      }
    }

    row[`Excel_${field}`] = excelVal ?? '';
    row[`Website_${field}`] = dbVal ?? '';
    row[`Diff_${field}`] = same ? '' : 'YES';
    if (!same) changed.push(field);
  }

  row.Changed_fields = changed.join(', ');
  row.Excel_notes = excel.notes || '';
  row.Website_notes = db.notes || '';
  return changed.length ? row : null;
}

(async () => {
  console.log(`[diff] source=${FILE}`);
  const wb = XLSX.readFile(FILE);
  const excelRows = parseSheetRows(wb);
  console.log(`[diff] excel rows=${excelRows.length}`);

  const { byCode, byDense } = await loadUnitMap();
  const { rows: dbAll } = await query(
    `SELECT r.id, r.unit_id, u.unit_number,
            r.guest_name, r.guest_phone,
            r.check_in::text AS check_in, r.check_out::text AS check_out,
            r.nights, r.total_amount, r.amount_paid, r.price_per_night,
            r.insurance, r.housekeeping_fees, r.booking_source, r.sales_label,
            r.payment_method, r.notes, r.status
     FROM reservations r
     JOIN units u ON u.id = r.unit_id
     WHERE r.status IS DISTINCT FROM 'cancelled'`
  );

  const byUnit = new Map();
  for (const d of dbAll) {
    if (!byUnit.has(d.unit_id)) byUnit.set(d.unit_id, []);
    byUnit.get(d.unit_id).push(d);
  }

  const differences = [];
  const missingOnWebsite = [];
  const unitNotFound = [];
  const matchedSame = [];

  for (const excel of excelRows) {
    const unit = resolveUnit(excel.unitRaw, byCode, byDense);
    if (!unit) {
      unitNotFound.push({
        Status: 'Unit not on website',
        Sheet: excel.sheet,
        Unit: excel.unitRaw,
        Check_in: excel.checkIn,
        Check_out: excel.checkOut,
        Nights: excel.nights,
        Guest: excel.guestName,
        Phone: excel.guestPhone || '',
        Total: excel.total ?? '',
        Amount_paid: excel.amountPaid ?? '',
        Price_per_night: excel.pricePerNight ?? '',
        Sales: excel.salesName || '',
        Source: excel.source || '',
        Notes: excel.notes || '',
      });
      continue;
    }

    const match = findBestMatch(excel, byUnit.get(unit.id) || []);
    if (!match) {
      missingOnWebsite.push({
        Status: 'Reservation missing on website',
        Sheet: excel.sheet,
        Unit: unit.unit_number || excel.unitRaw,
        Check_in: excel.checkIn,
        Check_out: excel.checkOut,
        Nights: excel.nights,
        Guest: excel.guestName,
        Phone: excel.guestPhone || '',
        Total: excel.total ?? '',
        Amount_paid: excel.amountPaid ?? '',
        Price_per_night: excel.pricePerNight ?? '',
        Sales: excel.salesName || '',
        Source: excel.source || '',
        Notes: excel.notes || '',
      });
      continue;
    }

    const diffRow = buildDiffRow(excel, unit, match);
    if (diffRow) differences.push(diffRow);
    else matchedSame.push(1);
  }

  const summary = [
    { Metric: 'Excel rows compared', Count: excelRows.length },
    { Metric: 'Exact match / no field differences', Count: matchedSame.length },
    { Metric: 'Matched with field differences', Count: differences.length },
    { Metric: 'Reservation missing on website', Count: missingOnWebsite.length },
    { Metric: 'Unit not found on website', Count: unitNotFound.length },
  ];

  // Compact differences sheet: one row per changed field for readability
  const CORE_FIELDS = new Set([
    'check_in',
    'check_out',
    'nights',
    'total_amount',
    'price_per_night',
    'amount_paid',
    'guest_name',
  ]);

  const diffLong = [];
  const coreLong = [];
  for (const d of differences) {
    const fields = String(d.Changed_fields || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const f of fields) {
      const row = {
        Sheet: d.Sheet,
        Unit: d.Unit,
        Website_reservation_id: d.Website_reservation_id,
        Match_type: d.Match_type,
        Field: f,
        Excel_value: d[`Excel_${f}`],
        Website_value: d[`Website_${f}`],
        Guest_excel: d.Excel_guest_name,
        Guest_website: d.Website_guest_name,
        Excel_check_in: d.Excel_check_in,
        Excel_check_out: d.Excel_check_out,
        Website_check_in: d.Website_check_in,
        Website_check_out: d.Website_check_out,
      };
      diffLong.push(row);
      if (CORE_FIELDS.has(f)) coreLong.push(row);
    }
  }

  const coreWide = differences
    .map((d) => {
      const fields = String(d.Changed_fields || '')
        .split(',')
        .map((s) => s.trim())
        .filter((f) => CORE_FIELDS.has(f));
      if (!fields.length) return null;
      return {
        Sheet: d.Sheet,
        Unit: d.Unit,
        Website_reservation_id: d.Website_reservation_id,
        Match_type: d.Match_type,
        Changed_core_fields: fields.join(', '),
        Excel_check_in: d.Excel_check_in,
        Website_check_in: d.Website_check_in,
        Diff_check_in: d.Diff_check_in,
        Excel_check_out: d.Excel_check_out,
        Website_check_out: d.Website_check_out,
        Diff_check_out: d.Diff_check_out,
        Excel_nights: d.Excel_nights,
        Website_nights: d.Website_nights,
        Diff_nights: d.Diff_nights,
        Excel_total_amount: d.Excel_total_amount,
        Website_total_amount: d.Website_total_amount,
        Diff_total_amount: d.Diff_total_amount,
        Excel_price_per_night: d.Excel_price_per_night,
        Website_price_per_night: d.Website_price_per_night,
        Diff_price_per_night: d.Diff_price_per_night,
        Excel_amount_paid: d.Excel_amount_paid,
        Website_amount_paid: d.Website_amount_paid,
        Diff_amount_paid: d.Diff_amount_paid,
        Excel_guest_name: d.Excel_guest_name,
        Website_guest_name: d.Website_guest_name,
        Diff_guest_name: d.Diff_guest_name,
      };
    })
    .filter(Boolean);

  summary.push({
    Metric: 'Core differences (dates/nights/price/guest)',
    Count: coreWide.length,
  });

  const wbOut = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbOut, XLSX.utils.json_to_sheet(summary), 'Summary');
  XLSX.utils.book_append_sheet(
    wbOut,
    XLSX.utils.json_to_sheet(coreLong.length ? coreLong : [{ Field: 'none' }]),
    'Core field diffs'
  );
  XLSX.utils.book_append_sheet(
    wbOut,
    XLSX.utils.json_to_sheet(coreWide.length ? coreWide : [{ Status: 'none' }]),
    'Core differences wide'
  );
  XLSX.utils.book_append_sheet(
    wbOut,
    XLSX.utils.json_to_sheet(diffLong.length ? diffLong : [{ Field: 'none' }]),
    'All field differences'
  );
  XLSX.utils.book_append_sheet(
    wbOut,
    XLSX.utils.json_to_sheet(differences.length ? differences : [{ Status: 'none' }]),
    'Differences wide'
  );
  XLSX.utils.book_append_sheet(
    wbOut,
    XLSX.utils.json_to_sheet(
      missingOnWebsite.length ? missingOnWebsite : [{ Status: 'none' }]
    ),
    'Missing on website'
  );
  XLSX.utils.book_append_sheet(
    wbOut,
    XLSX.utils.json_to_sheet(unitNotFound.length ? unitNotFound : [{ Status: 'none' }]),
    'Unit not found'
  );

  XLSX.writeFile(wbOut, OUT);
  console.log(`[diff] matched_same=${matchedSame.length}`);
  console.log(`[diff] field_differences=${differences.length} (long rows=${diffLong.length})`);
  console.log(`[diff] missing_on_website=${missingOnWebsite.length}`);
  console.log(`[diff] unit_not_found=${unitNotFound.length}`);
  console.log(`[diff] wrote → ${OUT}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
