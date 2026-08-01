require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Client } = require('pg');

(async () => {
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  const a = await c.query(`
    SELECT pid, state, wait_event_type,
           left(query, 120) AS q,
           now() - xact_start AS xact_age
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
    ORDER BY xact_start NULLS LAST
  `);
  console.log(JSON.stringify(a.rows, null, 2));
  for (const r of a.rows) {
    if (r.state === 'idle in transaction' || r.state === 'active') {
      const t = await c.query(`SELECT pg_terminate_backend($1) AS ok`, [r.pid]);
      console.log('terminate', r.pid, r.state, t.rows[0].ok);
    }
  }
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
