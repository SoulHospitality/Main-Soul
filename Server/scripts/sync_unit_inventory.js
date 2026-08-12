require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query, pool } = require('../src/config/db');

/** Canonical inventory from ops (project label as provided). */
const WANTED = [
  ['Fouka Bay', 'ST3-V20'],
  ['Fouka Bay', 'CL8-V8'],
  ['Fouka Bay', 'CL8-V9'],
  ['Fouka Bay', 'CL8-V11'],
  ['Fouka Bay', 'F1-V20'],
  ['Fouka Bay', 'SA-6B-G03'],
  ['Fouka Bay', 'SA-2B-01'],
  ['Fouka Bay', 'SA-2B-B03'],
  ['Fouka Bay', 'SA-3A-B01'],
  ['Fouka Bay', 'SA-3A-B02'],
  ['Fouka Bay', 'SA-8A-201'],
  ['Fouka Bay', 'SA-8B-203'],
  ['Fouka Bay', 'SA-8A-203'],
  ['Fouka Bay', 'SA-9B-G01'],
  ['Fouka Bay', 'SA-4B-102'],
  ['Fouka Bay', 'SA-4A-103'],
  ['Fouka Bay', 'SA-4B-104'],
  ['Fouka Bay', 'SA-1B-05'],
  ['Fouka Bay', 'ST5-CH79-01-01'],
  ['Fouka Bay', 'ST5-CH85-G01'],
  ['Fouka Bay', 'ST5-CH94-G02'],
  ['Fouka Bay', 'ST5-CH86-01-02'],
  ['Fouka Bay', 'ST5-CH86-01-01'],
  ['Fouka Bay', 'ST5-CH89-01-01'],
  ['Fouka Bay', 'ST5-CH89-02-02'],
  ['Fouka Bay', 'ST5-87-01-02'],
  ['Fouka Bay', 'ST5-93-02-02'],
  ['Fouka Bay', 'ST5-49-01-01'],
  ['Fouka Bay', 'CL1-TH11'],
  ['Fouka Bay', 'CL1-CH37-01'],
  ['Fouka Bay', 'CL1-CH34-02'],
  ['Fouka Bay', 'CL1-TW42-03'],
  ['Fouka Bay', 'CL2-CH8-01'],
  ['Fouka Bay', 'CL3-CH27-G01'],
  ['Fouka Bay', 'CL3-CH26-G01'],
  ['Fouka Bay', 'CL3-TW4-AF'],
  ['Fouka Bay', 'CL4-CH19-G01'],
  ['Fouka Bay', 'CL4-19-02'],
  ['Fouka Bay', 'CL4-20-G01'],
  ['Fouka Bay', 'CL4-CH16-02'],
  ['Fouka Bay', 'CL4-CH16-03'],
  ['Fouka Bay', 'CL4-CH29-02'],
  ['Fouka Bay', 'CL4-CH34-G01'],
  ['Fouka Bay', 'CL4-CH31-03'],
  ['Fouka Bay', 'CL11-CH8-AG'],
  ['Fouka Bay', 'CL11-CH8-02'],
  ['Fouka Bay', 'CL11-CH9B-02'],
  ['Fouka Bay', 'CL11-CH13-AG'],
  ['Fouka Bay', 'CL11-CH13A-02'],
  ['Fouka Bay', 'CL11-CH13A-03'],
  ['Fouka Bay', 'CL11-CH15A-03'],
  ['Fouka Bay', 'CL11-16B-02'],
  ['Fouka Bay', 'CL11-CH16-03'],
  ['Fouka Bay', 'CL11-CH17-AG'],
  ['Fouka Bay', 'CL11-18B-G'],
  ['Fouka Bay', 'CL11-CH20A-01'],
  ['Fouka Bay', 'CL11-CH21B-G'],
  ['Fouka Bay', 'CL10-11A-G'],
  ['Fouka Bay', 'CL10-CH11B-02'],
  ['Fouka Bay', 'CL10-CH12B-03'],
  ['Fouka Bay', 'CL10-CH14-AG'],
  ['Fouka Bay', 'CL10-CH13B-02'],
  ['Fouka Bay', 'CL10-CH15A-03'],
  ['Fouka Bay', 'CL10-21B-03'],
  ['Fouka Bay', 'CL10-CH22A-03'],
  ['Fouka Bay', 'CL9-CH24-02'],
  ['Fouka Bay', 'CL9-CH17-02'],
  ['Fouka Bay', 'CL7-CH18-02'],
  ['Fouka Bay', 'CL7-CH18-01'],
  ['Fouka Bay', 'CL7-CH3-01'],
  ['Fouka Bay', 'CL7-CH13-G01'],
  ['D-Bay', 'B1-SC-12D'],
  ['D-Bay', 'B1-SC-12C'],
  ['D-Bay', 'B1-C2B'],
  ['Gaia', 'Gaia Z-106'],
  ['Gaia', 'Z-2202'],
  ['Gaia', 'Z27-4'],
  ['Gaia', 'Z29-1'],
  ['Gaia', 'A-72-4'],
  ['Gaia', 'A-61-4'],
  ['Gaia', 'A-27-6'],
  ['Gaia', 'B-65'],
  ['Gaia', 'R-16-3'],
  ['Hacienda West', 'WST-JCH-154AF-S'],
  ['Hacienda West', 'WST-HAZ-3614'],
  ['Hacienda West', 'WST-HAZEL-3223'],
  ['Hacienda West', 'WST-CAB-L240'],
  ['Hacienda West', 'WST-HAZ-3613'],
  ['Hacienda West', 'WST-HAZ-2803'],
  ['Hacienda West', 'WST-CAB-B21D'],
  ['Il Monte Galala', 'B2-CH40-01-04'],
  ['Il Monte Galala', 'B3-CH75-G01'],
  ['Il Monte Galala', 'B3-CH84-02-01'],
  ['Il Monte Galala', 'C2-CH19-G01'],
  ['Il Monte Galala', 'C1-CH20-02-02'],
  ['Il Monte Galala', 'C2-CH28-02-01'],
  ['Il Monte Galala', 'C3-CH1-01-01'],
  ['Il Monte Galala', 'CH24-G01'],
  ['Il Monte Galala', 'C2-CH34-01-01'],
  ['Il Monte Galala', 'B3-CH18-G01'],
  ['Il Monte Galala', 'B3-CH75-02-02'],
  ['Il Monte Galala', 'B1-CH20-02-04'],
  ['Il Monte Galala', 'TH-213'],
  ['Il Monte Galala', 'C2-CH29-G02'],
  ['Il Monte Galala', 'C2-CH26-01-03'],
  ['Il Monte Galala', 'B2-CH5-G02'],
];

