const { query } = require('../config/db');

const CACHE_MS = 30_000;
const cache = new Map();

const UNIT_ORDER_KEY = 'unit_order';
const SITE_CONTENT_KEY = 'site_content';

const DEFAULT_UNIT_ORDER = { mode: 'random', destinations: [] };

const HOME_SECTIONS = ['compounds', 'marquee', 'featured', 'trust', 'interlude', 'host', 'manifesto', 'partners'];

const DEFAULT_SITE_CONTENT = {
  hero: {
    slides: [],
    title_light_en: '',
    title_light_ar: '',
    title_em_en: '',
    title_em_ar: '',
    subtitle_en: '',
    subtitle_ar: '',
  },
  sections: Object.fromEntries(HOME_SECTIONS.map((s) => [s, true])),
  partners: [],
  interlude: { image: '', lead_en: '', lead_ar: '', em_en: '', em_ar: '' },
  host: { image: '', title_en: '', title_ar: '' },
};

let tableChecked = false;
async function ensureSiteSettingsTable() {
  if (tableChecked) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS public.site_settings (
        key text PRIMARY KEY,
        value jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL
      )
    `);
    tableChecked = true;
  } catch (err) {
    console.error('Failed to ensure site_settings table:', err?.message || err);
  }
}

async function getSetting(key, fallback) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value = fallback;
  try {
    await ensureSiteSettingsTable();
    const { rows } = await query(`SELECT value FROM site_settings WHERE key = $1`, [key]);
    if (rows[0]) value = rows[0].value;
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }
  cache.set(key, { value, at: Date.now() });
  return value;
}

async function setSetting(key, value, userId) {
  await ensureSiteSettingsTable();
  const validUserId = typeof userId === 'number' && Number.isInteger(userId) ? userId : null;
  try {
    await query(
      `INSERT INTO site_settings (key, value, updated_at, updated_by)
       VALUES ($1, $2::jsonb, now(), $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [key, JSON.stringify(value), validUserId]
    );
  } catch (err) {
    if (err.code === '23503' || err.code === '42P01') {
      try {
        await query(
          `INSERT INTO site_settings (key, value, updated_at, updated_by)
           VALUES ($1, $2::jsonb, now(), NULL)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = NULL`,
          [key, JSON.stringify(value)]
        );
      } catch (innerErr) {
        console.error('setSetting fallback failed:', innerErr?.message || innerErr);
      }
    } else {
      throw err;
    }
  }
  cache.set(key, { value, at: Date.now() });
  return value;
}

async function getUnitOrder() {
  const raw = await getSetting(UNIT_ORDER_KEY, DEFAULT_UNIT_ORDER);
  return {
    mode: raw?.mode === 'custom' ? 'custom' : 'random',
    destinations: Array.isArray(raw?.destinations) ? raw.destinations.map(String).filter(Boolean) : [],
  };
}

function mergeContent(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    hero: { ...DEFAULT_SITE_CONTENT.hero, ...(src.hero || {}), slides: Array.isArray(src.hero?.slides) ? src.hero.slides : [] },
    sections: { ...DEFAULT_SITE_CONTENT.sections, ...(src.sections || {}) },
    partners: Array.isArray(src.partners) ? src.partners : [],
    interlude: { ...DEFAULT_SITE_CONTENT.interlude, ...(src.interlude || {}) },
    host: { ...DEFAULT_SITE_CONTENT.host, ...(src.host || {}) },
  };
}

async function getSiteContent() {
  return mergeContent(await getSetting(SITE_CONTENT_KEY, DEFAULT_SITE_CONTENT));
}

module.exports = {
  UNIT_ORDER_KEY,
  SITE_CONTENT_KEY,
  HOME_SECTIONS,
  getSetting,
  setSetting,
  getUnitOrder,
  getSiteContent,
  mergeContent,
};
