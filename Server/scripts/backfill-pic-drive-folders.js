/**
 * Backfill Google Drive photo folders from the spreadsheet Pic column hyperlinks.
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { Pool } = require('pg');
const { resolveDriveFolderPhotos } = require('../src/services/drivePhotos');
const { resolveListingStatus } = require('../src/lib/unitCompleteness');

const XLSX_PATH = path.resolve(
  'c:/Users/hazem/Downloads/Untitled spreadsheet (2).xlsx'
);

const UNIT_CODES = [
  'B1-SC-12C',
  'B1-SC-12D',
  'B1-C2B',
  'WST-GCH-154AF-S',
  'WST-CAB-B21D',
  'WST-HAZ-3614',
  'WST-HAZEL-3223',
  'WST-CAB-L240',
  'Z27-4',
  'Z-106',
  'B-65',
  'Z22-02',
  'A27-6',
  'R16-3',
  'A61-4',
];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

function cleanText(v) {
  return String(v ?? '')
    .replace(/\r/g, '')
    .replace(/\n/g, ' ')
    .trim();
}

/** Map unit code (col A) → Drive folder URL from Pic hyperlink (col G). */
function readPicFolderMap(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const map = new Map();

  for (let r = 1; r <= range.e.r; r++) {
    const codeCell = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
    const picCell = sheet[XLSX.utils.encode_cell({ r, c: 6 })];
    const code = cleanText(codeCell?.v);
    const folderUrl =
      picCell?.l?.Target ||
      picCell?.l?.Rel?.Target ||
      null;
    if (!code || !folderUrl) {
      console.warn(`No Pic hyperlink for row ${r + 1} code=${code || '—'}`);
      continue;
    }
    map.set(code, String(folderUrl).trim());
  }
  return map;
}

async function main() {
  const folderByCode = readPicFolderMap(XLSX_PATH);
  console.log(`Found ${folderByCode.size} Pic folder links`);

  const client = await pool.connect();
  try {
    for (const code of UNIT_CODES) {
      const folderUrl = folderByCode.get(code);
      if (!folderUrl) {
        console.log(`SKIP ${code}: no Pic link`);
        continue;
      }

      const { rows } = await client.query(
        `SELECT id, title, status, compound, project, area, property_type, unit_number,
                beds, baths, floor, view, guests, the_property, amenities, cover_url,
                photo_urls, source_url, utilities_cost, price_fallback,
                access_fee_per_adult_egp, access_fee_per_teen_egp, access_card_count_included,
                listing_type, other_details, wp_post_id
         FROM units WHERE unit_number = $1 LIMIT 1`,
        [code]
      );
      const unit = rows[0];
      if (!unit) {
        console.log(`SKIP ${code}: unit not in DB`);
        continue;
      }

      let urls = [];
      try {
        const resolved = await resolveDriveFolderPhotos(folderUrl);
        urls = resolved.urls || [];
        console.log(`${code}: resolved ${urls.length} photos`);
      } catch (err) {
        console.warn(`${code}: Drive resolve failed — ${err.message}`);
      }

      const details =
        unit.other_details && typeof unit.other_details === 'object'
          ? { ...unit.other_details }
          : {};
      details.photos_folder_url = folderUrl;

      const coverUrl = urls[0] || unit.cover_url || null;
      const photoUrls = urls.length ? urls : unit.photo_urls || [];

      const assessment = resolveListingStatus({
        unit: {
          ...unit,
          cover_url: coverUrl,
          photo_urls: photoUrls,
          title: unit.title,
          compound: unit.compound || unit.project,
          project: unit.project || unit.compound,
          area: unit.area,
          property_type: unit.property_type,
          unit_number: unit.unit_number,
          the_property: unit.the_property,
          amenities: unit.amenities,
          source_url: unit.source_url,
          utilities_cost: unit.utilities_cost,
          price_fallback: unit.price_fallback,
          access_fee_per_adult_egp: unit.access_fee_per_adult_egp,
          access_fee_per_teen_egp: unit.access_fee_per_teen_egp,
          access_card_count_included: unit.access_card_count_included,
          listing_type: unit.listing_type || 'rent',
        },
        hasPrice: Number(unit.price_fallback) > 0,
        previousStatus: unit.status,
      });

      await client.query(
        `UPDATE units SET
           other_details = $2::jsonb,
           cover_url = $3,
           photo_urls = $4::text[],
           status = $5
         WHERE id = $1`,
        [
          unit.id,
          JSON.stringify(details),
          coverUrl,
          photoUrls,
          assessment.status,
        ]
      );

      console.log(
        `OK ${code} → ${urls.length} photos, status=${assessment.status}, missing=${assessment.missing.join('|') || '—'}`
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
