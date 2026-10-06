const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { upload, attachCloudinaryUrls, setCloudinaryFolder, FOLDER_SITE } = require('../../config/cloudinary');
const {
  UNIT_ORDER_KEY,
  SITE_CONTENT_KEY,
  setSetting,
  getUnitOrder,
  getSiteContent,
  mergeContent,
} = require('../../lib/siteSettings');

const router = express.Router();

const WEBSITE_ROLES = ['admin', 'web_developer', 'marketing_pr'];

const cleanText = (v, max = 600) => String(v ?? '').trim().slice(0, max);
const cleanUrl = (v) => {
  const s = cleanText(v, 1000);
  return /^(https?:\/\/|\/)/i.test(s) ? s : '';
};

function sanitizeContent(body) {
  const merged = mergeContent(body);
  return {
    hero: {
      slides: merged.hero.slides
        .map((s) => ({ src: cleanUrl(s?.src), caption_en: cleanText(s?.caption_en, 160), caption_ar: cleanText(s?.caption_ar, 160) }))
        .filter((s) => s.src)
        .slice(0, 8),
      title_light_en: cleanText(merged.hero.title_light_en, 80),
      title_light_ar: cleanText(merged.hero.title_light_ar, 80),
      title_em_en: cleanText(merged.hero.title_em_en, 80),
      title_em_ar: cleanText(merged.hero.title_em_ar, 80),
      subtitle_en: cleanText(merged.hero.subtitle_en, 400),
      subtitle_ar: cleanText(merged.hero.subtitle_ar, 400),
    },
    sections: Object.fromEntries(Object.entries(merged.sections).map(([k, v]) => [k, v !== false])),
    partners: merged.partners
      .map((p) => ({ label: cleanText(p?.label, 80), src: cleanUrl(p?.src) }))
      .filter((p) => p.src)
      .slice(0, 30),
    interlude: {
      image: cleanUrl(merged.interlude.image),
      lead_en: cleanText(merged.interlude.lead_en, 80),
      lead_ar: cleanText(merged.interlude.lead_ar, 80),
      em_en: cleanText(merged.interlude.em_en, 80),
      em_ar: cleanText(merged.interlude.em_ar, 80),
    },
    host: {
      image: cleanUrl(merged.host.image),
      title_en: cleanText(merged.host.title_en, 120),
      title_ar: cleanText(merged.host.title_ar, 120),
    },
  };
}

router.get('/site-settings/content', requireRoles(...WEBSITE_ROLES), async (_req, res, next) => {
  try {
    res.json(await getSiteContent());
  } catch (e) {
    next(e);
  }
});

router.put('/site-settings/content', requireRoles(...WEBSITE_ROLES), async (req, res, next) => {
  try {
    const content = sanitizeContent(req.body || {});
    await setSetting(SITE_CONTENT_KEY, content, req.user.id);
    res.json(content);
  } catch (e) {
    next(e);
  }
});

router.post(
  '/site-settings/upload',
  requireRoles(...WEBSITE_ROLES),
  setCloudinaryFolder(FOLDER_SITE),
  upload.single('image'),
  attachCloudinaryUrls,
  async (req, res) => {
    const url = req.file?.secure_url || req.file?.path || null;
    if (!url) return res.status(400).json({ error: 'Upload an image' });
    res.json({ url });
  }
);

router.get('/site-settings/unit-order', requireRoles(...WEBSITE_ROLES), async (_req, res, next) => {
  try {
    const order = await getUnitOrder();
    const { rows } = await query(
      `SELECT id, title, unit_number, compound, area, cover_url, display_order
       FROM units
       WHERE status = 'published' AND COALESCE(listing_type, 'rent') = 'rent'
       ORDER BY area, display_order NULLS LAST, title`
    );
    const areas = [...new Set(rows.map((r) => r.area).filter(Boolean))];
    const rank = (d) => {
      const idx = order.destinations.findIndex((x) => x.toLowerCase() === String(d).toLowerCase());
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    };
    const destinations = areas.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    res.json({
      mode: order.mode,
      destinations: destinations.map((name) => ({ name, units: rows.filter((r) => r.area === name) })),
    });
  } catch (e) {
    next(e);
  }
});

router.put('/site-settings/unit-order', requireRoles(...WEBSITE_ROLES), async (req, res, next) => {
  try {
    const destinations = (Array.isArray(req.body?.destinations) ? req.body.destinations : [])
      .map((d) => ({
        name: cleanText(d?.name, 120),
        unit_ids: (Array.isArray(d?.unit_ids) ? d.unit_ids : []).map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
      }))
      .filter((d) => d.name);
    await setSetting(UNIT_ORDER_KEY, { mode: 'custom', destinations: destinations.map((d) => d.name) }, req.user.id);
    for (const d of destinations) {
      if (!d.unit_ids.length) continue;
      await query(
        `UPDATE units u SET display_order = o.pos
         FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, pos)
         WHERE u.id = o.id`,
        [d.unit_ids]
      );
    }
    res.json({ ok: true, mode: 'custom' });
  } catch (e) {
    next(e);
  }
});

router.post('/site-settings/unit-order/reset-random', requireRoles(...WEBSITE_ROLES), async (req, res, next) => {
  try {
    await query(`UPDATE units SET display_order = NULL WHERE display_order IS NOT NULL`);
    await setSetting(UNIT_ORDER_KEY, { mode: 'random', destinations: [] }, req.user.id);
    res.json({ ok: true, mode: 'random' });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
