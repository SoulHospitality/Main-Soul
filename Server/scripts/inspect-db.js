require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');

const useSsl =
  /supabase\.co|sslmode=require/i.test(process.env.DATABASE_URL || '') ||
  process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

(async () => {
  const cols = await pool.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'units'
     ORDER BY ordinal_position`
  );
  console.log('units columns (' + cols.rows.length + '):');
  console.log(cols.rows.map((r) => r.column_name).join(', ') || '(no units table)');

  const tables = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`
  );
  console.log('\ntables:', tables.rows.map((r) => r.tablename).join(', '));

  try {
    const m = await pool.query(`SELECT id FROM _schema_migrations ORDER BY id`);
    console.log('\nmigrations recorded:', m.rows.map((r) => r.id).join(', ') || '(none)');
  } catch (e) {
    console.log('\nmigrations table:', e.message);
  }

  await pool.end();
})().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
