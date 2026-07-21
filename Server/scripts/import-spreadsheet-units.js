/**
 * Import units from the owner's spreadsheet.
 * Generates titles/descriptions in the existing Soul format.
 * Leaves amenities/facilities/photos empty → units stay draft until completed.
 *
 * Usage: node scripts/import-spreadsheet-units.js
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { Pool } = require('pg');
const { guestsFromBedrooms } = require('../src/lib/guestCapacity');
const { housekeepingFeeForType } = require('../src/lib/housekeeping');
const { normalizeProjectName } = require('../src/lib/projectNames');
const { getMinimumStayNights } = require('../src/lib/minStay');
const { beachAccessPersistValues } = require('../src/lib/beachAccess');
const { resolveListingStatus } = require('../src/lib/unitCompleteness');

const XLSX_PATH = path.resolve(
  'c:/Users/hazem/Downloads/Untitled spreadsheet (2).xlsx'
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function pick(row, ...keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== '') return row[key];
  }
  // fuzzy: trim header whitespace / newlines
  for (const [k, v] of Object.entries(row)) {
    const nk = String(k).replace(/\s+/g, ' ').trim().toLowerCase();
    for (const want of keys) {
      if (nk === String(want).replace(/\s+/g, ' ').trim().toLowerCase()) return v;
    }
  }
  return '';
}

function cleanText(v) {
  return String(v ?? '')
    .replace(/\r/g, '')
    .replace(/\n/g, ' ')
    .trim();
}

/** Read Pic column hyperlinks (Drive folder URLs) keyed by unit code (col A). */
function readPicFolderMap(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const map = new Map();
  for (let r = 1; r <= range.e.r; r++) {
    const code = cleanText(sheet[XLSX.utils.encode_cell({ r, c: 0 })]?.v);
    const picCell = sheet[XLSX.utils.encode_cell({ r, c: 6 })];
    const folderUrl = picCell?.l?.Target || picCell?.l?.Rel?.Target || null;
    if (code && folderUrl) map.set(code, String(folderUrl).trim());
  }
  return map;
}

function phoneToString(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') {
    // avoid scientific notation loss for long numbers
    return String(Math.round(v));
  }
  return cleanText(v).replace(/[^\d+]/g, '');
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
  if (s.startsWith('1') || s.includes('1st') || s === 'first') return 1;
  if (s.startsWith('2') || s.includes('2nd') || s === 'second') return 2;
  if (s.startsWith('3') || s.includes('3rd')) return 3;
  if (s.startsWith('4') || s.includes('4th')) return 4;
  if (s.startsWith('5') || s.includes('5th')) return 5;
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

function normalizeProject(raw) {
  let name = cleanText(raw);
  if (/^d[-\s]?bay$/i.test(name) || /^d-bay$/i.test(name)) name = 'D-Bay';
  if (/^d-bay$/i.test(name.replace(/\s+/g, ''))) name = 'D-Bay';
  if (/d[\s-]*bay/i.test(name)) name = 'D-Bay';
  if (/hacienda\s*west/i.test(name)) name = 'Hacienda West';
  if (/^gaia$/i.test(name)) name = 'GAIA';
  return normalizeProjectName(name);
}

function buildTitle({ type, beds, view, floor, project }) {
  const isStudio = String(type).toLowerCase() === 'studio';
  const viewWord = viewTitleWord(view);
  const fl = floorLabel(floor);
  if (isStudio) return `${viewWord} Studio | ${fl} | ${project}`;
  return `${viewWord} ${beds}BR Stay | ${fl} | ${project}`;
}

