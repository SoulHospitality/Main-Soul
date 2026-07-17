const express = require('express');
const { query } = require('../config/db');
const { quoteStay, getBlockedDates } = require('../services/pricing');

const router = express.Router();

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
      limit = 24,
      offset = 0,
    } = req.query;

    const where = ['u.status = $1'];
    const params = [status];
    let i = 2;

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
    const sql = `
      SELECT u.id, u.slug, u.title, u.status, u.compound, u.area, u.city, u.beds, u.baths, u.guests, u.size_m2,
             u.cover_url, u.photo_urls, u.short_description, u.amenities, u.wp_post_id, u.featured,
             u.price_currency, u.min_nights, u.cleaning_fee_egp, u.service_fee_percent,
             u.security_deposit_egp, u.lat, u.lng, u.property_type, u.view, u.floor, u.price_fallback,
             u.created_at,
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
    res.json({ items: rows, total: countRes.rows[0].c });
  } catch (err) {
    next(err);
  }
});

router.get('/compounds', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT compound AS name, count(*)::int AS listings
       FROM units WHERE status = 'published'
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
    res.json(rows[0]);
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
