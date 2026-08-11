/**
 * Append Ain Sokhna reservations from Excel (does NOT wipe existing).
 * Red rows OR blank/unmatched unit → cancelled (kept, shown in red).
 *
 * Usage:
 *   node scripts/import_ain_sokhna_reservations.js --dry-run
 *   node scripts/import_ain_sokhna_reservations.js
 */
require('dotenv').config();
const XLSX = require('xlsx');
const { query, pool } = require('../src/config/db');

const FILE =
  process.env.SOKHNA_RESERVATIONS_XLSX ||
  'C:/Users/hazem/Downloads/All Ain Sokhna Reservations.xlsx';
const DRY = process.argv.includes('--dry-run');
const EXPECTED = 56;
const SOURCE_TAG = '[xlsx-import:ain-sokhna]';

function compact(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, '');
}

function normCode(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');
}

function codeVariants(raw) {
  const base = normCode(raw);
  const set = new Set([base, compact(raw)]);
  if (!base) return set;
  // B3-V4TW-6B → B3-V4-TW-6B
  set.add(base.replace(/V(\d)TW-/i, 'V$1-TW-'));
  set.add(compact(base.replace(/V(\d)TW-/i, 'V$1-TW-')));
  set.add(base.replace(/-CH(\d)/g, '-$1'));
  set.add(base.replace(/-CH-/g, '-'));
  // CH-161-01-04 ↔ CH1610104
  if (base.startsWith('CH-')) {
    set.add(base.slice(3));
    set.add('CH' + base.slice(3));
  }
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
  if (v == null || v === '' || v === '#REF!' || v === '#N/A') return 0;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function str(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (s === '#REF!' || s === '#N/A') return '';
  return s;
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

function cellRgb(cell) {
  if (!cell || !cell.s || !cell.s.fgColor) return null;
  return String(cell.s.fgColor.rgb || '').toUpperCase();
}

function isRedRgb(rgb) {
  if (!rgb) return false;
  const h = rgb.length === 8 ? rgb.slice(2) : rgb;
  if (h === 'FF0000') return true;
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return r >= 200 && g <= 80 && b <= 80;
}

function parseWorkbook(file) {
  const wb = XLSX.readFile(file, { cellStyles: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const header = {};
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c })];
    if (cell && cell.v != null) header[str(cell.v)] = c;
  }
  const col = (...names) => {
    for (const n of names) if (header[n] != null) return header[n];
    return null;
  };
  const cIn = col('Check In') ?? 0;
  const cOut = col('Check out', 'Check Out') ?? 1;
  const cUnit = col('Unit No.', 'Unit No') ?? 2;
  const cName = col('Client Name') ?? 3;
  const cMobile = col('Mobile No.', 'Mobile No') ?? 4;
  const cGuests = col('Number Of Guests') ?? 5;
  const cPay = col('Payment Method');
  const cNights = col('Nights ', 'Nights');
  const cPpn = col('Price per Night');
  const cTotal = col('Total Reservation EGP', 'Total Reservation');
  const cDown = col('Down Payment');
  const cIns = col('Insurance ', 'Insurance');
  const cHk = col('Housekeeping');
  const cBeach = col('Beach Pass');
  const cUtil = col('Total Utilites', 'Utilites ');
  const cSource = col('Source');
  const cSales = col('Sales Name');
  const cNotes = col('Notes');
  const cNotes2 = col('Notes_1');

  const rows = [];
  for (let R = 1; R <= range.e.r; R++) {
    const get = (c) => (c == null ? null : sheet[XLSX.utils.encode_cell({ r: R, c })]);
    const cinCell = get(cIn);
    const coutCell = get(cOut);
    const unitCell = get(cUnit);
    const nameCell = get(cName);
    const hasData =
      (cinCell && cinCell.v != null && cinCell.v !== '') ||
      (unitCell && unitCell.v != null && String(unitCell.v).trim() !== '') ||
      (nameCell && nameCell.v != null && String(nameCell.v).trim() !== '');
    if (!hasData) continue;

    let cancelled = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      if (isRedRgb(cellRgb(get(c)))) {
        cancelled = true;
        break;
      }
    }

    const checkIn = excelSerialToIso(cinCell && cinCell.v);
    const checkOut = excelSerialToIso(coutCell && coutCell.v);
    const unitRaw = str(unitCell && unitCell.v);
    const guestName = str(nameCell && nameCell.v) || (cancelled ? 'Cancelled guest' : 'Guest');
    const total = num(get(cTotal) && get(cTotal).v);
    const down = num(get(cDown) && get(cDown).v);
    const nights =
      num(get(cNights) && get(cNights).v) ||
      (checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0);
    const pricePerNight =
      num(get(cPpn) && get(cPpn).v) || (nights > 0 ? total / nights : 0);
    const source = str(get(cSource) && get(cSource).v) || 'Excel';
    const salesName = str(get(cSales) && get(cSales).v);
    const notes = [str(get(cNotes) && get(cNotes).v), str(get(cNotes2) && get(cNotes2).v)]
      .filter(Boolean)
      .join(' · ');

    rows.push({
      excelRow: R + 1,
      cancelled,
      unitRaw,
      checkIn,
      checkOut,
      guestName,
      guestPhone: phoneStr(get(cMobile) && get(cMobile).v),
      guests: num(get(cGuests) && get(cGuests).v) || 1,
      nights,
      pricePerNight,
      total,
      amountPaid: down,
      insurance: num(get(cIns) && get(cIns).v),
      housekeeping: num(get(cHk) && get(cHk).v),
      beachPass: num(get(cBeach) && get(cBeach).v),
      utilities: num(get(cUtil) && get(cUtil).v),
      paymentMethod: paymentMethod(get(cPay) && get(cPay).v),
      bookingSource: source,
      salesName,
      notes,
      isOwner: isOwnerRow(guestName, source, salesName),
    });
  }
  return rows;
}

