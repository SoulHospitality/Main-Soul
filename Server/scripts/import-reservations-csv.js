/**
 * Import reservations CSV; links units via units.source_code = CSV unit_id.
 *
 * Usage:
 *   set DATABASE_URL=...
 *   set RESERVATIONS_CSV=path\to\reservations.csv
 *   node scripts/import-reservations-csv.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');

const url = String(process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/gi, '').replace(/\?$/, '');
const csvPath =
  process.env.RESERVATIONS_CSV ||
  path.join(process.env.USERPROFILE || '', 'Downloads', 'reservations_rows.csv');

if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
if (!fs.existsSync(csvPath)) {
  console.error('CSV not found:', csvPath);
  process.exit(1);
}

const pool = new Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

function num(v, fallback = 0) {
  if (v === '' || v == null) return fallback;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function intOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function boolish(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function mapPaymentStatus(raw) {
  const s = String(raw || 'pending').toLowerCase();
  if (s === 'paid') return 'paid';
  if (s === 'partial') return 'partial';
  return 'pending';
}

function mapStatus(raw) {
  const s = String(raw || 'pending').toLowerCase();
  if (['confirmed', 'cancelled', 'checked_in', 'checked_out', 'pending'].includes(s)) return s;
  return 'pending';
}

async function main() {
  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    trim: true,
  });
  console.log(`[import] ${rows.length} rows from ${csvPath}`);

  const client = await pool.connect();
  try {
    const staffIds = new Set(
      (await client.query('SELECT id FROM public.staff_users')).rows.map((r) => r.id)
    );
    const { rows: adminRows } = await client.query(
      `SELECT id FROM public.staff_users WHERE role = 'admin' AND is_active = 1 ORDER BY id LIMIT 1`
    );
    const fallbackStaffId = adminRows[0]?.id || [...staffIds][0];
    if (!fallbackStaffId) throw new Error('No staff_users row to use as created_by');

    const { rows: unitRows } = await client.query(
      `SELECT id, source_code FROM public.units WHERE source_code IS NOT NULL`
    );
    const unitByCsvId = new Map(unitRows.map((u) => [String(u.source_code), u.id]));
    console.log(`[import] unit map size: ${unitByCsvId.size}`);

    await client.query('BEGIN');

    let inserted = 0;
    let skipped = 0;
    const missingUnits = new Set();
    let maxId = 0;

    for (const row of rows) {
      const csvUnitId = String(row.unit_id || '').trim();
      const unitUuid = unitByCsvId.get(csvUnitId);
      if (!unitUuid) {
        missingUnits.add(csvUnitId);
        skipped += 1;
        continue;
      }

      const csvId = intOrNull(row.id);
      if (csvId != null) maxId = Math.max(maxId, csvId);

      const guestName = String(row.guest_name || '').trim() || 'Guest';
      const createdByRaw = intOrNull(row.created_by);
      const createdBy =
        createdByRaw != null && staffIds.has(createdByRaw) ? createdByRaw : fallbackStaffId;
      const salesRaw = intOrNull(row.sales_person_id);
      const salesPersonId = salesRaw != null && staffIds.has(salesRaw) ? salesRaw : null;

      const isHold = boolish(row.is_hold);
      const holdUntil = String(row.hold_until || '').trim();
      const holdExpiresAt = isHold && holdUntil ? holdUntil : null;

      const createdAt = String(row.created_at || '').trim() || null;
      const updatedAt = String(row.updated_at || '').trim() || null;
      const ownerCollectedType = String(row.owner_collected_type || '').trim().slice(0, 20) || null;

      await client.query(
        `INSERT INTO public.reservations (
          id, unit_id, guest_name, guest_email, guest_phone, guest_nationality,
          check_in, check_out, nights, total_amount, amount_paid, payment_status,
          booking_source, sales_person_id, is_owner_reservation,
          transfer_proof_path, transfer_proof_name, status, notes, hold_expires_at,
          created_by, created_at, updated_at,
          price_per_night, housekeeping_fees, insurance, down_payment, utilities_amount,
          utilities_cost_override, broker_name, broker_amount_per_night, broker_total,
          owner_collected_type, owner_collected_amount
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7::date, $8::date, $9, $10, $11, $12,
          $13, $14, $15,
          $16, $17, $18, $19, $20::timestamptz,
          $21, COALESCE($22::timestamptz, now()), COALESCE($23::timestamptz, now()),
          $24, $25, $26, $27, $28,
          $29, $30, $31, $32,
          $33, $34
        )`,
        [
          csvId,
          unitUuid,
          guestName,
          String(row.guest_email || '').trim() || null,
          String(row.guest_phone || '').trim() || null,
          String(row.guest_nationality || '').trim() || null,
          row.check_in,
          row.check_out,
          Math.max(1, Math.trunc(num(row.nights, 1))),
          num(row.total_amount, 0),
          num(row.amount_paid, 0),
          mapPaymentStatus(row.payment_status),
          String(row.booking_source || '').trim() || null,
          salesPersonId,
          boolish(row.is_owner_reservation) ? 1 : 0,
          String(row.transfer_proof_path || '').trim() || null,
          String(row.transfer_proof_name || '').trim() || null,
          mapStatus(row.status),
          String(row.notes || '').trim() || null,
          holdExpiresAt,
          createdBy,
          createdAt,
          updatedAt,
          num(row.price_per_night, 0),
          num(row.housekeeping_fees, 0),
          num(row.insurance, 0),
          num(row.down_payment, 0),
          num(row.utilities_amount, 0),
          numOrNull(row.utilities_cost_override),
          String(row.broker_name || '').trim() || null,
          num(row.broker_amount_per_night, 0),
          num(row.broker_total, 0),
          ownerCollectedType,
          num(row.owner_collected_amount, 0),
        ]
      );
      inserted += 1;
    }

    if (maxId > 0) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('public.reservations', 'id'), GREATEST($1, (SELECT COALESCE(MAX(id), 1) FROM public.reservations)))`,
        [maxId]
      );
    }

    await client.query('COMMIT');

    const { rows: verify } = await client.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'pending')::int AS pending,
              count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
              count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
       FROM public.reservations`
    );
    console.log(`[import] inserted ${inserted}, skipped ${skipped}`);
    if (missingUnits.size) {
      console.log(
        `[import] missing unit_ids (source_code): ${[...missingUnits].slice(0, 30).join(', ')}${
          missingUnits.size > 30 ? '…' : ''
        }`
      );
    }
    console.log('[import] verify:', verify[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[import] FAILED:', err.message);
  process.exit(1);
});
