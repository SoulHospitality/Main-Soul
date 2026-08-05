/**
 * Backfill reservations.sales_person_id from sales_label by fuzzy-matching
 * staff full names (typo-tolerant). Skips Owner labels and ambiguous matches.
 *
 * Usage: node scripts/backfill-sales-person-ids.js [--dry-run]
 */
require('dotenv').config();
const { query, pool } = require('../src/config/db');
const { matchSalesLabelToStaff } = require('../src/lib/salesNameMatch');

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const { rows: staff } = await query(
    `SELECT id, full_name, role
     FROM staff_users
     WHERE is_active = 1
       AND full_name IS NOT NULL
       AND btrim(full_name) <> ''
       AND role IN ('reservations', 'reservations_web', 'reservations_manual', 'admin', 'sales')`
  );
  console.log(`Staff candidates: ${staff.length}`);

  const { rows: reservations } = await query(
    `SELECT id, sales_label, sales_person_id, guest_name
     FROM reservations
     WHERE sales_label IS NOT NULL
       AND btrim(sales_label) <> ''
       AND lower(btrim(sales_label)) NOT IN ('owner')
       AND sales_person_id IS NULL`
  );
  console.log(`Unassigned reservations with sales_label: ${reservations.length}`);

  let linked = 0;
  let skipped = 0;
  const byAgent = new Map();

  for (const r of reservations) {
    const match = matchSalesLabelToStaff(r.sales_label, staff);
    if (!match) {
      skipped += 1;
      continue;
    }
    const agentName = match.staff.full_name;
    byAgent.set(agentName, (byAgent.get(agentName) || 0) + 1);
    if (!dryRun) {
      await query(
        `UPDATE reservations
         SET sales_person_id = $1, updated_at = now()
         WHERE id = $2 AND sales_person_id IS NULL`,
        [match.staff.id, r.id]
      );
    }
    linked += 1;
    if (linked <= 25 || linked % 50 === 0) {
      console.log(
        `${dryRun ? '[dry] ' : ''}#${r.id} "${r.sales_label}" → ${agentName} (score ${match.score.toFixed(2)})`
      );
    }
  }

  console.log('\nSummary');
  console.log(`  linked:  ${linked}${dryRun ? ' (dry-run, not written)' : ''}`);
  console.log(`  skipped: ${skipped} (no confident match)`);
  console.log('  by agent:');
  for (const [name, count] of [...byAgent.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${name}: ${count}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (_) {
      /* ignore */
    }
  });
