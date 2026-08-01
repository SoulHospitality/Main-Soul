require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const cols = await c.query(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='unit_daily_prices' ORDER BY ordinal_position`
  );
  console.log(cols.rows);
  const cons = await c.query(
    `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.unit_daily_prices'::regclass`
  );
  console.log(cons.rows);
  const src = await c.query(
    `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.units'::regclass AND contype='c'`
  );
  console.log('units checks', src.rows);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
