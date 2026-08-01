require('dotenv').config({ path: require('path').join(__dirname, '../.env.old-pms') });
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Client } = require('pg');

async function cols(url, label, tables) {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log('===' + label + '===');
  for (const t of tables) {
    try {
      const r = await c.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1
         ORDER BY ordinal_position`,
        [t]
      );
      if (!r.rows.length) console.log(t + ': (no table)');
      else console.log(t + ': ' + r.rows.map((x) => x.column_name).join(', '));
    } catch (e) {
      console.log(t + ': ERR ' + e.message);
    }
  }
  await c.end();
}

(async () => {
  const tables = [
    'reservations',
    'payments',
    'expenses',
    'commissions',
    'units',
    'users',
    'staff_users',
    'petty_cash',
    'petty_cash_settings',
    'daily_prices',
    'owner_units',
  ];
  await cols(process.env.OLD_PMS_DATABASE_URL, 'OLD', tables);
  await cols(process.env.DATABASE_URL, 'NEW', tables);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
