/**
 * Compare Reservations 2026.xlsx with DB; insert missing rows and block nights.
 *
 * Usage:
 *   node scripts/sync_reservations_xlsx.js --dry-run
 *   node scripts/sync_reservations_xlsx.js
 */
require('dotenv').config();
const XLSX = require('xlsx');
const { query } = require('../src/config/db');

const FILE = process.env.RESERVATIONS_XLSX || 'C:/Users/hazem/Downloads/Reservations 2026 (4).xlsx';
const DRY = process.argv.includes('--dry-run');
const SOURCE_TAG = '[xlsx-import:reservations-2026-4]';

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

/** Generate alternate codes for fuzzy unit matching. */
function codeVariants(raw) {
  const base = normCode(ALIASES[normCode(raw)] || raw);
  const set = new Set([base]);
  if (!base) return set;

  // Drop GAIA- prefix
  if (base.startsWith('GAIA-')) set.add(base.slice(5));

  // Compact hyphens in last segment: R-16-3 → R16-3
  set.add(base.replace(/-(\d)-(\d)$/, '$1-$2'));
  set.add(base.replace(/^([A-Z]+)-(\d+)-(\d+)$/, '$1$2-$3'));

  // ST5-CH79-01-01 → ST5-79-01-01
  set.add(base.replace(/-CH(\d)/g, '-$1'));
  set.add(base.replace(/-CH-/g, '-'));

  // CL11-CH21B-G → CL11-CH21-BG (letter glued to floor)
  const m = base.match(/^(.+)-([A-Z]*\d+[A-Z]*)-([A-Z])$/);
  if (m) set.add(`${m[1]}-${m[2]}-${m[3]}`);
  const m2 = base.match(/^(.+)-([A-Z]*\d+)([A-Z]+)-([A-Z])$/);
  if (m2) set.add(`${m2[1]}-${m2[2]}-${m2[3]}${m2[4]}`);

  // Insert TW hyphen: B3-V4TW-6B → B3-V4-TW-6B
  set.add(base.replace(/V(\d)TW-/i, 'V$1-TW-'));

  // Strip all hyphens for denseless compare key later
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

function nightsBetween(checkIn, checkOut) {
  const a = new Date(`${checkIn}T00:00:00Z`);
  const b = new Date(`${checkOut}T00:00:00Z`);
  return Math.max(1, Math.round((b - a) / 86400000));
}

function eachNight(checkIn, checkOut) {
  const out = [];
  const cur = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  while (cur < end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function num(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function str(v) {
  if (v == null) return '';
  return String(v).trim();
}

function phoneStr(v) {
  if (v == null || v === '' || v === 0) return null;
  const s = String(v).trim();
  if (!s || s === '0') return null;
  return s;
}

function isOwnerRow(guestName, source, salesName) {
  const g = str(guestName).toLowerCase();
  const s = str(source).toLowerCase();
  const sales = str(salesName).toLowerCase();
  return g === 'owner' || s === 'owner' || sales === 'owner';
}

function paymentMethod(raw) {
  const s = str(raw).toLowerCase();
  if (!s || s === '0') return null;
  if (s.includes('instapay')) return 'instapay';
  if (s.includes('cash')) return 'cash';
  if (s.includes('card') || s.includes('paymob') || s.includes('visa')) return 'paymob_card';
  if (s.includes('transfer') || s.includes('bank')) return 'bank_transfer';
  return 'instapay';
}

function paymentStatus(total, paid) {
  if (paid <= 0.009) return 'pending';
  if (paid + 0.5 >= total) return 'paid';
  return 'partial';
}

function rowKey(unitId, checkIn, checkOut, guestName) {
  return `${unitId}|${checkIn}|${checkOut}|${str(guestName).toLowerCase()}`;
}

function parseSheet(wb, sheetName) {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  const out = [];
  for (const r of rows) {
    const unitRaw = r['Unit No.'] ?? r['Unit No'] ?? r['Unit'];
    const checkIn = excelSerialToIso(r['Check In'] ?? r['Check in'] ?? r['CheckIn']);
    const checkOut = excelSerialToIso(r['Check out'] ?? r['Check Out'] ?? r['Checkout']);
    const guestName = str(r['Client Name'] || r['Guest Name'] || '');
    if (!unitRaw || !checkIn || !checkOut || !guestName) continue;
    if (checkOut <= checkIn) continue;

    const total =
      num(r['Total Reservation']) ||
      num(r['Total Reservation EGP']) ||
      0;
    const down = num(r['Down Payment']);
    const nights = num(r['Nights ']) || num(r['Nights']) || nightsBetween(checkIn, checkOut);
    const pricePerNight =
      num(r['Price per Night']) || (nights > 0 ? total / nights : 0);
    const source = str(r['Source'] || r['Res. Platfoem'] || 'manual') || 'manual';
    const salesName = str(r['Sales Name'] || '');
    const owner = isOwnerRow(guestName, source, salesName);

    out.push({
      sheet: sheetName,
      unitCode: normCode(ALIASES[normCode(unitRaw)] || unitRaw),
      unitRaw: str(unitRaw),
      checkIn,
      checkOut,
      guestName,
      guestPhone: phoneStr(r['Mobile No.'] ?? r['Mobile No']),
      guests: num(r['Number Of Guests']) || 1,
      nights,
      pricePerNight,
      total,
      amountPaid: down,
      insurance: num(r['Insurance ']) || num(r['Insurance']),
      housekeeping: num(r['Housekeeping']),
      beachPass: num(r['Beach Pass']),
      utilities: num(r['Total Utilites']) || num(r['Utilites ']) || 0,
      paymentMethod: paymentMethod(r['Payment Method']),
      bookingSource: source || 'Excel',
      salesName,
      notes: str(r['Notes'] || ''),
      isOwner: owner,
    });
  }
  return out;
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
  return { rows, byCode, byDense };
}

function resolveUnit(row, byCode, byDense) {
  for (const v of codeVariants(row.unitRaw || row.unitCode)) {
    if (byCode.has(v)) return byCode.get(v);
    const dense = v.replace(/-/g, '');
    if (byDense.has(dense)) return byDense.get(dense);
  }
  return null;
}

async function loadExistingKeys() {
  const { rows } = await query(
    `SELECT id, unit_id, check_in::text AS check_in, check_out::text AS check_out,
            guest_name, status
     FROM reservations
     WHERE status IS DISTINCT FROM 'cancelled'`
  );
  const keys = new Set();
  const loose = new Set(); // unit|checkin|checkout without guest
  for (const r of rows) {
    keys.add(rowKey(r.unit_id, r.check_in, r.check_out, r.guest_name));
    loose.add(`${r.unit_id}|${r.check_in}|${r.check_out}`);
  }
  return { keys, loose, count: rows.length };
}

async function resolveCreatedBy() {
  const { rows } = await query(
    `SELECT id FROM staff_users WHERE role = 'admin' AND is_active = 1 ORDER BY id LIMIT 1`
  );
  if (!rows[0]) throw new Error('No active admin staff user for created_by');
  return rows[0].id;
}

async function blockNights(wpPostId, checkIn, checkOut) {
  if (!wpPostId) return 0;
  const nights = eachNight(checkIn, checkOut);
  let n = 0;
  for (const date of nights) {
    await query(
      `INSERT INTO unit_blocked_dates (wp_post_id, date, source, updated_at)
       VALUES ($1, $2::date, 'reservation_import', now())
       ON CONFLICT (wp_post_id, date) DO UPDATE
         SET source = EXCLUDED.source, updated_at = now()`,
      [wpPostId, date]
    );
    n += 1;
  }
  return n;
}

async function main() {
  console.log(`[sync] file=${FILE} dry=${DRY}`);
  const wb = XLSX.readFile(FILE);
  const sheetRows = SHEETS.flatMap((name) => parseSheet(wb, name));
  console.log(`[sync] sheet rows parsed: ${sheetRows.length}`);

  const { byCode, byDense } = await loadUnitMap();
  const existing = await loadExistingKeys();
  console.log(`[sync] DB active reservations: ${existing.count}`);

  const createdBy = await resolveCreatedBy();

  const missing = [];
  const unmatchedUnits = new Map();
  const already = [];

  for (const row of sheetRows) {
    const unit = resolveUnit(row, byCode, byDense);
    if (!unit) {
      unmatchedUnits.set(row.unitCode, (unmatchedUnits.get(row.unitCode) || 0) + 1);
      continue;
    }
    const key = rowKey(unit.id, row.checkIn, row.checkOut, row.guestName);
    const loose = `${unit.id}|${row.checkIn}|${row.checkOut}`;
    if (existing.keys.has(key) || existing.loose.has(loose)) {
      already.push(row);
      continue;
    }
    missing.push({ ...row, unit });
  }

  console.log(`[sync] already present (match): ${already.length}`);
  console.log(`[sync] missing to insert: ${missing.length}`);
  console.log(`[sync] unmatched unit codes: ${unmatchedUnits.size}`);
  if (unmatchedUnits.size) {
    const top = [...unmatchedUnits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    for (const [code, n] of top) console.log(`  - ${code}: ${n}`);
  }

  // Preview first few missing
  for (const m of missing.slice(0, 15)) {
    console.log(
      `  MISSING ${m.unitCode} ${m.checkIn}→${m.checkOut} ${m.guestName} total=${m.total}`
    );
  }
  if (missing.length > 15) console.log(`  … +${missing.length - 15} more`);

  if (DRY) {
    console.log('[sync] dry-run complete — no writes');
    process.exit(0);
  }

  let inserted = 0;
  let blockedNights = 0;
  let errors = 0;

  for (const m of missing) {
    try {
      const nights = m.nights || nightsBetween(m.checkIn, m.checkOut);
      const total = m.total || 0;
      const amountPaid = m.amountPaid || 0;
      const noteParts = [
        SOURCE_TAG,
        m.sheet,
        m.salesName ? `Sales: ${m.salesName}` : null,
        m.beachPass ? `Beach pass: ${m.beachPass}` : null,
        m.notes || null,
      ].filter(Boolean);

      const { rows } = await query(
        `INSERT INTO reservations (
           unit_id, guest_name, guest_email, guest_phone,
           check_in, check_out, nights, total_amount, amount_paid, payment_status,
           booking_source, is_owner_reservation, status, notes, created_by,
           price_per_night, housekeeping_fees, insurance, down_payment,
           utilities_amount, payment_method, adults, children, nanny_count, sales_label
         ) VALUES (
           $1,$2,NULL,$3,$4::date,$5::date,$6,$7,$8,$9,$10,$11,'confirmed',$12,$13,
           $14,$15,$16,$17,$18,$19,$20,0,0,$21
         )
         RETURNING id`,
        [
          m.unit.id,
          m.guestName,
          m.guestPhone,
          m.checkIn,
          m.checkOut,
          nights,
          total,
          amountPaid,
          paymentStatus(total, amountPaid),
          m.bookingSource || 'Excel',
          m.isOwner ? 1 : 0,
          noteParts.join(' · '),
          createdBy,
          m.pricePerNight || 0,
          m.housekeeping || 0,
          m.insurance || 0,
          amountPaid,
          m.utilities || 0,
          m.paymentMethod,
          Math.max(1, m.guests || 1),
          m.salesName || null,
        ]
      );

      const blockCount = await blockNights(m.unit.wp_post_id, m.checkIn, m.checkOut);
      blockedNights += blockCount;
      inserted += 1;
      existing.keys.add(rowKey(m.unit.id, m.checkIn, m.checkOut, m.guestName));
      existing.loose.add(`${m.unit.id}|${m.checkIn}|${m.checkOut}`);
      if (inserted <= 20 || inserted % 50 === 0) {
        console.log(
          `[insert] #${rows[0].id} ${m.unitCode} ${m.checkIn}→${m.checkOut} ${m.guestName} blocked=${blockCount}`
        );
      }
    } catch (err) {
      errors += 1;
      console.error(`[error] ${m.unitCode} ${m.checkIn} ${m.guestName}: ${err.message}`);
    }
  }

  console.log(`[sync] done inserted=${inserted} blocked_nights=${blockedNights} errors=${errors}`);
  process.exit(errors ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
