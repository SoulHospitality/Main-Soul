const { q } = require('./db');

// Every tunable business rule lives here so management can change it from the UI.
const DEFAULTS = {
  company_name: 'Soul Hospitality',

  // Working hours (Cairo time). Inside them the SLA clock runs and chats are routed;
  // outside them the AI (or a fixed message) answers and the clock waits for business_start.
  business_start: '10:00',
  business_end: '24:00',
  night_mode: 'ai', // 'ai' | 'message' | 'off'
  night_message:
    'أهلاً بيك في Soul Hospitality 🌊\nفريق الحجوزات متاح من الساعة 10 الصبح. ابعتلنا المشروع اللي حابب تحجز فيه، تاريخ الوصول والمغادرة، وعدد الأفراد، وأول ما الفريق يبدأ هنرد عليك فوراً.\n\nWelcome to Soul Hospitality! Our reservations team is available from 10 AM. Send us the project, dates and number of guests and we will get back to you first thing.',
  night_ai_max_replies: 4,

  // SLA
  sla_target_min: 15,
  sla_warning_min: 10,
  reassign_on_breach: true,
  reassign_window_min: 10,
  max_auto_reassign: 2,
  escalate_supervisor_min: 30,
  escalate_manager_min: 60,
  comment_sla_min: 60,
  follow_up_escalate_min: 60,

  // Routing
  allow_agent_claim: true,
  presence_timeout_min: 3,

  // Messaging policy
  messenger_human_agent_tag: false,

  // AI
  ai_enabled: true,
  ai_auto_classify: true,
  knowledge_base:
    'Soul Hospitality manages furnished holiday homes on behalf of owners in Egypt.\nPrices, availability and booking confirmations are ONLY given by the reservations team.\nA deposit is required to confirm a booking.',

  // Extra projects on top of the PMS destinations (e.g. "Other").
  extra_projects: ['Other'],
  lead_sources: [
    'facebook_ad', 'instagram_ad', 'messenger', 'instagram_dm', 'whatsapp', 'facebook_comment',
    'instagram_comment', 'broker', 'referral', 'repeat_guest', 'website', 'influencer', 'other',
  ],
};

const TTL_MS = 30000;
let cache = null;
let loadedAt = 0;
let projectsCache = null;
let projectsAt = 0;

async function loadSettings(force = false) {
  if (!force && cache && Date.now() - loadedAt < TTL_MS) return cache;
  const next = { ...DEFAULTS };
  try {
    for (const row of await q.all('SELECT key, value FROM inbox_settings')) {
      if (row.key in DEFAULTS) next[row.key] = row.value;
    }
  } catch (err) {
    if (!cache) console.warn('[inbox] settings not loaded:', err.message);
  }
  cache = next;
  loadedAt = Date.now();
  return cache;
}

/** Synchronous read of the last loaded settings (routes and the SLA loop refresh them first). */
function getSettings() {
  return cache || { ...DEFAULTS };
}

function setting(key) {
  return getSettings()[key];
}

async function updateSettings(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULTS)) continue;
    await q.run(
      'INSERT INTO inbox_settings (key, value) VALUES (?, ?::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      key, JSON.stringify(value),
    );
  }
  return loadSettings(true);
}

/** PMS destinations (projects) plus any extras configured for the inbox. */
async function getProjects() {
  if (projectsCache && Date.now() - projectsAt < 5 * 60000) return projectsCache;
  let names = [];
  try {
    const rows = await q.all('SELECT name FROM location_projects ORDER BY sort_order ASC, destination ASC, name ASC');
    names = rows.map((r) => r.name).filter(Boolean);
  } catch {
    const rows = await q.all('SELECT DISTINCT compound AS name FROM units WHERE compound IS NOT NULL ORDER BY 1').catch(() => []);
    names = rows.map((r) => r.name).filter(Boolean);
  }
  const extras = getSettings().extra_projects || [];
  projectsCache = [...new Set([...names, ...extras])];
  projectsAt = Date.now();
  return projectsCache;
}

module.exports = { DEFAULTS, loadSettings, getSettings, setting, updateSettings, getProjects };
