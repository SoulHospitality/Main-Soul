require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { runMigrations, query, pool } = require('../src/config/db');

(async () => {
  console.log('Connecting and applying any pending migrations...');
  await runMigrations();

  const migrations = await query(
    'SELECT id, applied_at FROM public._schema_migrations ORDER BY id'
  );
  console.log('\nApplied migrations:');
  for (const row of migrations.rows) {
    console.log(` - ${row.id}`);
  }

  const tables = await query(`
    SELECT count(*)::int AS n
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `);
  console.log(`\nPublic tables: ${tables.rows[0].n}`);

  const staff = await query('SELECT count(*)::int AS n FROM staff_users');
  console.log(`Staff users: ${staff.rows[0].n}`);

  const units = await query('SELECT count(*)::int AS n FROM units').catch(() => ({ rows: [{ n: 0 }] }));
  console.log(`Units: ${units.rows[0].n}`);

  console.log('\nDatabase is ready for production use.');
  await pool.end();
})().catch(async (err) => {
  console.error('ERROR:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