async function loadUnitMap() {
  const { rows } = await query(`SELECT id, unit_number, wp_post_id, title, utilities_cost FROM units`);
  const byDense = new Map();
  for (const u of rows) {
    const d = compact(u.unit_number);
    if (d && !byDense.has(d)) byDense.set(d, u);
    const t = compact(u.title);
    if (t && !byDense.has(t)) byDense.set(t, u);
  }
  return { byDense };
}

function resolveUnit(unitRaw, byDense) {
  if (!unitRaw) return null;
  for (const v of codeVariants(unitRaw)) {
    const d = compact(v);
    if (d && byDense.has(d)) return byDense.get(d);
  }
  return null;
}

async function resolveCreatedBy() {
  const { rows } = await query(
    `SELECT id FROM staff_users WHERE role = 'admin' AND is_active = 1 ORDER BY id LIMIT 1`
  );
  if (!rows[0]) throw new Error('No active admin staff user for created_by');
  return rows[0].id;
}

async function blockNights(wpPostId, checkIn, checkOut) {
  if (!wpPostId || !checkIn || !checkOut) return 0;
  let n = 0;
  for (const date of eachNight(checkIn, checkOut)) {
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
  console.log(`[sokhna] file=${FILE} dry=${DRY}`);
  const before = (await query(`SELECT count(*)::int AS n FROM reservations`)).rows[0].n;
  console.log(`[sokhna] existing reservations=${before}`);

  const parsed = parseWorkbook(FILE);
  console.log(
    `[sokhna] parsed=${parsed.length} red=${parsed.filter((r) => r.cancelled).length}`
  );
  if (parsed.length !== EXPECTED) {
    throw new Error(`Expected ${EXPECTED} data rows, got ${parsed.length}`);
  }

  const badDates = parsed.filter((r) => !r.checkIn || !r.checkOut || r.checkOut <= r.checkIn);
  if (badDates.length) {
    console.log(
      '[warn] bad dates',
      badDates.map((r) => r.excelRow)
    );
    throw new Error(`${badDates.length} rows have invalid check-in/out`);
  }

  const { byDense } = await loadUnitMap();
  const unmatched = new Map();
  let matched = 0;
  for (const r of parsed) {
    const unit = resolveUnit(r.unitRaw, byDense);
    r.unit = unit;
    if (!r.unitRaw || !unit) r.cancelled = true;
    if (unit) matched += 1;
    else {
      const key = r.unitRaw || '(blank)';
      unmatched.set(key, (unmatched.get(key) || 0) + 1);
    }
  }
  console.log(`[sokhna] matchedUnits=${matched} unmatchedCodes=${unmatched.size}`);
  for (const [k, n] of [...unmatched.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${k}: ${n}`);
  }

  if (DRY) {
    console.log('[sokhna] dry-run complete — no writes');
    await pool.end();
    return;
  }

  // Remove any previous Ain Sokhna import only (safe re-run)
  await query(`UPDATE petty_cash SET linked_reservation_id = NULL
    WHERE linked_reservation_id IN (
      SELECT id FROM reservations WHERE notes ILIKE $1
    )`, [`%${SOURCE_TAG}%`]);
  await query(`DELETE FROM commissions WHERE reservation_id IN (
    SELECT id FROM reservations WHERE notes ILIKE $1
  )`, [`%${SOURCE_TAG}%`]);
  await query(`DELETE FROM payments WHERE reservation_id IN (
    SELECT id FROM reservations WHERE notes ILIKE $1
  )`, [`%${SOURCE_TAG}%`]);
  await query(`DELETE FROM housekeeping_tasks WHERE reservation_id IN (
    SELECT id FROM reservations WHERE notes ILIKE $1
  )`, [`%${SOURCE_TAG}%`]);
  const { rows: wiped } = await query(
    `DELETE FROM reservations WHERE notes ILIKE $1 RETURNING id`,
    [`%${SOURCE_TAG}%`]
  );
  if (wiped.length) console.log(`[sokhna] cleared previous import=${wiped.length}`);

  const createdBy = await resolveCreatedBy();
  let inserted = 0;
  let cancelled = 0;
  let blocked = 0;
  let nullUnit = 0;

  for (const r of parsed) {
    const status = r.cancelled ? 'cancelled' : 'confirmed';
    const noteParts = [
      SOURCE_TAG,
      r.cancelled
        ? r.unitRaw
          ? r.unit
            ? 'Excel red = cancelled'
            : `Unmatched unit: ${r.unitRaw}`
          : 'No unit code = cancelled'
        : null,
      r.salesName ? `Sales: ${r.salesName}` : null,
      r.beachPass ? `Beach pass: ${r.beachPass}` : null,
      r.notes || null,
    ].filter(Boolean);

    const unitId = r.unit ? r.unit.id : null;
    if (!unitId) nullUnit += 1;

    const nights = r.nights || nightsBetween(r.checkIn, r.checkOut);
    const unitUtilRate = Number(r.unit && r.unit.utilities_cost) || 0;
    const utilitiesAmount =
      unitUtilRate > 0 && nights > 0
        ? Math.round(unitUtilRate * nights * 100) / 100
        : r.utilities || 0;

    await query(
      `INSERT INTO reservations (
         unit_id, guest_name, guest_email, guest_phone,
         check_in, check_out, nights, total_amount, amount_paid, payment_status,
         booking_source, is_owner_reservation, status, notes, created_by,
         price_per_night, housekeeping_fees, insurance, down_payment,
         utilities_amount, payment_method, adults, children, nanny_count, sales_label,
         beach_access_fees
       ) VALUES (
         $1,$2,NULL,$3,$4::date,$5::date,$6,$7,$8,$9,$10,$11,$12,$13,$14,
         $15,$16,$17,$18,$19,$20,$21,0,0,$22,$23
       )`,
      [
        unitId,
        r.guestName,
        r.guestPhone,
        r.checkIn,
        r.checkOut,
        nights,
        r.total,
        r.amountPaid,
        paymentStatus(r.total, r.amountPaid),
        r.bookingSource || 'Excel',
        r.isOwner ? 1 : 0,
        status,
        noteParts.join(' · '),
        createdBy,
        r.pricePerNight || 0,
        r.housekeeping || 0,
        r.insurance || 0,
        r.amountPaid,
        utilitiesAmount,
        r.paymentMethod,
        Math.max(0, Number(r.guests) || 0),
        r.salesName || null,
        r.beachPass || 0,
      ]
    );

    inserted += 1;
    if (r.cancelled) cancelled += 1;
    else if (r.unit && r.unit.wp_post_id) {
      blocked += await blockNights(r.unit.wp_post_id, r.checkIn, r.checkOut);
    }

    if (inserted <= 5 || inserted === EXPECTED) {
      console.log(
        `[insert] ${inserted}/${EXPECTED} row=${r.excelRow} ${r.unitRaw || '—'} ${r.checkIn} ${r.guestName} ${status}`
      );
    }
  }

  const after = (await query(`SELECT count(*)::int AS n FROM reservations`)).rows[0].n;
  const byStatus = (
    await query(
      `SELECT status, count(*)::int AS n FROM reservations GROUP BY status ORDER BY status`
    )
  ).rows;
  const sokhna = (
    await query(`SELECT count(*)::int AS n FROM reservations WHERE notes ILIKE $1`, [
      `%${SOURCE_TAG}%`,
    ])
  ).rows[0].n;

  console.log(
    `[done] inserted=${inserted} cancelled=${cancelled} null_unit=${nullUnit} blocked_nights=${blocked}`
  );
  console.log(`[done] sokhna=${sokhna} total_db=${after} (was ${before})`);
  console.log('[status]', byStatus);
  if (sokhna !== EXPECTED) throw new Error(`Sokhna count ${sokhna} !== ${EXPECTED}`);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch (_) {}
  process.exit(1);
});
