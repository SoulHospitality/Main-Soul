const express = require('express');
const { query } = require('../config/db');
const { activeOffers } = require('../lib/offers');
const { appliesToUnit, isEverywhere } = require('../lib/offerScope');

const router = express.Router();

function publicOffer(o) {
  return {
    id: o.id,
    name: o.name,
    name_ar: o.name_ar,
    description: o.description,
    description_ar: o.description_ar,
    discount_percent: o.discount_percent,
    ends_on: o.ends_on,
    image_url: o.image_url,
    show_popup: o.show_popup,
    everywhere: isEverywhere(o),
    projects: o.projects,
    destinations: o.destinations,
  };
}

/**
 * Offers for the website. With ?unit= (id or slug) only the offers covering that unit; with
 * ?destination= / ?project= the offers for that place; with nothing, the offers for every unit.
 */
router.get('/', async (req, res, next) => {
  try {
    const offers = await activeOffers();
    const unitKey = String(req.query.unit || '').trim();
    const destination = String(req.query.destination || '').trim();
    const project = String(req.query.project || req.query.compound || '').trim();
    let list;
    if (unitKey) {
      const { rows } = await query(
        `SELECT id, compound, project, area FROM units WHERE id::text = $1 OR slug = $1 LIMIT 1`,
        [unitKey]
      );
      list = rows[0] ? offers.filter((o) => appliesToUnit(o, rows[0])) : [];
    } else if (destination || project) {
      list = offers.filter((o) => isEverywhere(o) || appliesToUnit({ ...o, unit_ids: [] }, { area: destination, compound: project }));
    } else {
      list = offers.filter((o) => isEverywhere(o));
    }
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ items: list.map(publicOffer) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