function buildDescription({ type, beds, baths, view, floor, project }) {
  const isStudio = String(type).toLowerCase() === 'studio';
  const homeWord = isStudio ? 'studio' : 'unit';
  const layout = isStudio
    ? `a practical studio layout with ${baths} bathroom${Number(baths) === 1 ? '' : 's'}`
    : `${beds} bedroom${Number(beds) === 1 ? '' : 's'} and ${baths} bathroom${Number(baths) === 1 ? '' : 's'}`;

  const p1 = `${floorPhrase(floor)} ${homeWord} in ${project} with ${viewOutlook(view)} and an easy Sahel vibe. The home offers ${layout}, giving a comfortable setup for a relaxed coastal stay.`;

  const p2 =
    floor === 0
      ? 'Easy access at ground level, calm compound living, and a simple coastal feel—ideal for a smooth North Coast getaway.'
      : 'Nice elevation, natural light, and a simple coastal feel—great for a relaxed getaway.';

  return `${p1}\n\n${p2}`;
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

function monthPriceMap(july, august, september, year = 2026) {
  const map = {};
  for (const date of eachDateInclusive(`${year}-07-01`, `${year}-07-31`)) map[date] = july;
  for (const date of eachDateInclusive(`${year}-08-01`, `${year}-08-31`)) map[date] = august;
  for (const date of eachDateInclusive(`${year}-09-01`, `${year}-09-30`)) map[date] = september;
  return map;
}

function parseRows(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  return raw
    .map((row) => {
      // First column = unit code; Pic is often a Drive/folder label and can differ
      const entries = Object.entries(row);
      const firstVal = cleanText(entries[0]?.[1]);
      const unitNumber = cleanText(firstVal || pick(row, 'Pic')).replace(/\s*\(.*\)\s*$/, '');
      if (!unitNumber) return null;

      const type = cleanText(pick(row, 'Type')) || 'Chalet';
      const destination = cleanText(pick(row, 'Desination', 'Destination')) || 'North Coast';
      const project = normalizeProject(pick(row, 'PROJECT ', 'PROJECT', 'Project'));
      let beds = Number(pick(row, 'bedrooms', 'Bedrooms')) || 0;
      if (type.toLowerCase() === 'studio') beds = 0;
      const baths = Number(pick(row, 'Bathrooms', 'bathrooms')) || 1;
      const floor = parseFloor(pick(row, 'FLOOR ', 'FLOOR', 'Floor'));
      const view = normalizeView(pick(row, 'VIEW', 'View'));
      const july = Number(pick(row, 'JULY', 'July')) || 0;
      const august = Number(pick(row, 'AUGUST', 'August')) || 0;
      const september = Number(pick(row, 'September ', 'September', 'SEPTEMBER')) || 0;
      const ownerName = cleanText(pick(row, 'Owner name', 'Owner Name'));
      const companyPct = pctToNumber(pick(row, 'Commission %'));
      const ownerPct = pctToNumber(pick(row, 'Commission Via Owner %'));
      const tenantPct = pctToNumber(pick(row, 'Tenant Commission %'));
      const commissionMode = cleanText(pick(row, 'Commission Mode')) || 'C';
      const utilities = Number(pick(row, 'UTILITIES', 'Utilities')) || 0;
      const ownerPhone = phoneToString(pick(row, 'Owner Phone Number'));
      const locationLink = cleanText(pick(row, 'Location Link'));

      const title = buildTitle({ type, beds, view, floor, project });
      const description = buildDescription({ type, beds, baths, view, floor, project });
      const guests = guestsFromBedrooms(beds);
      const priceFallback = july || august || september || null;

      return {
        unitNumber,
        type,
        destination,
        project,
        beds,
        baths,
        floor,
        view,
        july,
        august,
        september,
        ownerName,
        companyPct,
        ownerPct,
        tenantPct,
        commissionMode,
        utilities,
        ownerPhone,
        locationLink,
        title,
        description,
        guests,
        priceFallback,
      };
    })
    .filter(Boolean);
}

async function main() {
  const rows = parseRows(XLSX_PATH);
  console.log(`Parsed ${rows.length} units from spreadsheet`);

  const client = await pool.connect();
  const created = [];
  try {
    await client.query('BEGIN');

    for (const u of rows) {
      const existing = await client.query(
        `SELECT id, title FROM units WHERE unit_number ILIKE $1 OR slug = $2 LIMIT 1`,
        [u.unitNumber, slugify(`${u.project}-${u.unitNumber}`)]
      );
      if (existing.rows[0]) {
        console.log(`SKIP existing ${u.unitNumber} → ${existing.rows[0].title}`);
        continue;
      }

      const beach = beachAccessPersistValues(
        { listing_type: 'rent' },
        { project: u.project, compound: u.project, area: u.destination }
      ) || {
        adult: null,
        extra: null,
        days: 7,
      };

      const unitPayload = {
        title: u.title,
        name: u.title,
        compound: u.project,
        project: u.project,
        area: u.destination,
        destination: u.destination,
        property_type: u.type,
        type: u.type,
        unit_number: u.unitNumber,
        beds: u.beds,
        bedrooms: u.beds,
        baths: u.baths,
        bathrooms: u.baths,
        floor: u.floor,
        view: u.view,
        guests: u.guests,
        the_property: u.description,
        description: u.description,
        source_url: u.locationLink,
        location_link: u.locationLink,
        utilities_cost: u.utilities,
        price_fallback: u.priceFallback,
        price_per_night: u.priceFallback,
        amenities: [],
        listing_type: 'rent',
        access_fee_per_adult_egp: beach.adult,
        access_fee_per_teen_egp: beach.extra,
        access_card_count_included: beach.days,
        beach_access_price: beach.adult,
        beach_access_extra_guest: beach.extra,
        beach_access_days: beach.days,
      };

      const completeness = resolveListingStatus({ unit: unitPayload, hasPrice: !!u.priceFallback });
      const minNights = getMinimumStayNights({
        project: u.project,
        compound: u.project,
        area: u.destination,
      });
      const cleaning = housekeepingFeeForType(u.type);
      const slugBase = slugify(`${u.project}-${u.unitNumber}`);
      let slug = slugBase;
      let n = 2;
      // ensure unique slug
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const clash = await client.query(`SELECT 1 FROM units WHERE slug = $1`, [slug]);
        if (!clash.rows[0]) break;
        slug = `${slugBase}-${n++}`;
      }

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
           '{}'::text[], '{}'::text[], '{}'::jsonb, NULL, $9,
           $10,$11,
           $12,$13,$14,$15,
           $16,'available',$17,$18,
           $19,$20,$21,$22,$23,$24,
           $25,$26,$27,
           'rent'
         ) RETURNING id, wp_post_id, title, status, unit_number, compound`,
        [
          slug,
          u.title,
          completeness.status,
          u.project,
          u.destination,
          u.beds,
          u.baths,
          u.guests,
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
          u.locationLink || null,
          minNights,
          cleaning,
          beach.adult,
          beach.extra,
          beach.days,
        ]
      );

      const unit = inserted[0];
      const prices = monthPriceMap(u.july, u.august, u.september, 2026);
      for (const [date, price] of Object.entries(prices)) {
        if (!(price > 0) || !unit.wp_post_id) continue;
        await client.query(
          `INSERT INTO unit_daily_prices (wp_post_id, date, price, currency, source, updated_at)
           VALUES ($1,$2::date,$3,'EGP','import-spreadsheet', now())
           ON CONFLICT (wp_post_id, date) DO UPDATE SET
             price = EXCLUDED.price, source = EXCLUDED.source, updated_at = now()`,
          [unit.wp_post_id, date, price]
        );
      }

      created.push({
        id: unit.id,
        unit_number: unit.unit_number,
        title: unit.title,
        project: unit.compound,
        status: unit.status,
        missing: completeness.missing,
      });
      console.log(
        `OK ${unit.unit_number} → ${unit.title} [${unit.status}] missing=${completeness.missing.join('|') || '—'}`
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

  console.log('\nDone. Created:', created.length);
  console.log(JSON.stringify(created, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
