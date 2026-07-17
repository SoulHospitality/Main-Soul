require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const CSV_PATH = process.argv[2] || path.join(process.env.USERPROFILE || '', 'Downloads', 'units_rows.csv');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/** Minimal RFC4180 CSV parser (handles quotes + multiline fields). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function emptyToNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s;
}

function toInt(v) {
  const s = emptyToNull(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toNum(v) {
  const s = emptyToNull(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toBool(v, fallback = false) {
  const s = emptyToNull(v);
  if (s == null) return fallback;
  const lower = s.toLowerCase();
  if (['true', 't', '1', 'yes'].includes(lower)) return true;
  if (['false', 'f', '0', 'no'].includes(lower)) return false;
  return fallback;
}

function parseTextArray(v) {
  const s = emptyToNull(v);
  if (s == null) return [];
  if (s === '{}' || s === '[]') return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    /* fall through */
  }
  // Postgres array literal {a,b}
  if (s.startsWith('{') && s.endsWith('}')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((x) => x.replace(/^"|"$/g, '').trim()).filter(Boolean);
  }
  return [];
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `unit-${Date.now().toString(36)}`;
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV not found: ${CSV_PATH}`);
  }

  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const matrix = parseCsv(raw.replace(/^\uFEFF/, ''));
  if (matrix.length < 2) throw new Error('CSV has no data rows');

  const headers = matrix[0].map((h) => h.trim());
  const records = matrix.slice(1).filter((r) => r.some((c) => String(c || '').trim()));

  const { rows: colRows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'units'`
  );
  const dbCols = new Set(colRows.map((r) => r.column_name));

  const ignoredCsv = headers.filter((h) => h && !dbCols.has(h));
  console.log(`CSV rows: ${records.length}`);
  console.log(`Ignored CSV columns (not in DB): ${ignoredCsv.join(', ') || '(none)'}`);

  // Upsert key preference: slug (unique), then wp_post_id
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  for (let idx = 0; idx < records.length; idx++) {
    const cells = records[idx];
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] != null ? cells[i] : '';
    });

    try {
      const title = emptyToNull(row.title);
      let slug = emptyToNull(row.slug) || (title ? slugify(title) : null);
      if (!title || !slug) {
        skipped += 1;
        errors.push(`row ${idx + 2}: missing title/slug`);
        continue;
      }

      // Ensure unique slug if colliding on insert of different id
      const beds = toInt(row.beds) ?? 0;
      const baths = toInt(row.baths) ?? 0;
      const guests = toInt(row.guests) ?? Math.max(1, beds * 2 || 1);
      const compound = emptyToNull(row.compound) || emptyToNull(row.project) || 'Unknown';
      const project = emptyToNull(row.project) || compound;
      const area = emptyToNull(row.area) || 'North Coast';
      const city = emptyToNull(row.city) || 'Egypt';
      const status = emptyToNull(row.status) || 'draft';
      const source = emptyToNull(row.source) || 'soul';
      const photoUrls = parseTextArray(row.photo_urls);
      const amenities = parseTextArray(row.amenities);
      const coverUrl = emptyToNull(row.cover_url) || photoUrls[0] || null;
      const otherDetails = emptyToNull(row.other_details);

      const payload = {
        id: emptyToNull(row.id),
        slug,
        title,
        status: ['draft', 'published', 'cancelled', 'archived', 'delisted'].includes(status) ? status : 'draft',
        source: ['soul', 'manual'].includes(source) ? source : 'soul',
        source_code: emptyToNull(row.source_code),
        source_unit: emptyToNull(row.source_unit),
        source_url: emptyToNull(row.source_url),
        compound,
        project,
        area,
        city,
        lat: toNum(row.lat),
        lng: toNum(row.lng),
        view: emptyToNull(row.view),
        floor: emptyToNull(row.floor),
        property_type: emptyToNull(row.property_type),
        beds,
        baths,
        guests,
        size_m2: toInt(row.size_m2),
        cover_url: coverUrl,
        photo_urls: photoUrls,
        short_description: emptyToNull(row.short_description),
        the_property: emptyToNull(row.the_property),
        guest_access: emptyToNull(row.guest_access),
        neighborhood: emptyToNull(row.neighborhood),
        getting_around: emptyToNull(row.getting_around),
        other_details: otherDetails,
        amenities,
        price_eid_adha: toInt(row.price_eid_adha),
        price_june: toInt(row.price_june),
        price_june_first_half: toInt(row.price_june_first_half),
        price_june_second_half: toInt(row.price_june_second_half),
        price_july: toInt(row.price_july),
        price_july_first_half: toInt(row.price_july_first_half),
        price_july_second_half: toInt(row.price_july_second_half),
        price_july_august: toInt(row.price_july_august),
        price_august: toInt(row.price_august),
        price_september: toInt(row.price_september),
        price_september_first_half: toInt(row.price_september_first_half),
        price_september_second_half: toInt(row.price_september_second_half),
        price_fallback: toInt(row.price_fallback),
        cleaning_fee_egp: toInt(row.cleaning_fee_egp),
        access_card_count_included: toInt(row.access_card_count_included),
        access_fee_per_adult_egp: toInt(row.access_fee_per_adult_egp),
        access_fee_per_teen_egp: toInt(row.access_fee_per_teen_egp),
        service_fee_percent: toNum(row.service_fee_percent) ?? 0,
        security_deposit_egp: toInt(row.security_deposit_egp),
        ical_url: emptyToNull(row.ical_url),
        wp_post_id: toInt(row.wp_post_id),
        notes: emptyToNull(row.notes),
        price_currency: emptyToNull(row.price_currency) === 'USD' ? 'USD' : 'EGP',
        featured: toBool(row.featured, false),
        pricing_model: emptyToNull(row.pricing_model) === 'monthly' ? 'monthly' : 'nightly',
        min_nights: toInt(row.min_nights),
        internal_code: emptyToNull(row.internal_code),
        boutique_featured: toBool(row.boutique_featured, false),
        operator_unit_code: emptyToNull(row.operator_unit_code),
        // Ops defaults — missing CSV fields stay empty / defaults
        owner_name: emptyToNull(row.owner_name),
        owner_email: emptyToNull(row.owner_email),
        owner_phone: emptyToNull(row.owner_phone),
        company_commission_pct: toNum(row.company_commission_pct),
        company_commission_owner_pct: toNum(row.company_commission_owner_pct),
        commission_mode: emptyToNull(row.commission_mode) || 'A',
        commission_tenant_pct: toNum(row.commission_tenant_pct),
        utilities_cost: toNum(row.utilities_cost),
        ops_status: emptyToNull(row.ops_status) || 'available',
        unit_number: emptyToNull(row.unit_number) || emptyToNull(row.source_code),
      };

      // Prefer match by id, then slug, then wp_post_id
      let existing = null;
      if (payload.id) {
        const r = await pool.query(`SELECT id FROM units WHERE id = $1`, [payload.id]);
        existing = r.rows[0] || null;
      }
      if (!existing) {
        const r = await pool.query(`SELECT id FROM units WHERE slug = $1`, [payload.slug]);
        existing = r.rows[0] || null;
      }
      if (!existing && payload.wp_post_id) {
        const r = await pool.query(`SELECT id FROM units WHERE wp_post_id = $1`, [payload.wp_post_id]);
        existing = r.rows[0] || null;
      }

      if (existing) {
        await pool.query(
          `UPDATE units SET
             slug = $2,
             title = $3,
             status = $4,
             source = $5,
             source_code = $6,
             source_unit = $7,
             source_url = $8,
             compound = $9,
             project = COALESCE($10, compound),
             area = $11,
             city = $12,
             lat = $13,
             lng = $14,
             view = $15,
             floor = $16,
             property_type = $17,
             beds = $18,
             baths = $19,
             guests = $20,
             size_m2 = $21,
             cover_url = $22,
             photo_urls = $23,
             short_description = $24,
             the_property = $25,
             guest_access = $26,
             neighborhood = $27,
             getting_around = $28,
             other_details = $29,
             amenities = $30,
             price_eid_adha = $31,
             price_june = $32,
             price_june_first_half = $33,
             price_june_second_half = $34,
             price_july = $35,
             price_july_first_half = $36,
             price_july_second_half = $37,
             price_july_august = $38,
             price_august = $39,
             price_september = $40,
             price_september_first_half = $41,
             price_september_second_half = $42,
             price_fallback = $43,
             cleaning_fee_egp = $44,
             access_card_count_included = $45,
             access_fee_per_adult_egp = $46,
             access_fee_per_teen_egp = $47,
             service_fee_percent = $48,
             security_deposit_egp = $49,
             ical_url = $50,
             wp_post_id = COALESCE($51, wp_post_id),
             notes = $52,
             price_currency = $53,
             featured = $54,
             pricing_model = $55,
             min_nights = $56,
             internal_code = $57,
             boutique_featured = $58,
             operator_unit_code = $59,
             owner_name = COALESCE($60, owner_name),
             owner_email = COALESCE($61, owner_email),
             owner_phone = COALESCE($62, owner_phone),
             company_commission_pct = COALESCE($63, company_commission_pct),
             company_commission_owner_pct = COALESCE($64, company_commission_owner_pct),
             commission_mode = COALESCE($65, commission_mode, 'A'),
             commission_tenant_pct = COALESCE($66, commission_tenant_pct),
             utilities_cost = COALESCE($67, utilities_cost),
             ops_status = COALESCE($68, ops_status, 'available'),
             unit_number = COALESCE($69, unit_number),
             updated_at = now()
           WHERE id = $1`,
          [
            existing.id,
            payload.slug,
            payload.title,
            payload.status,
            payload.source,
            payload.source_code,
            payload.source_unit,
            payload.source_url,
            payload.compound,
            payload.project,
            payload.area,
            payload.city,
            payload.lat,
            payload.lng,
            payload.view,
            payload.floor,
            payload.property_type,
            payload.beds,
            payload.baths,
            payload.guests,
            payload.size_m2,
            payload.cover_url,
            payload.photo_urls,
            payload.short_description,
            payload.the_property,
            payload.guest_access,
            payload.neighborhood,
            payload.getting_around,
            payload.other_details,
            payload.amenities,
            payload.price_eid_adha,
            payload.price_june,
            payload.price_june_first_half,
            payload.price_june_second_half,
            payload.price_july,
            payload.price_july_first_half,
            payload.price_july_second_half,
            payload.price_july_august,
            payload.price_august,
            payload.price_september,
            payload.price_september_first_half,
            payload.price_september_second_half,
            payload.price_fallback,
            payload.cleaning_fee_egp,
            payload.access_card_count_included,
            payload.access_fee_per_adult_egp,
            payload.access_fee_per_teen_egp,
            payload.service_fee_percent,
            payload.security_deposit_egp,
            payload.ical_url,
            payload.wp_post_id,
            payload.notes,
            payload.price_currency,
            payload.featured,
            payload.pricing_model,
            payload.min_nights,
            payload.internal_code,
            payload.boutique_featured,
            payload.operator_unit_code,
            payload.owner_name,
            payload.owner_email,
            payload.owner_phone,
            payload.company_commission_pct,
            payload.company_commission_owner_pct,
            payload.commission_mode,
            payload.commission_tenant_pct,
            payload.utilities_cost,
            payload.ops_status,
            payload.unit_number,
          ]
        );
        updated += 1;
      } else {
        await pool.query(
          `INSERT INTO units (
             id, slug, title, status, source, source_code, source_unit, source_url,
             compound, project, area, city, lat, lng, view, floor, property_type,
             beds, baths, guests, size_m2, cover_url, photo_urls,
             short_description, the_property, guest_access, neighborhood, getting_around, other_details,
             amenities,
             price_eid_adha, price_june, price_june_first_half, price_june_second_half,
             price_july, price_july_first_half, price_july_second_half, price_july_august,
             price_august, price_september, price_september_first_half, price_september_second_half,
             price_fallback, cleaning_fee_egp, access_card_count_included,
             access_fee_per_adult_egp, access_fee_per_teen_egp, service_fee_percent, security_deposit_egp,
             ical_url, wp_post_id, notes, price_currency, featured, pricing_model, min_nights,
             internal_code, boutique_featured, operator_unit_code,
             owner_name, owner_email, owner_phone,
             company_commission_pct, company_commission_owner_pct, commission_mode, commission_tenant_pct,
             utilities_cost, ops_status, unit_number
           ) VALUES (
             COALESCE($1::uuid, gen_random_uuid()),
             $2,$3,$4,$5,$6,$7,$8,
             $9,$10,$11,$12,$13,$14,$15,$16,$17,
             $18,$19,$20,$21,$22,$23,
             $24,$25,$26,$27,$28,$29,
             $30,
             $31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,
             $43,$44,$45,$46,$47,$48,$49,
             $50,$51,$52,$53,$54,$55,$56,
             $57,$58,$59,
             $60,$61,$62,
             $63,$64,$65,$66,
             $67,$68,$69
           )`,
          [
            payload.id,
            payload.slug,
            payload.title,
            payload.status,
            payload.source,
            payload.source_code,
            payload.source_unit,
            payload.source_url,
            payload.compound,
            payload.project,
            payload.area,
            payload.city,
            payload.lat,
            payload.lng,
            payload.view,
            payload.floor,
            payload.property_type,
            payload.beds,
            payload.baths,
            payload.guests,
            payload.size_m2,
            payload.cover_url,
            payload.photo_urls,
            payload.short_description,
            payload.the_property,
            payload.guest_access,
            payload.neighborhood,
            payload.getting_around,
            payload.other_details,
            payload.amenities,
            payload.price_eid_adha,
            payload.price_june,
            payload.price_june_first_half,
            payload.price_june_second_half,
            payload.price_july,
            payload.price_july_first_half,
            payload.price_july_second_half,
            payload.price_july_august,
            payload.price_august,
            payload.price_september,
            payload.price_september_first_half,
            payload.price_september_second_half,
            payload.price_fallback,
            payload.cleaning_fee_egp,
            payload.access_card_count_included,
            payload.access_fee_per_adult_egp,
            payload.access_fee_per_teen_egp,
            payload.service_fee_percent,
            payload.security_deposit_egp,
            payload.ical_url,
            payload.wp_post_id,
            payload.notes,
            payload.price_currency,
            payload.featured,
            payload.pricing_model,
            payload.min_nights,
            payload.internal_code,
            payload.boutique_featured,
            payload.operator_unit_code,
            payload.owner_name,
            payload.owner_email,
            payload.owner_phone,
            payload.company_commission_pct,
            payload.company_commission_owner_pct,
            payload.commission_mode || 'A',
            payload.commission_tenant_pct,
            payload.utilities_cost,
            payload.ops_status,
            payload.unit_number,
          ]
        );
        inserted += 1;
      }
    } catch (err) {
      skipped += 1;
      errors.push(`row ${idx + 2} (${cells[3] || cells[4] || '?'}): ${err.message}`);
    }
  }

  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS n FROM units`);
  console.log(JSON.stringify({ inserted, updated, skipped, totalUnits: countRows[0].n, errors: errors.slice(0, 20) }, null, 2));
  if (errors.length > 20) console.log(`…and ${errors.length - 20} more errors`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
