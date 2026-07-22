require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const APPLY = process.argv.includes('--apply');

(async () => {
  const before = await pool.query(`
    SELECT
      count(*)::int AS n,
      min(price)::float AS min_p,
      max(price)::float AS max_p,
      count(*) FILTER (WHERE price > 9000)::int AS over9k,
      count(*) FILTER (WHERE price > 0 AND price <= 9000)::int AS under_eq9k,
      count(*) FILTER (WHERE COALESCE(price, 0) <= 0)::int AS zero_or_null
    FROM unit_daily_prices
  `);
  console.log('before', before.rows[0]);

  const preview = await pool.query(`
    SELECT
      price::float AS old_price,
      CASE
        WHEN price > 9000 THEN price - 1000
        WHEN price > 0 AND price <= 9000 THEN price - 500
        ELSE price
      END::float AS new_price,
      count(*)::int AS nights
    FROM unit_daily_prices
    WHERE price > 0
    GROUP BY 1, 2
    ORDER BY old_price DESC
    LIMIT 15
  `);
  console.log('sample transformations', preview.rows);

  if (!APPLY) {
    console.log('\nDry-run only. Re-run with --apply to update unit_daily_prices.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE unit_daily_prices
      SET
        price = CASE
          WHEN price > 9000 THEN price - 1000
          WHEN price > 0 AND price <= 9000 THEN GREATEST(price - 500, 0)
          ELSE price
        END,
        updated_at = now()
      WHERE price > 0
      RETURNING wp_post_id, date::text AS date, price
    `);
    await client.query('COMMIT');

    const after = await pool.query(`
      SELECT
        count(*)::int AS n,
        min(price)::float AS min_p,
        max(price)::float AS max_p,
        count(*) FILTER (WHERE price > 9000)::int AS over9k,
        count(*) FILTER (WHERE price > 0 AND price <= 9000)::int AS under_eq9k
      FROM unit_daily_prices
    `);

    console.log(
      JSON.stringify(
        {
          updatedRows: result.rowCount,
          after: after.rows[0],
          sampleUpdated: result.rows.slice(0, 8),
        },
        null,
        2
      )
    );
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
