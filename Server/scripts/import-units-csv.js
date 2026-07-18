/**
 * Import units from Soul PMS CSV export into public.units.
 * Stores CSV integer id in source_code for later reservation linking.
 *
 * Usage:
 *   set DATABASE_URL=...
 *   set UNITS_CSV=path\to\units.csv
 *   node scripts/import-units-csv.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');

const url = String(process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/gi, '').replace(/\?$/, '');
const csvPath =
  process.env.UNITS_CSV ||
  path.join(process.env.USERPROFILE || '', 'Downloads', 'units_rows (1).csv');

if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
if (!fs.existsSync(csvPath)) {
  console.error('CSV not found:', csvPath);
  process.exit(1);
}

const pool = new Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

function slugify(raw, fallback) {
  const base = String(raw || fallback || 'unit')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || `unit-${fallback}`;
}

function areaFor(project) {
  const p = String(project || '').toLowerCase();
  if (/sokhna|galala|red\s*sea/.test(p)) return 'Ain Sokhna';
  return 'North Coast';
}

function parseAmenities(raw) {
  const s = String(raw || '').trim();
  if (!s || s === '[]') return [];
  try {
    const j = JSON.parse(s);
    if (Array.isArray(j)) return j.map(String).filter(Boolean);
  } catch {
    /* ignore */
  }
  return s
    .split(/[,;|]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function num(v, fallback = null) {
  if (v === '' || v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function mapOpsStatus(raw) {
  const s = String(raw || 'available').toLowerCase();
  if (['available', 'occupied', 'maintenance'].includes(s)) return s;
  return 'available';
}

async function main() {
  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    trim: true,
  });
  console.log(`[import] ${rows.length} rows from ${csvPath}`);

  const client = await pool.connect();
  try {
    const staffIds = new Set(
      (await client.query('SELECT id FROM public.staff_users')).rows.map((r) => r.id)
    );

    await client.query('BEGIN');
    const usedSlugs = new Set();
    let inserted = 0;

    for (const row of rows) {
      const csvId = String(row.id || '').trim();
      const title = String(row.name || row.unit_number || `Unit ${csvId}`).trim();
      const unitNumber = String(row.unit_number || '').trim() || null;
      const project = String(row.project || '').trim() || 'Unknown';
      let slug = slugify(unitNumber || title, csvId);
      if (usedSlugs.has(slug)) slug = `${slug}-${csvId}`;
      usedSlugs.add(slug);

      const beds = Math.max(0, Math.trunc(num(row.bedrooms, 0)));
      const baths = Math.max(0, Math.trunc(num(row.bathrooms, 0)));
      const guests = Math.max(beds * 2 || 2, 1);
      const priceFallback = num(row.price_per_night, null);
      const hasPrice = priceFallback != null && priceFallback > 0;
      const guestStatus = hasPrice ? 'published' : 'draft';

      const createdBy = num(row.created_by, null);
      const createdByStaff = createdBy != null && staffIds.has(createdBy) ? createdBy : null;

      const amenities = parseAmenities(row.amenities);
      const photosLink = String(row.photos_link || '').trim() || null;
      const areaSqft = num(row.area_sqft, null);
      const sizeM2 =
        areaSqft != null && areaSqft > 0 ? Math.round(areaSqft * 0.092903) : null;

      await client.query(
        `INSERT INTO public.units (
          slug, title, status, source, source_code, source_unit, source_url,
          compound, area, city, view, floor, property_type,
          beds, baths, guests, size_m2, photo_urls, amenities,
          price_fallback, notes, price_currency, pricing_model,
          operator_unit_code, internal_code,
          owner_name, owner_email, owner_phone,
          company_commission_pct, company_commission_owner_pct,
          commission_mode, commission_tenant_pct, utilities_cost,
          ops_status, unit_number, project, created_by_staff,
          location_link, created_at, updated_at
        ) VALUES (
          $1,$2,$3,'manual',$4,$5,$6,
          $7,$8,'Egypt',$9,$10,$11,
          $12,$13,$14,$15,'{}',$16,
          $17,$18,'EGP','nightly',
          $19,$20,
          $21,$22,$23,
          $24,$25,
          $26,$27,$28,
          $29,$30,$31,$32,
          $33,
          COALESCE($34::timestamptz, now()),
          COALESCE($35::timestamptz, now())
        )`,
        [
          slug,
          title,
          guestStatus,
          csvId || null,
          unitNumber,
          photosLink,
          project,
          areaFor(project),
          String(row.view || '').trim() || null,
          row.floor !== '' && row.floor != null ? String(row.floor) : null,
          String(row.type || '').trim() || null,
          beds,
          baths,
          guests,
          sizeM2,
          amenities,
          hasPrice ? priceFallback : null,
          String(row.notes || '').trim() || null,
          unitNumber,
          unitNumber,
          String(row.owner_name || '').trim() || null,
          String(row.owner_email || '').trim() || null,
          String(row.owner_phone || '').trim() || null,
          num(row.company_commission_pct, 20),
          num(row.company_commission_owner_pct, 10),
          String(row.commission_mode || 'A').trim() || 'A',
          num(row.commission_tenant_pct, 0),
          num(row.utilities_cost, 0),
          mapOpsStatus(row.status),
          unitNumber,
          project,
          createdByStaff,
          photosLink,
          row.created_at || null,
          row.updated_at || null,
        ]
      );
      inserted += 1;
    }

    await client.query('COMMIT');
    const { rows: verify } = await client.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'published')::int AS published,
              count(*) FILTER (WHERE status = 'draft')::int AS draft
       FROM public.units`
    );
    console.log(`[import] inserted ${inserted}`);
    console.log('[import] verify:', verify[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[import] FAILED:', err.message);
  process.exit(1);
});
