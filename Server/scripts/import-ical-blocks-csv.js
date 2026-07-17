require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const CSV_PATH =
  process.argv[2] || path.join(process.env.USERPROFILE || '', 'Downloads', 'unit_ical_blocks_rows.csv');
const BATCH = 500;

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

function emptyToNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function toInt(v) {
  const s = emptyToNull(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

async function flushBatch(client, batch) {
  if (!batch.length) return 0;

  const values = [];
  const params = [];
  let p = 1;
  for (const row of batch) {
    values.push(`($${p++},$${p++},COALESCE($${p++}::timestamptz, now()))`);
    params.push(row.wp_post_id, row.date, row.updated_at);
  }

  await client.query(
    `INSERT INTO unit_ical_blocks (wp_post_id, date, updated_at)
     VALUES ${values.join(',')}
     ON CONFLICT (wp_post_id, date) DO UPDATE SET
       updated_at = COALESCE(EXCLUDED.updated_at, now())`,
    params
  );
  return batch.length;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`CSV not found: ${CSV_PATH}`);

  const matrix = parseCsv(fs.readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, ''));
  const headers = matrix[0].map((h) => h.trim());
  const records = matrix.slice(1).filter((r) => r.some((c) => String(c || '').trim()));

  console.log(`CSV rows: ${records.length}`);
  console.log(`Headers: ${headers.join(', ')}`);

  const client = await pool.connect();
  let upserted = 0;
  let skipped = 0;
  const errors = [];
  let batch = [];

  try {
    await client.query('BEGIN');

    for (let idx = 0; idx < records.length; idx++) {
      const cells = records[idx];
      const row = {};
      headers.forEach((h, i) => {
        row[h] = cells[i] != null ? cells[i] : '';
      });

      const wpPostId = toInt(row.wp_post_id);
      const date = emptyToNull(row.date);
      if (!wpPostId || !date) {
        skipped += 1;
        if (errors.length < 20) errors.push(`row ${idx + 2}: missing wp_post_id/date`);
        continue;
      }

      batch.push({
        wp_post_id: wpPostId,
        date,
        updated_at: emptyToNull(row.updated_at),
      });

      if (batch.length >= BATCH) {
        upserted += await flushBatch(client, batch);
        batch = [];
        if (upserted % 1000 === 0) console.log(`… ${upserted} upserted`);
      }
    }

    upserted += await flushBatch(client, batch);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS n FROM unit_ical_blocks`);
  const { rows: unitRows } = await pool.query(
    `SELECT COUNT(DISTINCT wp_post_id)::int AS units FROM unit_ical_blocks`
  );

  console.log(
    JSON.stringify(
      {
        upserted,
        skipped,
        totalBlocks: countRows[0].n,
        unitsWithBlocks: unitRows[0].units,
        errors,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
