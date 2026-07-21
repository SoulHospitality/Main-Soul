/**
 * Import legacy reservation date ranges as calendar blocks on existing DB units only.
 *
 * Usage:
 *   node scripts/import-csv-reservation-blocks.js              # dry-run
 *   node scripts/import-csv-reservation-blocks.js --apply      # write unit_blocked_dates
 *
 * Matching: CSV unit_number / name → units.unit_number (case-insensitive).
 * Never creates units. Skips checkout before 2026-07-21. Skips cancelled.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const UNITS_CSV =
  process.argv.find((a) => a.endsWith('.csv') && a.toLowerCase().includes('unit')) ||
  path.join(process.env.USERPROFILE || '', 'Downloads', 'units_rows (2).csv');
const RES_CSV =
  process.argv.find((a) => a.endsWith('.csv') && a.toLowerCase().includes('reservation')) ||
  path.join(process.env.USERPROFILE || '', 'Downloads', 'reservations_rows (1).csv');

const APPLY = process.argv.includes('--apply');
const CUTOFF = '2026-07-21';
const SOURCE = 'csv_import';
const BATCH = 400;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function rowsToObjects(matrix) {
  const headers = matrix[0].map((h) => String(h || '').trim());
  return matrix
    .slice(1)
    .filter((r) => r.some((c) => String(c || '').trim()))
    .map((cells) => {
      const o = {};
      headers.forEach((h, i) => {
        o[h] = cells[i] != null ? String(cells[i]) : '';
      });
      return o;
    });
}

function normCode(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/** Compact code for fuzzy match: no spaces/hyphens, optional CH segment dropped. */
function matchKeys(v) {
  let s = normCode(v).replace(/-/g, '');
  // Drop common project prefixes pasted into unit codes
  s = s.replace(/^(gaias?|foukabay|dbay|haciendawest|marassi|ilmontegalala)+/, '');
  const keys = new Set([s]);
  keys.add(s.replace(/ch/g, ''));
  return [...keys].filter(Boolean);
}

