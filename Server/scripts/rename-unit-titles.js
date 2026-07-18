/**
 * Rename guest-facing unit titles and normalize Fouka Bay.
 * Example: "3BR + 2BT Fouka Bay lagoon view Apartment"
 *
 * Usage: set DATABASE_URL=... && node scripts/rename-unit-titles.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');

const url = String(process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/gi, '').replace(/\?$/, '');
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

function normalizeProject(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'Coastal';
  if (/^fouka\s*bay$/i.test(s)) return 'Fouka Bay';
  return s;
}

function normalizeView(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // "Pool view + Sea view" → keep readable, lowercase for flowing title
  return s
    .split(/\s*\+\s*/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join(' + ');
}

function normalizeType(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'Home';
  // Keep type capitalization (Apartment, Chalet, Villa…)
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function buildTitle({ beds, baths, project, view, property_type }) {
  const br = Math.max(0, Number(beds) || 0);
  const bt = Math.max(0, Number(baths) || 0);
  const place = normalizeProject(project);
  const viewPart = normalizeView(view);
  const type = normalizeType(property_type);
  const parts = [`${br}BR + ${bt}BT`, place];
  if (viewPart) parts.push(viewPart);
  parts.push(type);
  return parts.join(' ');
}

async function main() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, title, unit_number, project, compound, beds, baths, view, property_type
       FROM public.units`
    );
    console.log(`[rename] ${rows.length} units`);

    await client.query('BEGIN');

    // Normalize Fouka Bay spelling on project/compound first
    await client.query(`
      UPDATE public.units
      SET project = 'Fouka Bay',
          compound = 'Fouka Bay',
          updated_at = now()
      WHERE lower(trim(coalesce(project, ''))) = 'fouka bay'
         OR lower(trim(coalesce(compound, ''))) = 'fouka bay'
    `);

    let updated = 0;
    for (const u of rows) {
      const project = normalizeProject(u.project || u.compound);
      const title = buildTitle({
        beds: u.beds,
        baths: u.baths,
        project,
        view: u.view,
        property_type: u.property_type,
      });
      await client.query(
        `UPDATE public.units
         SET title = $1,
             project = $2,
             compound = $2,
             updated_at = now()
         WHERE id = $3`,
        [title, project, u.id]
      );
      updated += 1;
    }

    await client.query('COMMIT');

    const { rows: sample } = await client.query(`
      SELECT title, unit_number, project, beds, baths, view, property_type
      FROM public.units
      ORDER BY project, beds DESC, title
      LIMIT 12
    `);
    const { rows: fouka } = await client.query(`
      SELECT count(*)::int AS c FROM public.units
      WHERE project = 'Fouka Bay' OR compound = 'Fouka Bay'
    `);
    console.log(`[rename] updated ${updated}`);
    console.log(`[rename] Fouka Bay units: ${fouka[0].c}`);
    console.log('[rename] sample:', sample);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[rename] FAILED:', err.message);
  process.exit(1);
});
