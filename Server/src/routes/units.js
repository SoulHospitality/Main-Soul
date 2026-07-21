const express = require('express');
const { query } = require('../config/db');
const { quoteStay, getBlockedDates } = require('../services/pricing');

const router = express.Router();

/** Fields guests must never see (ops / owner / unit codes). */
const GUEST_UNIT_OMIT = new Set([
  'unit_number',
  'internal_code',
  'operator_unit_code',
  'source_code',
  'source_unit',
  'source_url',
  'owner_name',
  'owner_email',
  'owner_phone',
  'company_commission_pct',
  'company_commission_owner_pct',
  'commission_mode',
  'commission_tenant_pct',
  'utilities_cost',
  'ops_status',
  'created_by_staff',
  'notes',
  'other_details',
  'last_scrape_at',
  'last_scrape_status',
  'consecutive_scrape_failures',
  'last_failure_reason',
  'last_failure_at',
  'consecutive_missing_from_discovery',
]);

function toPublicUnit(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (GUEST_UNIT_OMIT.has(k)) continue;
    out[k] = v;
  }
  return out;
}

function facilitiesFromOtherDetails(row) {
  try {
    const details =
      typeof row?.other_details === 'string' ? JSON.parse(row.other_details) : row?.other_details;
    if (Array.isArray(details?.facilities)) {
      return details.facilities.map((f) => String(f || '').trim()).filter(Boolean);
    }
  } catch {
    /* ignore */
  }
  return [];
}

async function projectFacilitiesMap(projectNames) {
  const names = [...new Set(projectNames.map((n) => String(n || '').trim()).filter(Boolean))];
  if (!names.length) return new Map();
  const { rows } = await query(
    `SELECT name, COALESCE(facilities, '{}'::text[]) AS facilities
     FROM location_projects
     WHERE lower(trim(name)) = ANY($1::text[])`,
    [names.map((n) => n.toLowerCase())]
  );
  const map = new Map();
  for (const r of rows) {
    map.set(String(r.name).toLowerCase(), Array.isArray(r.facilities) ? r.facilities : []);
  }
  return map;
}

function attachFacilities(row, facilitiesByProject) {
  const out = toPublicUnit(row);
  const key = String(row.compound || row.project || '').trim().toLowerCase();
  const fromProject = key ? facilitiesByProject.get(key) || [] : [];
  const fromUnit = facilitiesFromOtherDetails(row);
  // Prefer project-level facilities; fall back to legacy unit facilities (published units).
  out.facilities = fromProject.length ? fromProject : fromUnit;
  return out;
}

