require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query } = require('../src/config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../supabase/migrations/013_reviews_feature.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await query(sql);
  await query(
    `INSERT INTO public._schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING`,
    ['013_reviews_feature.sql']
  );
  const { rows } = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'units' AND column_name IN ('average_rating', 'review_count')
     ORDER BY column_name`
  );
  console.log('Migration applied. Columns:', rows.map((r) => r.column_name).join(', ') || '(none)');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
