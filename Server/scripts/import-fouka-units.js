/**
 * Import Fouka Bay units from:
 *   - Fouka Units.xlsx (inventory + monthly rates + beach)
 *   - Fouka Commission.xlsx (owner + commission + utilities + phone)
 *
 * Skips units that already exist (matched by unit_number, normalized).
 * Assigns ≥10 random amenities so amenity completeness is satisfied.
 * Missing Drive photos / phone / location → stay draft (OK).
 *
 * Usage:
 *   node scripts/import-fouka-units.js           # dry-run
 *   node scripts/import-fouka-units.js --apply
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { Pool } = require('pg');
const { guestsFromBedrooms } = require('../src/lib/guestCapacity');
const { housekeepingFeeForType } = require('../src/lib/housekeeping');
const { normalizeProjectName } = require('../src/lib/projectNames');
const { getMinimumStayNights } = require('../src/lib/minStay');
const { resolveListingStatus } = require('../src/lib/unitCompleteness');

const UNITS_XLSX = path.resolve('c:/Users/hazem/Downloads/Fouka Units.xlsx');
const COMM_XLSX = path.resolve('c:/Users/hazem/Downloads/Fouka Commission.xlsx');
const APPLY = process.argv.includes('--apply');
const YEAR = 2026;

const AMENITY_POOL = [
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
  'Private pool access',
  'Housekeeping available',
];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function cleanText(v) {
  return String(v ?? '')
    .replace(/\r/g, '')
    .replace(/\n/g, ' ')
    .trim();
}

function pick(row, ...keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== '') return row[key];
  }
  for (const [k, v] of Object.entries(row)) {
    const nk = String(k).replace(/\s+/g, ' ').trim().toLowerCase();
    for (const want of keys) {
      if (nk === String(want).replace(/\s+/g, ' ').trim().toLowerCase()) return v;
    }
  }
  // first column often unit code with blank / __EMPTY header
  return undefined;
}

function normCode(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '')
    .replace(/ch/g, '');
}

function phoneToString(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    const s = String(Math.round(v));
    if (/^1\d{9}$/.test(s)) return `0${s}`;
    return s;
  }
  let s = cleanText(v).replace(/[^\d+]/g, '');
  if (/^1\d{9}$/.test(s)) s = `0${s}`;
  return s;
}

function pctToNumber(v) {
  if (v == null || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}

function parseFloor(raw) {
  const s = cleanText(raw).toLowerCase();
  if (!s || s.includes('ground') || s === 'g' || s === '0') return 0;
  if (s.includes('1 st') || s.includes('1st') || s.startsWith('1') || s.includes('first')) return 1;
  if (s.includes('2nd') || s.startsWith('2') || s.includes('second')) return 2;
  if (s.includes('3rd') || s.startsWith('3') || s.includes('third')) return 3;
  if (s.includes('4th') || s.startsWith('4')) return 4;
  if (s.includes('5th') || s.startsWith('5')) return 5;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

function floorLabel(floor) {
  if (floor === 0) return 'Ground Floor';
  if (floor === 1) return '1st Floor';
  if (floor === 2) return '2nd Floor';
  if (floor === 3) return '3rd Floor';
  if (floor === 4) return '4th Floor';
  if (floor === 5) return '5th Floor';
  return `Floor ${floor}`;
}

function floorPhrase(floor) {
  if (floor === 0) return 'Ground-floor';
  if (floor === 1) return 'First-floor';
  if (floor === 2) return 'Second-floor';
  if (floor === 3) return 'Third-floor';
  if (floor === 4) return 'Fourth-floor';
  if (floor === 5) return 'Fifth-floor';
  return `Floor-${floor}`;
}

function normalizeView(raw) {
  const s = cleanText(raw).toLowerCase();
  if (s.includes('double')) return 'Double View';
  if (s.includes('lagoon')) return 'Lagoon View';
  if (s.includes('sea') || s.includes('beach')) return 'Sea View';
  if (s.includes('pool')) return 'Pool View';
  if (s.includes('garden')) return 'Garden View';
  if (s.includes('street')) return 'Street View';
  if (!s) return 'Compound View';
  return cleanText(raw)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function viewTitleWord(view) {
  if (view === 'Lagoon View') return 'Lagoon';
  if (view === 'Sea View') return 'Sea View';
  if (view === 'Pool View') return 'Pool';
  if (view === 'Garden View') return 'Garden';
  if (view === 'Street View') return 'Street';
  if (view === 'Double View') return 'Double View';
  return view.replace(/\s*View$/i, '') || 'Coastal';
}

function viewOutlook(view) {
  if (view === 'Lagoon View') return 'a calm lagoon-facing outlook';
  if (view === 'Sea View') return 'an open sea-facing outlook';
  if (view === 'Pool View') return 'a relaxed pool-facing outlook';
  if (view === 'Garden View') return 'a green garden-facing outlook';
  if (view === 'Street View') return 'an easy street-facing setting';
  if (view === 'Double View') return 'a bright double-view outlook';
  return `a pleasant ${view.toLowerCase()} outlook`;
}

function buildTitle({ type, beds, view, floor, project }) {
  const viewWord = viewTitleWord(view);
  const fl = floorLabel(floor);
  return `${viewWord} ${beds}BR Stay | ${fl} | ${project}`;
}

function buildDescription({ beds, baths, view, floor, project }) {
  const layout = `${beds} bedroom${Number(beds) === 1 ? '' : 's'} and ${baths} bathroom${
    Number(baths) === 1 ? '' : 's'
  }`;
  const p1 = `${floorPhrase(floor)} unit in ${project} with ${viewOutlook(view)} and an easy Sahel vibe. The home offers ${layout}, giving a comfortable setup for a relaxed coastal stay.`;
  const p2 =
    floor === 0
      ? 'Easy access at ground level, calm compound living, and a simple coastal feel—ideal for a smooth North Coast getaway.'
      : 'Nice elevation, natural light, and a simple coastal feel—great for a relaxed getaway.';
  return `${p1}\n\n${p2}`;
}

function parseMonthPrice(v) {
  if (v == null || v === '') return 0;
  const s = cleanText(v).toLowerCase();
  if (!s || s.includes('block') || s === '-' || s === 'n/a') return 0;
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function eachDateInclusive(fromIso, toIso) {
  const out = [];
  const d = new Date(`${fromIso}T00:00:00`);
  const end = new Date(`${toIso}T00:00:00`);
  while (d <= end) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function monthPriceMap(july, august, september, year = YEAR) {
  const map = {};
  for (const date of eachDateInclusive(`${year}-07-01`, `${year}-07-31`)) {
    if (july > 0) map[date] = july;
  }
  for (const date of eachDateInclusive(`${year}-08-01`, `${year}-08-31`)) {
    if (august > 0) map[date] = august;
  }
  for (const date of eachDateInclusive(`${year}-09-01`, `${year}-09-30`)) {
    if (september > 0) map[date] = september;
  }
  return map;
}

function randomAmenities(minCount = 10) {
  const pool = [...AMENITY_POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const count = Math.min(pool.length, Math.max(minCount, 10 + Math.floor(Math.random() * 6)));
  return pool.slice(0, count);
}

function looksLikeDriveUrl(v) {
  const s = cleanText(v);
  return /^https?:\/\//i.test(s) && /drive\.google\.com|docs\.google\.com/i.test(s);
}

function loadCommissionMap(filePath) {
  const rows = XLSX.utils.sheet_to_json(XLSX.readFile(filePath).Sheets.Sheet1, { defval: '' });
  const map = new Map();
  for (const row of rows) {
    const code = cleanText(pick(row, 'Unit', 'unit', 'Unit Number') || Object.values(row)[1]);
    if (!code) continue;
    map.set(normCode(code), {
      unitNumber: code,
      project: normalizeProjectName(cleanText(pick(row, 'Project')) || 'Fouka Bay'),
      ownerName: cleanText(pick(row, 'Owner name', 'Owner Name')),
      companyPct: pctToNumber(pick(row, 'Commission %')),
      ownerPct: pctToNumber(pick(row, 'Commission % - via owner', 'Commission Via Owner %')),
      utilities: Number(pick(row, 'UTILITES', 'UTILITIES', 'Utilities')) || 0,
      ownerPhone: phoneToString(pick(row, 'Mobile Number', 'Owner Phone Number', 'Phone')),
      commissionMode: cleanText(pick(row, 'Commission Mode')) || 'C',
    });
  }
  return map;
}

function loadUnits(filePath) {
  const rows = XLSX.utils.sheet_to_json(XLSX.readFile(filePath).Sheets.Sheet1, { defval: '' });
  return rows
    .map((row) => {
      const entries = Object.entries(row);
      const unitNumber = cleanText(pick(row, 'Unit', 'unit', '__EMPTY') || entries[0]?.[1]);
      if (!unitNumber) return null;
      const type = cleanText(pick(row, 'Type')) || 'Chalet';
      const project = normalizeProjectName(cleanText(pick(row, 'Project')) || 'Fouka Bay');
      const beds = Number(pick(row, 'bed', 'beds', 'bedrooms')) || 1;
      const baths = Number(pick(row, 'bath', 'baths', 'bathrooms')) || 1;
      const floor = parseFloor(pick(row, 'FLOOR ', 'FLOOR', 'Floor'));
      const view = normalizeView(pick(row, 'VIEW', 'View'));
      const beachAdult = Number(pick(row, 'Beach Access Price')) || 0;
      const beachDays = Number(pick(row, 'Beach access period')) || 7;
      const beachExtra = Number(pick(row, 'Beach access price for extra')) || 0;
      const photosRaw = cleanText(pick(row, 'photos', 'Photos', 'Pic'));
      const photosFolderUrl = looksLikeDriveUrl(photosRaw) ? photosRaw : '';
      const july = parseMonthPrice(pick(row, 'JULY', 'July'));
      const august = parseMonthPrice(pick(row, 'AUGUST', 'August'));
      const september = parseMonthPrice(pick(row, 'September ', 'September', 'SEPTEMBER'));
      return {
        unitNumber,
        type,
        project,
        destination: 'North Coast',
        beds,
        baths,
        floor,
        view,
        beachAdult,
        beachDays,
        beachExtra,
        photosFolderUrl,
        july,
        august,
        september,
      };
    })
    .filter(Boolean);
}

async function main() {
  const commissionByCode = loadCommissionMap(COMM_XLSX);
  const unitRows = loadUnits(UNITS_XLSX);
  console.log(`Units sheet: ${unitRows.length}; Commission sheet: ${commissionByCode.size}`);

  const { rows: dbUnits } = await pool.query(
    `SELECT id, unit_number, title, status, wp_post_id FROM units WHERE unit_number IS NOT NULL`
  );
  const dbByNorm = new Map();
  for (const u of dbUnits) {
    const key = normCode(u.unit_number);
    if (key && !dbByNorm.has(key)) dbByNorm.set(key, u);
  }

  const planned = [];
  const skipped = [];

  for (const base of unitRows) {
    const key = normCode(base.unitNumber);
    const existing = dbByNorm.get(key);
    if (existing) {
      skipped.push({
        unit: base.unitNumber,
        reason: 'already exists',
        existing: existing.unit_number,
        title: existing.title,
        status: existing.status,
      });
      continue;
    }

    const comm = commissionByCode.get(key) || {};
    const project = base.project || comm.project || 'Fouka Bay';
    const title = buildTitle({
      type: base.type,
      beds: base.beds,
      view: base.view,
      floor: base.floor,
      project,
    });
    const description = buildDescription({
      beds: base.beds,
      baths: base.baths,
      view: base.view,
      floor: base.floor,
      project,
    });
    const amenities = randomAmenities(10);
    const priceFallback = base.july || base.august || base.september || null;
    const guests = guestsFromBedrooms(base.beds);

    const unitPayload = {
      title,
      compound: project,
      project,
      area: 'North Coast',
      destination: 'North Coast',
      property_type: base.type,
      unit_number: base.unitNumber,
      beds: base.beds,
      baths: base.baths,
      floor: base.floor,
      view: base.view,
      guests,
      the_property: description,
      description,
      source_url: null,
      location_link: null,
      utilities_cost: comm.utilities ?? 0,
      price_fallback: priceFallback,
      amenities,
      listing_type: 'rent',
      access_fee_per_adult_egp: base.beachAdult,
      access_fee_per_teen_egp: base.beachExtra,
      access_card_count_included: base.beachDays,
      cover_url: null,
      photo_urls: [],
    };

    const completeness = resolveListingStatus({
      unit: unitPayload,
      hasPrice: !!priceFallback,
    });

    planned.push({
      ...base,
      project,
      title,
      description,
      amenities,
      guests,
      priceFallback,
      ownerName: comm.ownerName || '',
      ownerPhone: comm.ownerPhone || '',
      companyPct: comm.companyPct ?? 20,
      ownerPct: comm.ownerPct ?? 20,
      tenantPct: 0,
      commissionMode: comm.commissionMode || 'C',
      utilities: comm.utilities ?? 0,
      completeness,
      priceNights: Object.keys(monthPriceMap(base.july, base.august, base.september)).length,
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? 'APPLY' : 'DRY_RUN',
        toCreate: planned.length,
        skippedExisting: skipped.length,
        sampleCreate: planned.slice(0, 5).map((u) => ({
          unit: u.unitNumber,
          title: u.title,
          status: u.completeness.status,
          missing: u.completeness.missing,
          amenities: u.amenities.length,
          phone: u.ownerPhone || null,
          prices: { july: u.july, august: u.august, september: u.september },
        })),
        skippedSample: skipped.slice(0, 15),
      },
      null,
      2
    )
  );

  if (!APPLY) {
    console.log('\nDry-run only. Re-run with --apply to insert units.');
    await pool.end();
    return;
  }

  const client = await pool.connect();
  const created = [];
  try {
    await client.query('BEGIN');

    for (const u of planned) {
      const minNights = getMinimumStayNights({
        project: u.project,
        compound: u.project,
        area: 'North Coast',
      });
      const cleaning = housekeepingFeeForType(u.type);
      const slugBase = slugify(`${u.project}-${u.unitNumber}`);
      let slug = slugBase;
      let n = 2;
      while (true) {
        const clash = await client.query(`SELECT 1 FROM units WHERE slug = $1`, [slug]);
        if (!clash.rows[0]) break;
        slug = `${slugBase}-${n++}`;
      }

      const otherDetails = u.photosFolderUrl
        ? JSON.stringify({ photos_folder_url: u.photosFolderUrl })
        : '{}';

      const { rows: inserted } = await client.query(
        `INSERT INTO units (
           slug, title, status, source, compound, project, area, beds, baths, guests,
           photo_urls, amenities, other_details, short_description, the_property,
           owner_name, owner_phone,
           company_commission_pct, company_commission_owner_pct, commission_mode, commission_tenant_pct,
           utilities_cost, ops_status, unit_number, price_fallback,
           property_type, view, floor, source_url, min_nights, cleaning_fee_egp,
           access_fee_per_adult_egp, access_fee_per_teen_egp, access_card_count_included,
           listing_type
         ) VALUES (
           $1,$2,$3,'manual',$4,$4,$5,$6,$7,$8,
           '{}'::text[], $9::text[], $10::jsonb, NULL, $11,
           $12,$13,
           $14,$15,$16,$17,
           $18,'available',$19,$20,
           $21,$22,$23,NULL,$24,$25,
           $26,$27,$28,
           'rent'
         ) RETURNING id, wp_post_id, title, status, unit_number, compound`,
        [
          slug,
          u.title,
          u.completeness.status,
          u.project,
          'North Coast',
          u.beds,
          u.baths,
          u.guests,
          u.amenities,
          otherDetails,
          u.description,
          u.ownerName || null,
          u.ownerPhone || null,
          u.companyPct,
          u.ownerPct,
          u.commissionMode,
          u.tenantPct,
          u.utilities,
          u.unitNumber,
          u.priceFallback,
          u.type,
          u.view,
          String(u.floor),
          minNights,
          cleaning,
          u.beachAdult,
          u.beachExtra,
          u.beachDays,
        ]
      );

      const unit = inserted[0];
      const prices = monthPriceMap(u.july, u.august, u.september);
      let priceCount = 0;
      for (const [date, price] of Object.entries(prices)) {
        if (!(price > 0) || !unit.wp_post_id) continue;
        await client.query(
          `INSERT INTO unit_daily_prices (wp_post_id, date, price, currency, source, updated_at)
           VALUES ($1,$2::date,$3,'EGP','import-fouka', now())
           ON CONFLICT (wp_post_id, date) DO UPDATE SET
             price = EXCLUDED.price, source = EXCLUDED.source, updated_at = now()`,
          [unit.wp_post_id, date, price]
        );
        priceCount += 1;
      }

      created.push({
        unit_number: unit.unit_number,
        title: unit.title,
        status: unit.status,
        amenities: u.amenities.length,
        priceNights: priceCount,
        missing: u.completeness.missing,
      });
      console.log(
        `OK ${unit.unit_number} → ${unit.title} [${unit.status}] amenities=${u.amenities.length} prices=${priceCount} missing=${u.completeness.missing.join('|') || '—'}`
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }

  console.log(JSON.stringify({ created: created.length, skipped: skipped.length, created }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
