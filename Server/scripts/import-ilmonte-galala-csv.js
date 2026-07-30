/**
 * Import Il Monte Galala units from the Sheet1 CSV export.
 *
 * Usage:
 *   node scripts/import-ilmonte-galala-csv.js
 *   set ILMONTE_CSV=path\to\file.csv
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');
const { normalizePropertyType } = require('../src/lib/propertyType');
const { guestsFromBedrooms } = require('../src/lib/guestCapacity');

const PROJECT = 'IL Monte Galala';
const DESTINATION = 'Ain Sokhna';

const CORE_AMENITIES = [
  'Wi-Fi',
  'Bed Lines',
  'Beach Access',
  'Cooking Basics',
  'Free Parking',
  'Heating',
  'Stove',
  'Microwave',
  'Hot Watter Kettls',
  'Refrigerator',
];

const EXTRA_AMENITIES = [
  'Air conditioning',
  'Smart TV',
  'Washer',
  'Dryer',
  'Dishwasher',
  'Oven',
  'Coffee maker',
  'Toaster',
  'Blender',
  'Dining table',
  'Private balcony',
  'Private terrace',
  'Blackout curtains',
  'Extra pillows and blankets',
  'Hangers',
  'Iron',
  'Hair dryer',
  'Shampoo',
  'Body soap',
  'Hot water',
  'Bathtub',
  'Shower',
  'Bidet',
  'Dedicated workspace',
  'Safe',
  'Elevator access',
  'Ground-floor access',
  'Keyless smart lock',
  'Self check-in',
  'Kitchenette',
  'Full kitchen',
  'Outdoor dining area',
  'BBQ grill',
  'Housekeeping available',
];

/** Official / publicly listed compound facilities for IL Monte Galala (Tatweer Misr). */
const PROJECT_FACILITIES = [
  'Private Red Sea beach (1.3–1.4 km shoreline)',
  'Crystal Lagoons — mountain-top lagoon (Crystal Lagoons®)',
  'Lagoon clubhouse & lagoon shoreline',
  'Seafront Beach Hub',
  'Maestà mountain-top promenade',
  'Sky Summit Restaurant',
  'Adventure Park / Basecamp (Rock ’n Rope)',
  'Via Ferrata & rock climbing',
  'Zip lining',
  'Mountain biking & eco desert trails',
  'Desert campsite & beach camp',
  'Tethered balloon rides',
  'Spa & wellness / thalassotherapy',
  'Infinity & outdoor swimming pools',
  'Kids play area & children beach clubs',
  'Sports zone & sporting facilities',
  'Art & Fashion School',
  'Art Walkway / open-air art symposium',
  'Marina',
  'Restaurants & cafes',
  'Luxury shopping / Old Town retail',
  'Green spaces & botanical gardens',
  '5-star hotels / hospitality',
  'Walking & jogging tracks',
  '24/7 security & gated entry',
];

const url = String(process.env.DATABASE_URL || '')
  .replace(/[?&]sslmode=[^&]*/gi, '')
  .replace(/\?$/, '');
const csvPath =
  process.env.ILMONTE_CSV ||
  path.join(process.env.USERPROFILE || '', 'Downloads', 'Ilmonte Galala Units - Sheet1.csv');

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

function pct(raw, fallback = 20) {
  const n = Number(String(raw || '').replace(/%/g, '').trim());
  return Number.isFinite(n) ? n : fallback;
}

function num(v, fallback = null) {
  if (v === '' || v == null) return fallback;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : fallback;
}

function cleanPhone(raw) {
  return String(raw || '')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' / ') || null;
}

function pickAmenities(seed) {
  // Deterministic extras from unit code so re-runs stay stable
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const count = 3 + (h % 5); // 3–7 extras
  const poolCopy = [...EXTRA_AMENITIES];
  const picked = [];
  for (let i = 0; i < count && poolCopy.length; i += 1) {
    const idx = h % poolCopy.length;
    h = (h * 1103515245 + 12345) >>> 0;
    picked.push(poolCopy.splice(idx, 1)[0]);
  }
  return [...CORE_AMENITIES, ...picked];
}

function col(row, ...keys) {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== '') return row[k];
  }
  // Fuzzy: match ignoring case / trailing spaces
  const entries = Object.entries(row);
  for (const want of keys) {
    const w = String(want).toLowerCase().trim();
    for (const [k, v] of entries) {
      if (String(k).toLowerCase().trim() === w && v != null && String(v).trim() !== '') return v;
    }
  }
  return '';
}

async function ensureProject(client) {
  const normalized = PROJECT.toLowerCase();
  const destNorm = DESTINATION.toLowerCase();
  const { rows } = await client.query(
    `SELECT id FROM location_projects
     WHERE normalized_name = $1 AND normalized_destination = $2`,
    [normalized, destNorm]
  );
  if (rows[0]) {
    await client.query(
      `UPDATE location_projects
       SET facilities = $1::text[], name = $2, updated_at = now()
       WHERE id = $3`,
      [PROJECT_FACILITIES, PROJECT, rows[0].id]
    );
    console.log(`[import] updated project facilities id=${rows[0].id}`);
    return rows[0].id;
  }
  const { rows: inserted } = await client.query(
    `INSERT INTO location_projects
       (destination, name, normalized_destination, normalized_name, sort_order, facilities)
     VALUES ($1,$2,$3,$4,50,$5::text[])
     RETURNING id`,
    [DESTINATION, PROJECT, destNorm, normalized, PROJECT_FACILITIES]
  );
  console.log(`[import] created project id=${inserted[0].id}`);
  return inserted[0].id;
}