/** Map user-facing project names to DB project/compound values. */
const PROJECT_DB = {
  'Fouka Bay': 'Fouka Bay',
  'D-Bay': 'D-Bay',
  Gaia: 'GAIA',
  'Hacienda West': 'Hacienda West',
  'Il Monte Galala': 'IL Monte Galala',
};

function normCode(s) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '-');
}

function dense(s) {
  return normCode(s).replace(/[^A-Z0-9]/g, '');
}

async function main() {
  const dry = !process.argv.includes('--apply');

  const { rows: existing } = await query(`
    SELECT id, unit_number, project, compound, status, wp_post_id, title,
           (SELECT count(*)::int FROM reservations r WHERE r.unit_id = u.id AND r.status <> 'cancelled') AS active_res,
           (SELECT count(*)::int FROM bookings b WHERE b.unit_id = u.id) AS bookings
    FROM units u
    ORDER BY project, unit_number
  `);

  const wantedKeys = new Map();
  for (const [projLabel, code] of WANTED) {
    const dbProject = PROJECT_DB[projLabel] || projLabel;
    const key = `${dbProject}||${normCode(code)}`;
    wantedKeys.set(key, { projLabel, dbProject, code: code.trim() });
  }

  // Match existing by dense unit_number primarily (project soft-match)
  const byDense = new Map();
  for (const u of existing) {
    const d = dense(u.unit_number);
    if (!d) continue;
    if (!byDense.has(d)) byDense.set(d, []);
    byDense.get(d).push(u);
  }

  const matchedExistingIds = new Set();
  const missing = [];
  const matched = [];

  for (const w of wantedKeys.values()) {
    const d = dense(w.code);
    const candidates = byDense.get(d) || [];
    // Prefer same project, else any
    let hit =
      candidates.find(
        (u) =>
          String(u.project || '').toLowerCase() === w.dbProject.toLowerCase() ||
          String(u.compound || '').toLowerCase() === w.dbProject.toLowerCase()
      ) || candidates[0];
    if (hit) {
      matchedExistingIds.add(hit.id);
      matched.push({ wanted: w, unit: hit });
    } else {
      missing.push(w);
    }
  }

  const extras = existing.filter((u) => !matchedExistingIds.has(u.id));

  console.log(`wanted=${wantedKeys.size} existing=${existing.length}`);
  console.log(`matched=${matched.length} missing=${missing.length} extras=${extras.length}`);
  console.log('\nMISSING:');
  for (const m of missing) console.log(`  + ${m.dbProject} | ${m.code}`);
  console.log('\nEXTRAS:');
  for (const u of extras) {
    console.log(
      `  - ${u.project} | ${u.unit_number} status=${u.status} res=${u.active_res} bookings=${u.bookings} id=${u.id}`
    );
  }

  // Project name mismatches among matched
  const rename = matched.filter(
    (m) =>
      String(m.unit.project || '') !== m.wanted.dbProject ||
      String(m.unit.unit_number || '').trim() !== m.wanted.code
  );
  if (rename.length) {
    console.log('\nNORMALIZE (project/code):');
    for (const m of rename) {
      console.log(
        `  ~ ${m.unit.project}|${m.unit.unit_number} -> ${m.wanted.dbProject}|${m.wanted.code}`
      );
    }
  }

  if (dry) {
    console.log('\nDry run only. Re-run with --apply to add missing and delete extras.');
    return;
  }

  // Next wp_post_id
  const { rows: maxWp } = await query(
    `SELECT COALESCE(MAX(wp_post_id), 1000000)::int AS m FROM units`
  );
  let nextWp = Math.max(1000001, (maxWp[0].m || 1000000) + 1);

  for (const m of missing) {
    const slugBase = `${m.dbProject}-${m.code}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    let slug = slugBase;
    let i = 1;
    while (true) {
      const { rows } = await query(`SELECT 1 FROM units WHERE slug = $1`, [slug]);
      if (!rows.length) break;
      slug = `${slugBase}-${i++}`;
    }
    const title = `${m.code} | ${m.dbProject}`;
    const { rows: inserted } = await query(
      `INSERT INTO units (
         slug, title, status, source, compound, area, beds, baths, guests,
         photo_urls, amenities, facilities, price_currency, pricing_model,
         featured, consecutive_scrape_failures, consecutive_missing_from_discovery,
         average_rating, review_count, is_comparable, listing_type, has_nanny_room,
         unit_number, project, wp_post_id, created_at, updated_at
       ) VALUES (
         $1,$2,'draft','manual',$3,$3,0,0,0,
         '{}','{}','{}','EGP','nightly',
         false,0,0,
         0,0,false,'rent',false,
         $4,$3,$5,now(),now()
       )
       RETURNING id, unit_number, project, wp_post_id`,
      [slug, title, m.dbProject, m.code, nextWp++]
    );
    console.log('ADDED', inserted[0]);
  }

  // Normalize matched project/code
  for (const m of rename) {
    await query(
      `UPDATE units SET
         project = $1,
         compound = $1,
         unit_number = $2,
         updated_at = now()
       WHERE id = $3`,
      [m.wanted.dbProject, m.wanted.code, m.unit.id]
    );
    console.log('NORMALIZED', m.wanted.dbProject, m.wanted.code);
  }

  // Delete extras carefully
  for (const u of extras) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Clear soft FKs
      await client.query(`UPDATE bookings SET unit_id = NULL WHERE unit_id = $1`, [u.id]).catch(() => {});
      // bookings may NOT allow null - check
      await client.query(`DELETE FROM owner_units WHERE unit_id = $1`, [u.id]);
      await client.query(`DELETE FROM unit_blocked_dates WHERE wp_post_id = $1`, [u.wp_post_id]).catch(() => {});
      await client.query(`DELETE FROM unit_daily_prices WHERE wp_post_id = $1`, [u.wp_post_id]).catch(() => {});
      await client.query(`DELETE FROM unit_ical_blocks WHERE wp_post_id = $1`, [u.wp_post_id]).catch(() => {});
      // Null reservations rather than delete history
      await client.query(`UPDATE reservations SET unit_id = NULL WHERE unit_id = $1`, [u.id]);
      await client.query(`DELETE FROM units WHERE id = $1`, [u.id]);
      await client.query('COMMIT');
      console.log('DELETED', u.project, u.unit_number, u.id);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('DELETE FAILED', u.unit_number, err.message);
      // Fallback: archive
      await query(
        `UPDATE units SET status = 'archived', updated_at = now() WHERE id = $1`,
        [u.id]
      );
      console.log('ARCHIVED instead', u.unit_number);
    } finally {
      client.release();
    }
  }

  const { rows: after } = await query(`SELECT count(*)::int AS n FROM units`);
  console.log('DONE units_count=', after[0].n);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
