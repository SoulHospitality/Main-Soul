require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const CSV_PATH = process.argv[2] || path.join(process.env.USERPROFILE || '', 'Downloads', 'listing_ical_rows.csv');

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

async function main() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`CSV not found: ${CSV_PATH}`);

  const matrix = parseCsv(fs.readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, ''));
  const headers = matrix[0].map((h) => h.trim());
  const records = matrix.slice(1).filter((r) => r.some((c) => String(c || '').trim()));

  const { rows: colRows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'listing_ical'`
  );
  const dbCols = new Set(colRows.map((r) => r.column_name));
  const ignored = headers.filter((h) => h && !dbCols.has(h));
  console.log(`CSV rows: ${records.length}`);
  console.log(`DB columns: ${[...dbCols].join(', ')}`);
  console.log(`Ignored CSV columns: ${ignored.join(', ') || '(none)'}`);

  let upserted = 0;
  let skipped = 0;
  const errors = [];

  for (let idx = 0; idx < records.length; idx++) {
    const cells = records[idx];
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] != null ? cells[i] : '';
    });

    const wordpressPostId = toInt(row.wordpress_post_id);
    const icalUrl = emptyToNull(row.ical_url);
    if (!wordpressPostId || !icalUrl) {
      skipped += 1;
      errors.push(`row ${idx + 2}: missing wordpress_post_id or ical_url`);
      continue;
    }

    try {
      await pool.query(
        `INSERT INTO listing_ical (wordpress_post_id, listing_slug, ical_url, sheet_code, notes, updated_at)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now()))
         ON CONFLICT (wordpress_post_id) DO UPDATE SET
           listing_slug = EXCLUDED.listing_slug,
           ical_url = EXCLUDED.ical_url,
           sheet_code = COALESCE(EXCLUDED.sheet_code, listing_ical.sheet_code),
           notes = COALESCE(EXCLUDED.notes, listing_ical.notes),
           updated_at = COALESCE(EXCLUDED.updated_at, now())`,
        [
          wordpressPostId,
          emptyToNull(row.listing_slug),
          icalUrl,
          emptyToNull(row.sheet_code),
          emptyToNull(row.notes),
          emptyToNull(row.updated_at),
        ]
      );
      upserted += 1;
    } catch (err) {
      skipped += 1;
      errors.push(`row ${idx + 2} (${wordpressPostId}): ${err.message}`);
    }
  }

  // Also sync ical_url onto matching units when possible
  const sync = await pool.query(
    `UPDATE units u
     SET ical_url = li.ical_url, updated_at = now()
     FROM listing_ical li
     WHERE u.wp_post_id = li.wordpress_post_id
       AND (u.ical_url IS DISTINCT FROM li.ical_url)`
  );

  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS n FROM listing_ical`);
  console.log(
    JSON.stringify(
      {
        upserted,
        skipped,
        unitsIcalSynced: sync.rowCount,
        totalListingIcal: countRows[0].n,
        errors: errors.slice(0, 20),
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