router.get('/', async (req, res, next) => {
  try {
    const {
      compound,
      area,
      destination,
      project,
      projectName,
      beds,
      guests,
      featured,
      q,
      type,
      types,
      property_type,
      status = 'published',
      listing_type: listingTypeParam,
      limit = 24,
      offset = 0,
    } = req.query;

    const listingType = String(listingTypeParam || 'rent').toLowerCase() === 'sale' ? 'sale' : 'rent';
    const where = ["u.status = $1", `COALESCE(u.listing_type, 'rent') = $2`];
    const params = [status, listingType];
    let i = 3;

    // SoulHospitality aliases: destination → area, project/projectName → compound
    const compoundFilter = compound || projectName || project;
    const areaFilter = area || destination;

    if (compoundFilter) {
      where.push(`u.compound ILIKE $${i++}`);
      params.push(compoundFilter);
    }
    if (areaFilter) {
      where.push(`u.area ILIKE $${i++}`);
      params.push(areaFilter);
    }
    if (beds) {
      where.push(`u.beds >= $${i++}`);
      params.push(Number(beds));
    }
    if (guests) {
      where.push(`u.guests >= $${i++}`);
      params.push(Number(guests));
    }
    if (featured === 'true') where.push('u.featured = true');
    if (q) {
      where.push(`(u.title ILIKE $${i} OR u.compound ILIKE $${i} OR u.short_description ILIKE $${i})`);
      params.push(`%${q}%`);
      i++;
    }

    const typeRaw = types || type || property_type || '';
    const typeList = String(typeRaw)
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (typeList.length === 1) {
      where.push(`u.property_type ILIKE $${i++}`);
      params.push(typeList[0]);
    } else if (typeList.length > 1) {
      const placeholders = typeList.map(() => `$${i++}`);
      where.push(`u.property_type ILIKE ANY(ARRAY[${placeholders.join(', ')}])`);
      params.push(...typeList);
    }

    params.push(Number(limit), Number(offset));
    // Card/list projection: skip heavy detail fields and cap gallery to 5 photos.
    const sql = `
      SELECT u.id, u.slug, u.title, u.status, u.compound, u.area, u.city, u.beds, u.baths, u.guests,
             u.cover_url,
             CASE
               WHEN u.photo_urls IS NULL THEN NULL
               ELSE u.photo_urls[1:5]
             END AS photo_urls,
             u.wp_post_id, u.featured, u.price_currency, u.property_type, u.price_fallback,
             u.size_m2, u.listing_type, u.created_at,
             COALESCE(u.average_rating, 0) AS average_rating,
             COALESCE(u.review_count, 0) AS review_count
      FROM units u
      WHERE ${where.join(' AND ')}
      ORDER BY u.featured DESC, u.created_at DESC
      LIMIT $${i++} OFFSET $${i}
    `;
    const { rows } = await query(sql, params);
    const countRes = await query(
      `SELECT count(*)::int AS c FROM units u WHERE ${where.join(' AND ')}`,
      params.slice(0, -2)
    );
    const facilitiesByProject = await projectFacilitiesMap(rows.map((r) => r.compound || r.project));
    res.json({
      items: rows.map((r) => attachFacilities(r, facilitiesByProject)),
      total: countRes.rows[0].c,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/compounds', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT compound AS name, count(*)::int AS listings
       FROM units WHERE status = 'published' AND COALESCE(listing_type, 'rent') = 'rent'
       GROUP BY compound ORDER BY compound`
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:idOrSlug', async (req, res, next) => {
  try {
    const key = req.params.idOrSlug;
    const isUuid = /^[0-9a-f-]{36}$/i.test(key);
    const { rows } = await query(
      isUuid ? 'SELECT * FROM units WHERE id = $1' : 'SELECT * FROM units WHERE slug = $1',
      [key]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Unit not found' });
    const facilitiesByProject = await projectFacilitiesMap([
      rows[0].compound || rows[0].project,
    ]);
    res.json(attachFacilities(rows[0], facilitiesByProject));
  } catch (err) {
    next(err);
  }
});

router.get('/:idOrSlug/availability', async (req, res, next) => {
  try {
    const unit = await loadUnit(req.params.idOrSlug);
    if (!unit?.wp_post_id) return res.status(404).json({ error: 'Unit not found' });
    const from = req.query.from || new Date().toISOString().slice(0, 10);
    const toDate = new Date(from);
    toDate.setMonth(toDate.getMonth() + 6);
    const to = req.query.to || toDate.toISOString().slice(0, 10);
    const blocked = await getBlockedDates(unit.wp_post_id, from, to);
    res.json({ wp_post_id: unit.wp_post_id, from, to, blocked });
  } catch (err) {
    next(err);
  }
});

router.get('/:idOrSlug/pricing', async (req, res, next) => {
  try {
    const unit = await loadUnit(req.params.idOrSlug);
    if (!unit?.wp_post_id) return res.status(404).json({ error: 'Unit not found' });
    const from = req.query.from || new Date().toISOString().slice(0, 10);
    const toDate = new Date(from);
    toDate.setMonth(toDate.getMonth() + 3);
    const to = req.query.to || toDate.toISOString().slice(0, 10);
    const { rows } = await query(
      `SELECT date::text AS date, price, currency, source
       FROM unit_daily_prices
       WHERE wp_post_id = $1 AND date >= $2 AND date < $3
       ORDER BY date`,
      [unit.wp_post_id, from, to]
    );
    const map = {};
    for (const r of rows) map[r.date] = r.price;
    res.json({ wp_post_id: unit.wp_post_id, prices: map, rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:idOrSlug/quote', async (req, res, next) => {
  try {
    const { checkin, checkout, adults, teens, guests } = req.query;
    const unit = await loadUnit(req.params.idOrSlug);
    if (!unit?.wp_post_id) return res.status(404).json({ error: 'Unit not found' });
    const adultCount = Number(adults || guests || 1);
    const teenCount = Number(teens || 0);
    const quote = await quoteStay({
      wpPostId: unit.wp_post_id,
      checkin,
      checkout,
      unit,
      adults: adultCount,
      teens: teenCount,
    });
    res.json({ unit_id: unit.id, slug: unit.slug, ...quote });
  } catch (err) {
    next(err);
  }
});

router.get('/:idOrSlug/reviews', async (req, res, next) => {
  try {
    const unit = await loadUnit(req.params.idOrSlug);
    if (!unit) return res.status(404).json({ error: 'Unit not found' });
    const { mapReview } = require('./reviews');
    const { rows } = await query(
      `SELECT * FROM reviews WHERE (unit_id = $1 OR listing_wp_id = $2) AND published = true
       ORDER BY created_at DESC`,
      [unit.id, unit.wp_post_id]
    );
    res.json({
      items: rows.map(mapReview),
      average_rating: Number(unit.average_rating || 0),
      review_count: Number(unit.review_count || 0),
    });
  } catch (err) {
    next(err);
  }
});

async function loadUnit(idOrSlug) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(idOrSlug);
  const { rows } = await query(
    isUuid ? 'SELECT * FROM units WHERE id = $1' : 'SELECT * FROM units WHERE slug = $1',
    [idOrSlug]
  );
  return rows[0] || null;
}

module.exports = router;
