/**
 * Sync Hacienda West unit beach access fees:
 * studio → 10000, else → 12000 (flat; not per person).
 */
require('dotenv').config();
const { query, pool } = require('../src/config/db');
const { isStudioUnit, HACIENDA_WEST_BEACH } = require('../src/lib/beachAccess');

(async () => {
  const { rows } = await query(`
    SELECT id, unit_number, property_type, beds, project, compound,
           access_fee_per_adult_egp, access_fee_per_teen_egp
    FROM units
    WHERE COALESCE(listing_type, 'rent') = 'rent'
      AND (
        COALESCE(project, '') ILIKE '%hacienda%west%'
        OR COALESCE(compound, '') ILIKE '%hacienda%west%'
      )
  `);

  let updated = 0;
  for (const u of rows) {
    const flat = isStudioUnit(u) ? HACIENDA_WEST_BEACH.studio : HACIENDA_WEST_BEACH.other;
    if (
      Number(u.access_fee_per_adult_egp) === flat &&
      Number(u.access_fee_per_teen_egp || 0) === 0
    ) {
      continue;
    }
    await query(
      `UPDATE units SET
         access_fee_per_adult_egp = $2,
         access_fee_per_teen_egp = 0,
         access_card_count_included = COALESCE(access_card_count_included, 7),
         updated_at = now()
       WHERE id = $1`,
      [u.id, flat]
    );
    updated += 1;
    console.log(
      `${u.unit_number || u.id} (${u.property_type || 'n/a'}, beds=${u.beds}) → ${flat}`
    );
  }

  console.log(JSON.stringify({ total: rows.length, updated }, null, 2));
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
