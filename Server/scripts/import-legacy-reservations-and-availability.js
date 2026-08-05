/**
 * Import legacy reservations and occupied dates from the supplied exports.
 *
 * Safety:
 * - Dry-run by default; pass --apply to write.
 * - Never creates units. A reservation/block is skipped if its unit cannot be
 *   mapped to an existing unit.
 * - Existing reservations (same unit + dates + normalized guest name) are not
 *   duplicated; only missing sales/source links are filled.
 * - Availability import only adds occupied dates; it never removes blocks.
 *
 * Usage:
 *   node scripts/import-legacy-reservations-and-availability.js
 *   node scripts/import-legacy-reservations-and-availability.js --apply
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { parse } = require('csv-parse/sync');
const { query: poolQuery, pool } = require('../src/config/db');
const { matchSalesLabelToStaff } = require('../src/lib/salesNameMatch');

let query = poolQuery;
let transactionClient = null;

const DEFAULTS = {
  reservations: 'C:/Users/hazem/Downloads/reservations_rows (4).csv',
  users: 'C:/Users/hazem/Downloads/users_rows.csv',
  legacyUnits: 'C:/Users/hazem/Downloads/units_rows (3).csv',
  availability: 'C:/Users/hazem/Downloads/Soul Availability  (1).xlsx',
};

const SOURCE = 'legacy_reservations_csv_2026_08_05';
const BLOCK_SOURCE = 'soul_availability_xlsx';

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

function readCsv(file) {
  return parse(fs.readFileSync(file), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
  });
}

function clean(value) {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
}

function numberOrNull(value) {
  const text = clean(value);
  if (text == null) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function integerOrNull(value) {
  const n = numberOrNull(value);
  return n == null ? null : Math.trunc(n);
}

function flag(value) {
  return ['1', 'true', 'yes', 'y', 'on'].includes(
    String(value ?? '').trim().toLowerCase()
  );
}

function isoDate(value) {
  const text = clean(value);
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!dmy) return null;
  return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
}

function normalizeUnit(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function looseUnit(value) {
  const chunks = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .match(/[A-Z]+|\d+/g);
  if (!chunks) return '';
  return chunks
    .map((chunk) => (/^\d+$/.test(chunk) ? String(Number(chunk)) : chunk))
    .join('');
}

function normalizeGuest(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function addToUniqueIndex(index, key, value) {
  if (!key) return;
  if (!index.has(key)) {
    index.set(key, value);
    return;
  }
  if (index.get(key)?.id !== value?.id) index.set(key, null);
}

function makeUnitResolver(currentUnits) {
  const exact = new Map();
  const loose = new Map();
  for (const unit of currentUnits) {
    const labels = [unit.unit_number, unit.source_code, unit.source_unit, unit.title];
    for (const label of labels) {
      addToUniqueIndex(exact, normalizeUnit(label), unit);
      addToUniqueIndex(loose, looseUnit(label), unit);
    }
  }
  return (label) => {
    const exactMatch = exact.get(normalizeUnit(label));
    if (exactMatch) return exactMatch;
    return loose.get(looseUnit(label)) || null;
  };
}

function mapPaymentStatus(value) {
  const status = String(value ?? '').trim().toLowerCase();
  if (status === 'paid') return 'paid';
  if (status === 'partial') return 'partial';
  return 'pending';
}

function mapReservationStatus(value) {
  const status = String(value ?? '').trim().toLowerCase();
  if (['pending', 'confirmed', 'cancelled', 'checked_in', 'checked_out'].includes(status)) {
    return status;
  }
  return 'pending';
}

function coerceForColumn(value, dataType) {
  if (value == null || value === '') return null;
  if (dataType === 'boolean') return flag(value);
  if (['integer', 'bigint', 'smallint'].includes(dataType)) {
    return integerOrNull(value);
  }
  if (['numeric', 'real', 'double precision', 'decimal'].includes(dataType)) {
    return numberOrNull(value);
  }
  return value;
}

async function getTableColumns(tableName) {
  const { rows } = await query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName]
  );
  return new Map(rows.map((row) => [row.column_name, row.data_type]));
}

async function insertDynamic(table, record, columns) {
  const entries = Object.entries(record)
    .filter(([key, value]) => columns.has(key) && value !== undefined)
    .map(([key, value]) => [key, coerceForColumn(value, columns.get(key))]);
  const names = entries.map(([key]) => `"${key}"`);
  const values = entries.map(([, value]) => value);
  const placeholders = values.map((_, i) => `$${i + 1}`);
  const { rows } = await query(
    `INSERT INTO ${table} (${names.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING id`,
    values
  );
  return rows[0];
}

async function main() {
  const apply = process.argv.includes('--apply');
  const files = {
    reservations: argValue('reservations', DEFAULTS.reservations),
    users: argValue('users', DEFAULTS.users),
    legacyUnits: argValue('legacy-units', DEFAULTS.legacyUnits),
    availability: argValue('availability', DEFAULTS.availability),
  };

  for (const [kind, file] of Object.entries(files)) {
    if (!fs.existsSync(file)) throw new Error(`${kind} file not found: ${file}`);
  }

  console.log(apply ? 'MODE: APPLY' : 'MODE: DRY RUN');
  console.log(
    Object.fromEntries(
      Object.entries(files).map(([key, value]) => [key, path.basename(value)])
    )
  );

  if (apply) {
    transactionClient = await pool.connect();
    query = transactionClient.query.bind(transactionClient);
    await query('BEGIN');
  }

  const legacyReservations = readCsv(files.reservations);
  const legacyUsers = readCsv(files.users);
  const legacyUnits = readCsv(files.legacyUnits);

  const { rows: currentUnits } = await query(
    `SELECT id, unit_number, source_code, source_unit, title, wp_post_id
     FROM units`
  );
  const resolveCurrentUnit = makeUnitResolver(currentUnits);

  const oldUnitById = new Map(legacyUnits.map((unit) => [String(unit.id), unit]));
  const oldUserById = new Map(legacyUsers.map((user) => [String(user.id), user]));

  const { rows: currentStaff } = await query(
    `SELECT id, full_name, username, role
     FROM staff_users
     WHERE is_active = 1 AND full_name IS NOT NULL AND btrim(full_name) <> ''`
  );
  const currentAdmin =
    currentStaff.find((staff) => staff.role === 'admin') || currentStaff[0];
  if (!currentAdmin) throw new Error('No active staff user available for created_by');

  const staffMatchCache = new Map();
  function resolveStaffByOldId(oldId) {
    const key = String(oldId ?? '').trim();
    if (!key) return null;
    if (staffMatchCache.has(key)) return staffMatchCache.get(key);
    const oldUser = oldUserById.get(key);
    const match = oldUser
      ? matchSalesLabelToStaff(oldUser.full_name || oldUser.username, currentStaff)
      : null;
    const staff = match?.staff || null;
    staffMatchCache.set(key, staff);
    return staff;
  }

  const reservationColumns = await getTableColumns('reservations');
  const stats = {
    reservationRows: legacyReservations.length,
    mappedUnitRows: 0,
    skippedMissingLegacyUnit: 0,
    skippedNonExistingUnit: 0,
    skippedInvalidDates: 0,
    existingReservations: 0,
    insertedReservations: 0,
    salesMatched: 0,
    salesUnmatched: 0,
  };
  const missingUnits = new Map();
  const unmatchedSales = new Map();

  for (const legacy of legacyReservations) {
    const oldUnit = oldUnitById.get(String(legacy.unit_id));
    if (!oldUnit) {
      stats.skippedMissingLegacyUnit += 1;
      missingUnits.set(
        `old-id:${legacy.unit_id}`,
        (missingUnits.get(`old-id:${legacy.unit_id}`) || 0) + 1
      );
      continue;
    }

    const unitCode = oldUnit.unit_number || oldUnit.name;
    const currentUnit = resolveCurrentUnit(unitCode);
    if (!currentUnit) {
      stats.skippedNonExistingUnit += 1;
      missingUnits.set(unitCode, (missingUnits.get(unitCode) || 0) + 1);
      continue;
    }
    stats.mappedUnitRows += 1;

    const checkIn = isoDate(legacy.check_in);
    const checkOut = isoDate(legacy.check_out);
    if (!checkIn || !checkOut || checkOut <= checkIn) {
      stats.skippedInvalidDates += 1;
      continue;
    }

    const salesStaff = resolveStaffByOldId(legacy.sales_person_id);
    const oldSalesUser = oldUserById.get(String(legacy.sales_person_id));
    const salesLabel = clean(oldSalesUser?.full_name || oldSalesUser?.username);
    if (clean(legacy.sales_person_id)) {
      if (salesStaff) stats.salesMatched += 1;
      else {
        stats.salesUnmatched += 1;
        const label = salesLabel || `old-user:${legacy.sales_person_id}`;
        unmatchedSales.set(label, (unmatchedSales.get(label) || 0) + 1);
      }
    }

    const guestName = clean(legacy.guest_name) || 'Guest';
    const { rows: existing } = await query(
      `SELECT id, sales_person_id, sales_label
       FROM reservations
       WHERE unit_id = $1
         AND check_in = $2::date
         AND check_out = $3::date
         AND lower(regexp_replace(btrim(guest_name), '\\s+', ' ', 'g')) = $4
       ORDER BY id DESC
       LIMIT 1`,
      [currentUnit.id, checkIn, checkOut, normalizeGuest(guestName)]
    );

    if (existing[0]) {
      stats.existingReservations += 1;
      if (apply) {
        const updates = [];
        const params = [];
        if (!existing[0].sales_person_id && salesStaff) {
          params.push(salesStaff.id);
          updates.push(`sales_person_id = $${params.length}`);
        }
        if (!existing[0].sales_label && salesLabel && reservationColumns.has('sales_label')) {
          params.push(salesLabel);
          updates.push(`sales_label = $${params.length}`);
        }
        if (
          reservationColumns.has('external_source') &&
          reservationColumns.has('external_uid')
        ) {
          params.push(SOURCE);
          updates.push(`external_source = COALESCE(external_source, $${params.length})`);
          params.push(String(legacy.id));
          updates.push(`external_uid = COALESCE(external_uid, $${params.length})`);
        }
        if (updates.length) {
          params.push(existing[0].id);
          await query(
            `UPDATE reservations
             SET ${updates.join(', ')}, updated_at = now()
             WHERE id = $${params.length}`,
            params
          );
        }
      }
      continue;
    }

    const createdByStaff =
      resolveStaffByOldId(legacy.created_by) || salesStaff || currentAdmin;
    const cancelledByStaff = resolveStaffByOldId(legacy.cancelled_by);
    const cancelRequestedByStaff = resolveStaffByOldId(legacy.cancel_requested_by);

    const record = {
      unit_id: currentUnit.id,
      guest_name: guestName,
      guest_email: clean(legacy.guest_email),
      guest_phone: clean(legacy.guest_phone),
      guest_nationality: clean(legacy.guest_nationality),
      check_in: checkIn,
      check_out: checkOut,
      nights:
        integerOrNull(legacy.nights) ||
        Math.max(
          1,
          Math.round(
            (new Date(`${checkOut}T00:00:00Z`) -
              new Date(`${checkIn}T00:00:00Z`)) /
              86400000
          )
        ),
      total_amount: numberOrNull(legacy.total_amount) || 0,
      amount_paid: numberOrNull(legacy.amount_paid) || 0,
      down_payment: numberOrNull(legacy.down_payment) || 0,
      housekeeping_fees: numberOrNull(legacy.housekeeping_fees) || 0,
      insurance: numberOrNull(legacy.insurance) || 0,
      utilities_amount: numberOrNull(legacy.utilities_amount) || 0,
      price_per_night: numberOrNull(legacy.price_per_night) || 0,
      payment_status: mapPaymentStatus(legacy.payment_status),
      booking_source: clean(legacy.booking_source) || 'Legacy import',
      sales_person_id: salesStaff?.id || null,
      sales_label: salesLabel,
      is_owner_reservation: flag(legacy.is_owner_reservation) ? 1 : 0,
      transfer_proof_path: clean(legacy.transfer_proof_path),
      transfer_proof_name: clean(legacy.transfer_proof_name),
      status: mapReservationStatus(legacy.status),
      cancel_requested_by: cancelRequestedByStaff?.id || null,
      cancel_requested_at: clean(legacy.cancel_requested_at),
      cancel_reason: clean(legacy.cancel_reason),
      cancel_type: clean(legacy.cancel_type),
      notes: clean(legacy.notes),
      created_by: createdByStaff.id,
      created_at: clean(legacy.created_at),
      updated_at: clean(legacy.updated_at),
      cancelled_by: cancelledByStaff?.id || null,
      cancelled_at: clean(legacy.cancelled_at),
      refund_status: clean(legacy.refund_status),
      refund_proof_path: clean(legacy.refund_proof_path),
      refund_proof_name: clean(legacy.refund_proof_name),
      owner_collected_type: clean(legacy.owner_collected_type),
      owner_collected_amount: numberOrNull(legacy.owner_collected_amount) || 0,
      utilities_cost_override: numberOrNull(legacy.utilities_cost_override),
      broker_name: clean(legacy.broker_name),
      broker_amount_per_night: numberOrNull(legacy.broker_amount_per_night),
      broker_total: numberOrNull(legacy.broker_total),
      is_hold: flag(legacy.is_hold) ? 1 : 0,
      hold_until: clean(legacy.hold_until),
      permit_contacted: flag(legacy.permit_contacted) ? 1 : 0,
      permit_sent: flag(legacy.permit_sent) ? 1 : 0,
      permit_feedback: flag(legacy.permit_feedback) ? 1 : 0,
      permit_feedback_note: clean(legacy.permit_feedback_note),
      permit_owner_notified: flag(legacy.permit_owner_notified) ? 1 : 0,
      external_source: SOURCE,
      external_uid: String(legacy.id),
      needs_details: flag(legacy.needs_details) ? 1 : 0,
      adults: flag(legacy.is_owner_reservation) ? 0 : 1,
      children: 0,
      nanny_count: 0,
    };

    if (apply) await insertDynamic('reservations', record, reservationColumns);
    stats.insertedReservations += 1;
  }

  const workbook = XLSX.readFile(files.availability, {
    cellDates: true,
  });
  const blockStats = {
    sheets: 0,
    markedCells: 0,
    matchedBlocks: 0,
    insertedBlocks: 0,
    existingBlocks: 0,
    skippedUnknownUnit: 0,
    skippedNoWpPostId: 0,
  };
  const unknownAvailabilityUnits = new Map();
  const noWpPostUnits = new Map();
  const seenBlocks = new Set();

  for (const sheetName of workbook.SheetNames.filter((name) =>
    /availabil/i.test(name)
  )) {
    blockStats.sheets += 1;
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: null,
      raw: false,
    });
    const headers = rows[0] || [];

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const date = isoDate(rows[rowIndex]?.[0]);
      if (!date) continue;

      for (let col = 1; col < headers.length; col += 1) {
        const marker = clean(rows[rowIndex]?.[col]);
        if (!marker) continue;
        blockStats.markedCells += 1;

        const header = clean(headers[col]);
        const unit = resolveCurrentUnit(header);
        if (!unit) {
          blockStats.skippedUnknownUnit += 1;
          const label = `${sheetName}: ${header || `column ${col + 1}`}`;
          unknownAvailabilityUnits.set(
            label,
            (unknownAvailabilityUnits.get(label) || 0) + 1
          );
          continue;
        }
        if (!unit.wp_post_id) {
          blockStats.skippedNoWpPostId += 1;
          noWpPostUnits.set(
            unit.unit_number || unit.title,
            (noWpPostUnits.get(unit.unit_number || unit.title) || 0) + 1
          );
          continue;
        }

        const key = `${unit.wp_post_id}|${date}`;
        if (seenBlocks.has(key)) continue;
        seenBlocks.add(key);
        blockStats.matchedBlocks += 1;

        const { rows: existing } = await query(
          `SELECT 1 FROM unit_blocked_dates WHERE wp_post_id = $1 AND date = $2::date`,
          [unit.wp_post_id, date]
        );
        if (existing[0]) {
          blockStats.existingBlocks += 1;
          continue;
        }
        if (apply) {
          await query(
            `INSERT INTO unit_blocked_dates (wp_post_id, date, source, updated_at)
             VALUES ($1, $2::date, $3, now())
             ON CONFLICT (wp_post_id, date) DO NOTHING`,
            [unit.wp_post_id, date, BLOCK_SOURCE]
          );
        }
        blockStats.insertedBlocks += 1;
      }
    }
  }

  function topEntries(map, limit = 30) {
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([label, count]) => ({ label, count }));
  }

  console.log('\nRESERVATIONS');
  console.log(stats);
  console.log('Skipped/missing units:', topEntries(missingUnits));
  console.log('Unmatched sales users:', topEntries(unmatchedSales));

  console.log('\nAVAILABILITY BLOCKS');
  console.log(blockStats);
  console.log('Unknown sheet units:', topEntries(unknownAvailabilityUnits));
  console.log('Units without wp_post_id:', topEntries(noWpPostUnits));

  console.log(
    apply
      ? '\nImport completed.'
      : '\nDry-run only. Re-run with --apply after reviewing these counts.'
  );

  if (apply) await query('COMMIT');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    if (transactionClient) {
      return transactionClient.query('ROLLBACK').catch(() => {});
    }
    return undefined;
  })
  .finally(async () => {
    transactionClient?.release();
    try {
      await pool.end();
    } catch (_) {
      /* ignore */
    }
  });