function toDateOnly(v) {
  const s = String(v || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function eachNight(checkIn, checkOut) {
  const dates = [];
  const start = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

async function flushBatch(client, batch) {
  if (!batch.length) return 0;
  const values = [];
  const params = [];
  let p = 1;
  for (const row of batch) {
    values.push(`($${p++}, $${p++}::date, $${p++}, now())`);
    params.push(row.wp_post_id, row.date, SOURCE);
  }
  await client.query(
    `INSERT INTO unit_blocked_dates (wp_post_id, date, source, updated_at)
     VALUES ${values.join(',')}
     ON CONFLICT (wp_post_id, date) DO UPDATE SET
       source = EXCLUDED.source,
       updated_at = now()`,
    params
  );
  return batch.length;
}

async function main() {
  if (!fs.existsSync(UNITS_CSV)) throw new Error(`Units CSV not found: ${UNITS_CSV}`);
  if (!fs.existsSync(RES_CSV)) throw new Error(`Reservations CSV not found: ${RES_CSV}`);

  const csvUnits = rowsToObjects(parseCsv(fs.readFileSync(UNITS_CSV, 'utf8').replace(/^\uFEFF/, '')));
  const csvRes = rowsToObjects(parseCsv(fs.readFileSync(RES_CSV, 'utf8').replace(/^\uFEFF/, '')));

  const csvUnitById = new Map();
  for (const u of csvUnits) {
    const id = String(u.id || '').trim();
    if (!id) continue;
    csvUnitById.set(id, {
      id,
      code: u.unit_number || u.name || '',
      project: u.project || '',
    });
  }

  const { rows: dbUnits } = await pool.query(
    `SELECT id, title, unit_number, compound, project, wp_post_id, status
     FROM units
     WHERE unit_number IS NOT NULL AND trim(unit_number) <> ''
       AND wp_post_id IS NOT NULL`
  );

  const dbByKey = new Map(); // match key → [units]
  const addDbKey = (key, unit) => {
    if (!key) return;
    if (!dbByKey.has(key)) dbByKey.set(key, []);
    const list = dbByKey.get(key);
    if (!list.some((u) => u.id === unit.id)) list.push(unit);
  };

  for (const u of dbUnits) {
    for (const key of matchKeys(u.unit_number)) addDbKey(key, u);
  }

  const resolveDbUnit = (csvCode) => {
    const candidates = new Map();
    for (const key of matchKeys(csvCode)) {
      for (const u of dbByKey.get(key) || []) candidates.set(u.id, u);
    }
    const list = [...candidates.values()];
    if (list.length === 1) return { unit: list[0], ambiguous: false };
    if (list.length > 1) return { unit: null, ambiguous: true };
    return { unit: null, ambiguous: false };
  };

  let skippedPastCheckout = 0;
  let skippedCancelled = 0;
  let skippedBadDates = 0;
  let skippedNoCsvUnit = 0;
  let skippedNoDbUnit = 0;
  let skippedAmbiguous = 0;
  let skippedEmptyStay = 0;

  const matched = [];
  const unmatchedCodes = new Map();

  for (const r of csvRes) {
    const status = String(r.status || '').trim().toLowerCase();
    if (status === 'cancelled') {
      skippedCancelled += 1;
      continue;
    }

    const checkIn = toDateOnly(r.check_in);
    const checkOut = toDateOnly(r.check_out);
    if (!checkIn || !checkOut || checkOut <= checkIn) {
      skippedBadDates += 1;
      continue;
    }
    if (checkOut < CUTOFF) {
      skippedPastCheckout += 1;
      continue;
    }

    const csvUnit = csvUnitById.get(String(r.unit_id || '').trim());
    if (!csvUnit) {
      skippedNoCsvUnit += 1;
      continue;
    }

    const { unit: dbUnit, ambiguous } = resolveDbUnit(csvUnit.code);
    if (ambiguous) {
      skippedAmbiguous += 1;
      unmatchedCodes.set(`${csvUnit.code} (ambiguous)`, (unmatchedCodes.get(`${csvUnit.code} (ambiguous)`) || 0) + 1);
      continue;
    }
    if (!dbUnit) {
      skippedNoDbUnit += 1;
      unmatchedCodes.set(csvUnit.code, (unmatchedCodes.get(csvUnit.code) || 0) + 1);
      continue;
    }
    const nights = eachNight(checkIn, checkOut);
    if (!nights.length) {
      skippedEmptyStay += 1;
      continue;
    }

    matched.push({
      reservationId: r.id,
      guest: r.guest_name,
      checkIn,
      checkOut,
      nights: nights.length,
      dates: nights,
      csvCode: csvUnit.code,
      csvProject: csvUnit.project,
      dbId: dbUnit.id,
      dbTitle: dbUnit.title,
      wp_post_id: dbUnit.wp_post_id,
    });
  }

  const blockKeys = new Set();
  const blocks = [];
  for (const m of matched) {
    for (const date of m.dates) {
      const k = `${m.wp_post_id}|${date}`;
      if (blockKeys.has(k)) continue;
      blockKeys.add(k);
      blocks.push({ wp_post_id: m.wp_post_id, date });
    }
  }

  const unmatchedList = [...unmatchedCodes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([code, n]) => ({ code, reservations: n }));

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? 'APPLY' : 'DRY_RUN',
        cutoff: `ignore checkout before ${CUTOFF}`,
        csvUnits: csvUnits.length,
        csvReservations: csvRes.length,
        dbUnitsWithCode: dbUnits.length,
        matchedReservations: matched.length,
        uniqueBlockNights: blocks.length,
        skippedPastCheckout,
        skippedCancelled,
        skippedBadDates,
        skippedNoCsvUnit,
        skippedNoDbUnit,
        skippedAmbiguous,
        skippedEmptyStay,
        sampleMatched: matched.slice(0, 8).map((m) => ({
          reservationId: m.reservationId,
          guest: m.guest,
          code: m.csvCode,
          checkIn: m.checkIn,
          checkOut: m.checkOut,
          nights: m.nights,
          dbTitle: m.dbTitle,
          wp_post_id: m.wp_post_id,
        })),
        unmatchedCsvCodesTop: unmatchedList,
      },
      null,
      2
    )
  );

  if (!APPLY) {
    console.log('\nDry-run only. Re-run with --apply to write unit_blocked_dates.');
    return;
  }

  const client = await pool.connect();
  let upserted = 0;
  try {
    await client.query('BEGIN');
    let batch = [];
    for (const row of blocks) {
      batch.push(row);
      if (batch.length >= BATCH) {
        upserted += await flushBatch(client, batch);
        batch = [];
      }
    }
    upserted += await flushBatch(client, batch);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const { rows: verify } = await pool.query(
    `SELECT count(*)::int AS n FROM unit_blocked_dates WHERE source = $1`,
    [SOURCE]
  );
  console.log(JSON.stringify({ upserted, csvImportBlocksInDb: verify[0].n }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
