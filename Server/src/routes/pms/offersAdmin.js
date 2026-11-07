const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { scopeFrom } = require('../../lib/offerScope');
const { mapOffer, clearOfferCache } = require('../../lib/offers');
const { logAudit } = require('../../lib/audit');

const router = express.Router();
const ROLES = ['admin', 'marketing_pr'];

const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '').slice(0, 10)) ? String(v).slice(0, 10) : null);
const text = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);

function offerFrom(b, existing = {}) {
  const pick = (k) => (b[k] !== undefined ? b[k] : existing[k]);
  const name = text(pick('name'), 80);
  if (!name) throw Object.assign(new Error('Give the offer a name'), { status: 400 });
  const percent = Number(pick('discount_percent'));
  if (!(percent > 0 && percent < 100)) throw Object.assign(new Error('The discount must be between 1% and 99%'), { status: 400 });
  const startsOn = b.starts_on !== undefined ? isoDate(b.starts_on) : existing.starts_on || null;
  const endsOn = b.ends_on !== undefined ? isoDate(b.ends_on) : existing.ends_on || null;
  if (startsOn && endsOn && endsOn < startsOn) throw Object.assign(new Error('The offer must end on or after it starts'), { status: 400 });
  const scope = b.unit_ids !== undefined || b.projects !== undefined || b.destinations !== undefined
    ? scopeFrom({
      unit_ids: b.unit_ids ?? existing.unit_ids,
      projects: b.projects ?? existing.projects,
      destinations: b.destinations ?? existing.destinations,
    })
    : { unit_ids: existing.unit_ids || [], projects: existing.projects || [], destinations: existing.destinations || [] };
  return {
    name,
    name_ar: text(pick('name_ar'), 80),
    description: text(pick('description'), 400),
    description_ar: text(pick('description_ar'), 400),
    discount_percent: Math.round(percent * 100) / 100,
    starts_on: startsOn,
    ends_on: endsOn,
    show_popup: pick('show_popup') !== false && pick('show_popup') !== 0,
    image_url: text(pick('image_url'), 1000),
    active: pick('active') !== false && pick('active') !== 0,
    ...scope,
  };
}

router.get('/offers', requireRoles(...ROLES), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT o.*, s.full_name AS created_by_name,
              (SELECT COUNT(*)::int FROM bookings b WHERE b.offer_id = o.id) AS bookings
       FROM offers o LEFT JOIN staff_users s ON s.id = o.created_by
       ORDER BY o.active DESC, o.created_at DESC`
    );
    res.json(rows.map(mapOffer));
  } catch (e) {
    if (e.code === '42P01') return res.json([]);
    next(e);
  }
});

router.post('/offers', requireRoles(...ROLES), async (req, res, next) => {
  try {
    const o = offerFrom(req.body || {});
    const { rows } = await query(
      `INSERT INTO offers (name, name_ar, description, description_ar, discount_percent, starts_on, ends_on,
         show_popup, image_url, active, unit_ids, projects, destinations, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11::uuid[],$12::text[],$13::text[],$14)
       RETURNING *`,
      [o.name, o.name_ar, o.description, o.description_ar, o.discount_percent, o.starts_on, o.ends_on,
        o.show_popup, o.image_url, o.active, o.unit_ids, o.projects, o.destinations, req.user.id]
    );
    clearOfferCache();
    await logAudit({ userId: req.user.id, action: 'OFFER_CREATE', entityType: 'offer', entityId: rows[0].id, details: o });
    res.status(201).json(mapOffer(rows[0]));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

router.put('/offers/:id', requireRoles(...ROLES), async (req, res, next) => {
  try {
    const { rows: found } = await query(`SELECT * FROM offers WHERE id = $1`, [req.params.id]);
    if (!found[0]) return res.status(404).json({ error: 'Offer not found' });
    const o = offerFrom(req.body || {}, mapOffer(found[0]));
    const { rows } = await query(
      `UPDATE offers SET name = $2, name_ar = $3, description = $4, description_ar = $5, discount_percent = $6,
         starts_on = $7::date, ends_on = $8::date, show_popup = $9, image_url = $10, active = $11,
         unit_ids = $12::uuid[], projects = $13::text[], destinations = $14::text[], updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, o.name, o.name_ar, o.description, o.description_ar, o.discount_percent, o.starts_on, o.ends_on,
        o.show_popup, o.image_url, o.active, o.unit_ids, o.projects, o.destinations]
    );
    clearOfferCache();
    await logAudit({ userId: req.user.id, action: 'OFFER_UPDATE', entityType: 'offer', entityId: rows[0].id, details: o });
    res.json(mapOffer(rows[0]));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

router.delete('/offers/:id', requireRoles(...ROLES), async (req, res, next) => {
  try {
    const { rows } = await query(`DELETE FROM offers WHERE id = $1 RETURNING id, name`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Offer not found' });
    clearOfferCache();
    await logAudit({ userId: req.user.id, action: 'OFFER_DELETE', entityType: 'offer', entityId: rows[0].id, details: { name: rows[0].name } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
