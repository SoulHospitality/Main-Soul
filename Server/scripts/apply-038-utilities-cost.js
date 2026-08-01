/**
 * Apply expenses.category = utilities_cost (actual utilities for P&L).
 * Safe to re-run.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../supabase/migrations/038_expense_utilities_cost.sql'),
    'utf8'
  );
  const c = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  await c.query(sql);
  console.log('applied 038_expense_utilities_cost');
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
