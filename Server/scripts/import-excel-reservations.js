/**
 * Import reservations from Excel export format:
 * Check In, Check Out, Unit, Project, Tenant Name, Mobile, Nights, Price/Night,
 * Total, Down Payment, Amt to Pay, Housekeeping, Insurance, Utilities,
 * Payment Status, Status, Sales / Owner
 *
 * Usage: node scripts/import-excel-reservations.js [path-to-xlsx]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { query, pool } = require('../src/config/db');

const DEFAULT_XLSX = 'c:/Users/hazem/Downloads/reservations_2026-08-03.xlsx';
const IMPORT_TAG = '[imported:excel_reservations_2026-08-03]';

const UNIT_ALIASES = {
  'GAIAZ-106': 'Z-106',
  'GAIA-Z-106': 'Z-106',
  'CL10-CH14-AG': 'CL10-CH14A-G',
  'CL10CH14AG': 'CL10-CH14A-G',
  'R-16-3': 'R16-3',
  'R163': 'R16-3',
  'Z-2202': 'Z22-02',
  'Z2202': 'Z22-02',
  'CL11-CH21B-G': 'CL11-CH21-BG',
  'CL11CH21BG': 'CL11-CH21-BG',
  'CL11-CH8-AG': 'CL11-CH8A-G',
  'CL11CH8AG': 'CL11-CH8A-G',
};

function normUnit(u) {
  return String(u || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '-');
}

function compactUnit(u) {
  return normUnit(u).replace(/-/g, '');
}

function normDate(d) {
  if (!d) return null;
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  if (typeof d === 'number') {
    // Excel serial
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + Math.floor(d));
    return epoch.toISOString().slice(0, 10);
  }
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function normName(n) {
  return String(n || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function mapPaymentStatus(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'paid') return 'paid';
  if (s === 'partial') return 'partial';
  return 'pending'; // unpaid
}

function mapStatus(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (['confirmed', 'cancelled', 'checked_in', 'checked_out', 'pending'].includes(s)) {
    return s;
  }
  return 'pending';
}

function slugify(code) {
  return String(code || 'unit')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

async function main() {
  const file = process.argv[2] || DEFAULT_XLSX;
  if (!fs.existsSync(file)) {
    throw new Error(`File not found: ${file}`);
  }

  // Ensure sales_label column exists
  await query(
    `ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS sales_label text`
  );

  const wb = XLSX.readFile(file);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const excel = XLSX.utils.sheet_to_json(sheet, { defval: null });
  console.log(`Loaded ${excel.length} rows from ${path.basename(file)}`);

  const { rows: units } = await query(
    `SELECT id, unit_number, compound, project FROM units`
  );
  const byNorm = new Map();
  const byCompact = new Map();
  for (const u of units) {
    byNorm.set(normUnit(u.unit_number), u);
    byCompact.set(compactUnit(u.unit_number), u);
  }

  function resolveUnit(code) {
    const n = normUnit(code);
    if (byNorm.has(n)) return byNorm.get(n);
    if (UNIT_ALIASES[n] && byNorm.has(normUnit(UNIT_ALIASES[n]))) {
      return byNorm.get(normUnit(UNIT_ALIASES[n]));
    }
    const c = compactUnit(code);
    if (byCompact.has(c)) return byCompact.get(c);
    const aliasCompact = UNIT_ALIASES[n] ? compactUnit(UNIT_ALIASES[n]) : null;
    if (aliasCompact && byCompact.has(aliasCompact)) return byCompact.get(aliasCompact);
    // loose: ignore case/hyphen differences already covered; try contains
    for (const [k, u] of byNorm) {
      if (k.includes(n) || n.includes(k)) return u;
    }
    return null;
  }

  const { rows: staff } = await query(
    `SELECT id, full_name FROM staff_users WHERE full_name IS NOT NULL`
  );
  const { matchSalesLabelToStaff } = require('../src/lib/salesNameMatch');

  function resolveSales(label) {
    const raw = String(label || '').trim();
    if (!raw) return { isOwner: false, salesPersonId: null, salesLabel: null };
    if (/^owner$/i.test(raw)) {
      return { isOwner: true, salesPersonId: null, salesLabel: 'Owner' };
    }
    const match = matchSalesLabelToStaff(raw, staff);
    return {
      isOwner: false,
      salesPersonId: match?.staff?.id || null,
      salesLabel: raw,
    };
  }

  const { rows: adminRows } = await query(
    `SELECT id FROM staff_users WHERE role = 'admin' ORDER BY id LIMIT 1`
  );
  const createdBy = adminRows[0]?.id || 1;

  // Create draft units for missing codes
  const missingCodes = new Map(); // code -> project
  for (const row of excel) {
    if (!row.Unit) continue;
    if (!resolveUnit(row.Unit)) {
      missingCodes.set(String(row.Unit).trim(), String(row.Project || 'North Coast').trim());
    }
  }
  let createdUnits = 0;
  for (const [code, project] of missingCodes) {
    const slugBase = slugify(code) || `unit-${Date.now()}`;
    let slug = slugBase;
    let i = 1;
    while (true) {
      const { rows: exists } = await query(`SELECT 1 FROM units WHERE slug = $1`, [slug]);
      if (!exists[0]) break;
      slug = `${slugBase}-${i++}`;
    }
    const { rows: inserted } = await query(
      `INSERT INTO units (
         slug, title, status, source, compound, project, area, unit_number,
         beds, baths, guests, listing_type, created_by_staff
       ) VALUES (
         $1, $2, 'draft', 'manual', $3, $3, 'North Coast', $4,
         1, 1, 2, 'rent', $5
       ) RETURNING id, unit_number, compound, project`,
      [slug, code, project || 'North Coast', code, createdBy]
    );
    const u = inserted[0];
    byNorm.set(normUnit(u.unit_number), u);
    byCompact.set(compactUnit(u.unit_number), u);
    createdUnits += 1;
    console.log(`Created draft unit ${code} (${project})`);
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of excel) {
    const unit = resolveUnit(row.Unit);
    if (!unit) {
      skipped += 1;
      console.warn('Skip — no unit:', row.Unit);
      continue;
    }
    const checkIn = normDate(row['Check In']);
    const checkOut = normDate(row['Check Out']);
    if (!checkIn || !checkOut) {
      skipped += 1;
      console.warn('Skip — bad dates:', row.Unit, row['Check In'], row['Check Out']);
      continue;
    }
    const guestName = String(row['Tenant Name'] || '').trim() || 'Guest';
    const phoneRaw = String(row.Mobile ?? '').trim();
    const guestPhone =
      !phoneRaw || phoneRaw === '0' || phoneRaw === 'null' ? null : phoneRaw;

    const nights =
      Number(row.Nights) > 0
        ? Math.round(Number(row.Nights))
        : Math.max(
            1,
            Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000)
          );
    const pricePerNight = money(row['Price/Night']);
    const total = money(row.Total);
    const down = money(row['Down Payment']);
    const housekeeping = money(row.Housekeeping);
    const insurance = money(row.Insurance);
    const utilities = money(row.Utilities);
    const paymentStatus = mapPaymentStatus(row['Payment Status']);
    const status = mapStatus(row.Status);
    const sales = resolveSales(row['Sales / Owner']);

    // amount_paid: if paid → total; else use down payment as collected
    let amountPaid = down;
    if (paymentStatus === 'paid') amountPaid = total;
    else if (paymentStatus === 'partial') amountPaid = down > 0 ? down : money(row['Amt to Pay'] != null ? total - money(row['Amt to Pay']) : down);

    const isOwner =
      sales.isOwner ||
      (/^owner\b/i.test(guestName) && total === 0);

    const notes = IMPORT_TAG;

    // Match existing imported / same stay
    const { rows: existing } = await query(
      `SELECT id FROM reservations
       WHERE unit_id = $1
         AND check_in = $2::date
         AND check_out = $3::date
         AND lower(trim(guest_name)) = lower(trim($4))
       ORDER BY
         CASE WHEN notes = $5 OR notes LIKE $6 THEN 0 ELSE 1 END,
         id DESC
       LIMIT 1`,
      [unit.id, checkIn, checkOut, guestName, notes, `${IMPORT_TAG}%`]
    );

    // Prefer exact import match; if another reservation with same key exists, update it
    const existingId = existing[0]?.id;

    if (existingId) {
      await query(
        `UPDATE reservations SET
           guest_phone = COALESCE($1, guest_phone),
           nights = $2,
           price_per_night = $3,
           total_amount = $4,
           down_payment = $5,
           amount_paid = $6,
           housekeeping_fees = $7,
           insurance = $8,
           utilities_amount = $9,
           payment_status = $10,
           status = $11,
           is_owner_reservation = $12,
           sales_person_id = $13,
           sales_label = $14,
           notes = CASE
             WHEN notes IS NULL OR notes = '' THEN $15
             WHEN notes LIKE $16 THEN notes
             ELSE $15 || E'\\n' || notes
           END,
           updated_at = now()
         WHERE id = $17`,
        [
          guestPhone,
          nights,
          pricePerNight,
          total,
          down,
          amountPaid,
          housekeeping,
          insurance,
          utilities,
          paymentStatus,
          status,
          isOwner ? 1 : 0,
          sales.salesPersonId,
          sales.salesLabel,
          notes,
          `${IMPORT_TAG}%`,
          existingId,
        ]
      );
      updated += 1;
    } else {
      await query(
        `INSERT INTO reservations (
           unit_id, guest_name, guest_phone, check_in, check_out, nights,
           price_per_night, total_amount, down_payment, amount_paid,
           housekeeping_fees, insurance, utilities_amount,
           payment_status, status, is_owner_reservation,
           sales_person_id, sales_label, notes, created_by, adults, children, nanny_count
         ) VALUES (
           $1,$2,$3,$4::date,$5::date,$6,
           $7,$8,$9,$10,
           $11,$12,$13,
           $14,$15,$16,
           $17,$18,$19,$20,
           $21,0,0
         )`,
        [
          unit.id,
          guestName,
          guestPhone,
          checkIn,
          checkOut,
          nights,
          pricePerNight,
          total,
          down,
          amountPaid,
          housekeeping,
          insurance,
          utilities,
          paymentStatus,
          status,
          isOwner ? 1 : 0,
          sales.salesPersonId,
          sales.salesLabel,
          notes,
          createdBy,
          isOwner ? 0 : 1,
        ]
      );
      inserted += 1;
    }
  }

  const { rows: counts } = await query(
    `SELECT status, payment_status, COUNT(*)::int AS c
     FROM reservations
     WHERE notes LIKE $1
     GROUP BY 1, 2
     ORDER BY 1, 2`,
    [`${IMPORT_TAG}%`]
  );

  console.log({
    createdUnits,
    inserted,
    updated,
    skipped,
    importCounts: counts,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