async function main() {
  const text = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    trim: true,
    bom: true,
  });
  console.log(`[import] ${rows.length} rows from ${csvPath}`);

  // First column header is often "-" — unit code lives there
  const unitKey =
    Object.keys(rows[0] || {}).find((k) => k === '-' || /^-+$/.test(k.trim()) || /unit/i.test(k)) ||
    Object.keys(rows[0] || {})[0];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureProject(client);

    let inserted = 0;
    let skipped = 0;
    let updated = 0;

    for (const row of rows) {
      const unitNumber = String(col(row, unitKey, 'unit_number', 'Unit Number', '-') || '')
        .trim()
        .replace(/\s+/g, ' ');
      if (!unitNumber) {
        skipped += 1;
        continue;
      }

      const propertyType = normalizePropertyType(col(row, 'Type', 'type')) || 'Chalet';
      const beds = Math.max(0, Math.trunc(num(col(row, 'no of beds', 'no of beds ', 'bedrooms'), 1)));
      const baths = Math.max(0, Math.trunc(num(col(row, 'no of bathrooms', 'bathrooms'), 1)));
      const guests =
        typeof guestsFromBedrooms === 'function'
          ? guestsFromBedrooms(beds) || Math.max(beds * 2, 2)
          : Math.max(beds * 2 || 2, 1);
      const floor = String(col(row, 'FLOOR', 'FLOOR ', 'floor') || '').trim() || null;
      const view = String(col(row, 'VIEW', 'view') || '').trim() || null;
      const ownerName = String(col(row, 'Owner Name', 'owner_name') || '').trim() || null;
      const ownerPhone = cleanPhone(col(row, 'Owner Phone #', 'Owner Phone', 'owner_phone'));
      const mode = String(col(row, 'Commission Mode', 'commission_mode') || 'C')
        .trim()
        .toUpperCase() || 'C';
      const viaUs = pct(col(row, 'Commission % - Via Us', 'Commission % - Via Us'), 20);
      const viaOwner = pct(col(row, 'Commission %', 'Commission%'), 20);
      const utilities = num(col(row, 'Utilities', 'utilities'), 0) || 0;
      const amenities = pickAmenities(unitNumber);
      const title = `${PROJECT} ${unitNumber}`;
      let slug = slugify(`il-monte-galala-${unitNumber}`, unitNumber);

      const existing = await client.query(
        `SELECT id, slug FROM units
         WHERE lower(unit_number) = lower($1)
           AND (lower(project) = lower($2) OR lower(compound) = lower($2))
         LIMIT 1`,
        [unitNumber, PROJECT]
      );

      if (existing.rows[0]) {
        await client.query(
          `UPDATE units SET
             title = $1,
             property_type = $2,
             beds = $3,
             baths = $4,
             guests = $5,
             floor = $6,
             view = $7,
             owner_name = $8,
             owner_phone = $9,
             commission_mode = $10,
             company_commission_pct = $11,
             company_commission_owner_pct = $12,
             utilities_cost = $13,
             amenities = $14::text[],
             project = $15,
             compound = $15,
             area = $16,
             city = 'Egypt',
             updated_at = now()
           WHERE id = $17`,
          [
            title,
            propertyType,
            beds,
            baths,
            guests,
            floor,
            view,
            ownerName,
            ownerPhone,
            mode,
            viaUs,
            viaOwner,
            utilities,
            amenities,
            PROJECT,
            DESTINATION,
            existing.rows[0].id,
          ]
        );
        updated += 1;
        continue;
      }

      // Unique slug
      const slugClash = await client.query(`SELECT 1 FROM units WHERE slug = $1`, [slug]);
      if (slugClash.rows[0]) slug = `${slug}-${Date.now().toString(36)}`;

      await client.query(
        `INSERT INTO units (
           slug, title, status, source, source_code, source_unit,
           compound, area, city, view, floor, property_type,
           beds, baths, guests, photo_urls, amenities,
           price_currency, pricing_model,
           operator_unit_code, internal_code, unit_number,
           owner_name, owner_phone,
           company_commission_pct, company_commission_owner_pct,
           commission_mode, commission_tenant_pct, utilities_cost,
           ops_status, project, listing_type
         ) VALUES (
           $1,$2,'draft','manual',$3,$3,
           $4,$5,'Egypt',$6,$7,$8,
           $9,$10,$11,'{}',$12::text[],
           'EGP','nightly',
           $3,$3,$3,
           $13,$14,
           $15,$16,
           $17,0,$18,
           'available',$4,'rent'
         )`,
        [
          slug,
          title,
          unitNumber,
          PROJECT,
          DESTINATION,
          view,
          floor,
          propertyType,
          beds,
          baths,
          guests,
          amenities,
          ownerName,
          ownerPhone,
          viaUs,
          viaOwner,
          mode,
          utilities,
        ]
      );
      inserted += 1;
    }

    await client.query('COMMIT');
    console.log(`[import] inserted=${inserted} updated=${updated} skipped=${skipped}`);
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
