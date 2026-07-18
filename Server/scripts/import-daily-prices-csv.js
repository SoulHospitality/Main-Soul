/**
 * Import daily_prices CSV → unit_daily_prices via units.source_code → wp_post_id.
 * Then promotes draft units that gained prices to published.
 *
 * Usage:
 *   set DATABASE_URL=...
 *   set DAILY_PRICES_CSV=path\to\daily_prices.csv
 *   node scripts/import-daily-prices-csv.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');

const url = String(process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/gi, '').replace(/\?$/, '');
const csvPath =
  process.env.DAILY_PRICES_CSV ||
  path.join(process.env.USERPROFILE || '', 'Downloads', 'daily_prices_rows.csv');

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
  max: 2,
});

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

async function main() {
  console.log('[import] reading CSV…');
  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    trim: true,
  });
  console.log(`[import] ${rows.length} CSV rows`);

  const client = await pool.connect();
  try {
    const { rows: units } = await client.query(
      `SELECT source_code, wp_post_id FROM public.units
       WHERE source_code IS NOT NULL AND wp_post_id IS NOT NULL`
    );
    const wpByCsvUnit = new Map(units.map((u) => [String(u.source_code), Number(u.wp_post_id)]));
    console.log(`[import] unit map size: ${wpByCsvUnit.size}`);

    const prepared = [];
    const missingUnits = new Set();
    let skippedPrice = 0;

    for (const row of rows) {
      const csvUnitId = String(row.unit_id || '').trim();
      const wp = wpByCsvUnit.get(csvUnitId);
      if (!wp) {
        missingUnits.add(csvUnitId);
        continue;
      }
      const price = num(row.price);
      if (price == null || price <= 0) {
        skippedPrice += 1;
        continue;
      }
      const date = String(row.date || '').trim();
      if (!date) continue;
      const updatedAt = String(row.updated_at || row.created_at || '').trim() || null;
      prepared.push({ wp, date, price: Math.round(price), updatedAt });
    }

    console.log(
      `[import] ready ${prepared.length}; skip no-unit=${missingUnits.size} unit_ids, skip bad-price=${skippedPrice}`
    );
    if (missingUnits.size) {
      console.log(
        `[import] missing unit_ids: ${[...missingUnits].slice(0, 20).join(', ')}${
          missingUnits.size > 20 ? '…' : ''
        }`
      );
    }

    await client.query('BEGIN');
    // Replace existing daily prices for these wp_post_ids to avoid stale rows
    const wpIds = [...new Set(prepared.map((p) => p.wp))];
    if (wpIds.length) {
      await client.query(`DELETE FROM public.unit_daily_prices WHERE wp_post_id = ANY($1::bigint[])`, [
        wpIds,
      ]);
    }

    const batchSize = 500;
    let inserted = 0;
    for (let i = 0; i < prepared.length; i += batchSize) {
      const batch = prepared.slice(i, i + batchSize);
      const params = [];
      const values = [];
      let p = 1;
      for (const row of batch) {
        values.push(`($${p++}, $${p++}::date, $${p++}, 'EGP', 'csv_import', COALESCE($${p++}::timestamptz, now()))`);
        params.push(row.wp, row.date, row.price, row.updatedAt);
      }
      await client.query(
        `INSERT INTO public.unit_daily_prices (wp_post_id, date, price, currency, source, updated_at)
         VALUES ${values.join(',')}
         ON CONFLICT (wp_post_id, date) DO UPDATE SET
           price = EXCLUDED.price,
           currency = EXCLUDED.currency,
           source = EXCLUDED.source,
           updated_at = EXCLUDED.updated_at`,
        params
      );
      inserted += batch.length;
      if (inserted % 2000 === 0 || inserted === prepared.length) {
        console.log(`[import] upserted ${inserted}/${prepared.length}`);
      }
    }

    // Publish drafts that now have daily prices (or already have price_fallback)
    const { rowCount: published } = await client.query(`
      UPDATE public.units u
      SET status = 'published', updated_at = now()
      WHERE u.status = 'draft'
        AND (
          COALESCE(u.price_fallback, 0) > 0
          OR EXISTS (
            SELECT 1 FROM public.unit_daily_prices d
            WHERE d.wp_post_id = u.wp_post_id AND d.price > 0
          )
        )
    `);

    await client.query('COMMIT');

    const { rows: verify } = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.unit_daily_prices) AS prices,
        (SELECT count(*)::int FROM public.units WHERE status = 'published') AS published_units,
        (SELECT count(*)::int FROM public.units WHERE status = 'draft') AS draft_units
    `);
    console.log(`[import] done — rows upserted=${inserted}, units promoted to published=${published}`);
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
