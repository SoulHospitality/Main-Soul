/**
 * What the guest chatbot can look up. Everything goes through the same guest-facing logic as the
 * website (published short-stay units only, guest prices with markup, the website's availability rules),
 * and only guest-safe fields are returned: no owners, internal codes, commissions, staff or bookings.
 */
const { query } = require('../../config/db');
const { quoteStay, toIsoDate, nightsBetween, todayIsoBusiness } = require('../../services/pricing');
const { applyGuestTenantMarkup } = require('../commission');
const { appendStayAvailabilityFilters, loadTodayPriceMap, projectFacilitiesMap } = require('../../routes/units');

const MAX_RESULTS = 5;
const POOL = 30;
const SITE = () => String(process.env.FRONTEND_URL || 'https://soulhospitality.co').split(',')[0].trim().replace(/\/$/, '');

const unitLink = (slug) => `${SITE()}/listings/${encodeURIComponent(slug)}`;

function money(n) {
  return Math.round(Number(n) || 0);
}

function card(row, price) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    link: unitLink(row.slug),
    image: row.cover_url || (Array.isArray(row.photo_urls) ? row.photo_urls[0] : null) || null,
    destination: [row.compound, row.area].filter(Boolean).join(', '),
    property_type: row.property_type || null,
    bedrooms: row.beds != null ? Number(row.beds) : null,
    bathrooms: row.baths != null ? Number(row.baths) : null,
    max_guests: row.guests != null ? Number(row.guests) : null,
    size_m2: row.size_m2 != null ? Number(row.size_m2) : null,
    rating: Number(row.average_rating) > 0 ? Number(Number(row.average_rating).toFixed(1)) : null,
    reviews: Number(row.review_count) || 0,
    ...price,
  };
}

const UNIT_COLUMNS = `u.id, u.slug, u.title, u.compound, u.project, u.area, u.city, u.beds, u.baths, u.guests, u.cover_url,
  CASE WHEN u.photo_urls IS NULL THEN NULL ELSE u.photo_urls[1:3] END AS photo_urls, u.wp_post_id, u.price_currency,
  u.property_type, u.price_fallback, u.size_m2, u.min_nights, u.commission_mode, u.commission_tenant_pct,
  COALESCE(u.average_rating, 0) AS average_rating, COALESCE(u.review_count, 0) AS review_count`;

/** Published short-stay units only, the same as the website search. */
function baseWhere() {
  return { where: [`u.status = 'published'`, `COALESCE(u.listing_type, 'rent') = 'rent'`], params: [] };
}

async function listDestinations() {
  const { rows } = await query(
    `SELECT COALESCE(NULLIF(trim(area), ''), 'Other') AS area, COALESCE(NULLIF(trim(compound), ''), '') AS compound, count(*)::int AS units
     FROM units WHERE status = 'published' AND COALESCE(listing_type, 'rent') = 'rent'
     GROUP BY 1, 2 ORDER BY 1, 3 DESC`
  );
  const areas = new Map();
  for (const r of rows) {
    if (!areas.has(r.area)) areas.set(r.area, { destination: r.area, units: 0, compounds: [] });
    const a = areas.get(r.area);
    a.units += r.units;
    if (r.compound) a.compounds.push(`${r.compound} (${r.units})`);
  }
  return { destinations: [...areas.values()] };
}

/**
 * Customers name places in Arabic, Franco-Arabic or English; units are stored with English names.
 * Each entry: words the customer may use → what to look for in area / compound / city / title.
 */
const PLACE_ALIASES = [
  { says: ['الساحل', 'الساحل الشمالي', 'ساحل', 'sahel', 'sa7el', 'el sahel', 'north coast', 'northcoast'], match: ['North Coast', 'Sahel'] },
  { says: ['مراسي', 'marassi', 'marasi'], match: ['Marassi'] },
  { says: ['الجونة', 'جونة', 'gouna', 'el gouna', 'elgouna'], match: ['Gouna'] },
  { says: ['السخنة', 'العين السخنة', 'سخنة', 'sokhna', 'ain sokhna', 'el sokhna', 'el-sokhna'], match: ['Sokhna'] },
  { says: ['الغردقة', 'غردقة', 'hurghada', 'ghardaqa'], match: ['Hurghada'] },
  { says: ['شرم', 'شرم الشيخ', 'sharm', 'sharm el sheikh'], match: ['Sharm'] },
  { says: ['دهب', 'dahab'], match: ['Dahab'] },
  { says: ['القاهرة', 'قاهرة', 'cairo'], match: ['Cairo'] },
  { says: ['التجمع', 'القاهرة الجديدة', 'new cairo', 'tagamoa', 'el tagamoa'], match: ['New Cairo', 'Tagamoa'] },
  { says: ['الشيخ زايد', 'زايد', 'sheikh zayed', 'zayed'], match: ['Zayed'] },
  { says: ['العلمين', 'العلمين الجديدة', 'alamein', 'el alamein', 'new alamein'], match: ['Alamein'] },
  { says: ['اسكندرية', 'الإسكندرية', 'الاسكندرية', 'alexandria', 'alex'], match: ['Alexandria', 'Alex'] },
  { says: ['هاسيندا', 'hacienda'], match: ['Hacienda'] },
  { says: ['سيدي عبد الرحمن', 'sidi abdel rahman', 'sidi abd el rahman'], match: ['Sidi Abdel Rahman', 'Sidi Abd'] },
  { says: ['الماظة', 'almaza', 'almaza bay'], match: ['Almaza'] },
  { says: ['مارينا', 'marina'], match: ['Marina'] },
  { says: ['تلال', 'telal'], match: ['Telal'] },
  { says: ['سوما باي', 'سوما', 'soma bay', 'soma'], match: ['Soma'] },
  { says: ['الجلالة', 'جلالة', 'galala', 'el galala'], match: ['Galala'] },
];

function normalizePlace(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ً-ْ]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ILIKE patterns for a destination the customer named (their words plus the English names we store). */
function destinationPatterns(destination) {
  const raw = String(destination || '').trim();
  if (!raw) return [];
  const said = normalizePlace(raw);
  const terms = new Set([raw]);
  for (const place of PLACE_ALIASES) {
    if (place.says.some((w) => said.includes(normalizePlace(w)) || (said.length >= 4 && normalizePlace(w).includes(said)))) {
      place.match.forEach((m) => terms.add(m));
    }
  }
  return [...terms].map((t) => `%${t}%`);
}

/**
 * Up to 5 random matching units the customer hasn't been shown yet. With dates, only units free for
 * the whole stay, priced for the stay; without dates, priced at tonight's rate.
 */
async function searchUnits(input, { shownIds = [] } = {}) {
  const { where, params } = baseWhere();
  let i = 1;
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace(/\$\?/g, `$${i}`));
    i += 1;
  };
  const destination = String(input.destination || '').trim();
  const patterns = destinationPatterns(destination);
  if (patterns.length) {
    add(
      `(u.area ILIKE ANY($?::text[]) OR u.compound ILIKE ANY($?::text[]) OR u.project ILIKE ANY($?::text[]) OR u.city ILIKE ANY($?::text[]) OR u.title ILIKE ANY($?::text[]))`,
      patterns
    );
  }
  const guests = Number(input.guests);
  if (guests > 0) add(`u.guests >= $?`, guests);
  const bedrooms = Number(input.bedrooms);
  if (bedrooms > 0) add(`u.beds >= $?`, bedrooms);
  const type = String(input.property_type || '').trim();
  if (type) add(`u.property_type ILIKE $?`, `%${type}%`);
  if (shownIds.length) add(`NOT (u.id::text = ANY($?::text[]))`, shownIds.map(String));

  const checkIn = toIsoDate(input.check_in);
  const checkOut = toIsoDate(input.check_out);
  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;
  if (checkIn && checkOut && !(nights > 0)) return { error: 'The check-out date must be after the check-in date.' };
  if (checkIn && checkIn < todayIsoBusiness()) return { error: 'The check-in date is in the past.' };
  if (nights > 0) i = appendStayAvailabilityFilters(where, params, i, checkIn, checkOut, nights, { requireNightlyPrices: true });

  const { rows: countRows } = await query(`SELECT count(*)::int AS c FROM units u WHERE ${where.join(' AND ')}`, params);
  const { rows: pool } = await query(
    `SELECT ${UNIT_COLUMNS} FROM units u WHERE ${where.join(' AND ')} ORDER BY random() LIMIT ${POOL}`,
    params
  );

  const minNight = Number(input.min_price_per_night) || 0;
  const maxNight = Number(input.max_price_per_night) || 0;
  const maxTotal = Number(input.max_total_budget) || 0;
  const results = [];
  let outsideBudget = 0;

  if (nights > 0) {
    for (const row of pool) {
      if (results.length >= MAX_RESULTS) break;
      const quote = await quoteStay({ wpPostId: row.wp_post_id, checkin: checkIn, checkout: checkOut, unit: row, adults: guests > 0 ? guests : 1 });
      if (!quote.available) continue;
      const perNight = quote.subtotal / quote.nights;
      if ((maxNight && perNight > maxNight) || (minNight && perNight < minNight) || (maxTotal && quote.total_egp > maxTotal)) {
        outsideBudget += 1;
        continue;
      }
      results.push(card(row, {
        nights: quote.nights,
        avg_price_per_night_egp: money(perNight),
        stay_total_egp: money(quote.total_egp),
        fees_included_egp: money(quote.fees_total),
      }));
    }
  } else {
    const { map } = await loadTodayPriceMap(pool.map((r) => r.wp_post_id));
    for (const row of pool) {
      if (results.length >= MAX_RESULTS) break;
      const raw = map.get(Number(row.wp_post_id)) || Number(row.price_fallback) || 0;
      const price = raw > 0 ? applyGuestTenantMarkup(raw, row) : null;
      if (price && ((maxNight && price > maxNight) || (minNight && price < minNight))) {
        outsideBudget += 1;
        continue;
      }
      results.push(card(row, { price_per_night_from_egp: price ? money(price) : null, min_nights: Number(row.min_nights) || null }));
    }
  }

  return {
    searched: {
      destination: destination || 'any',
      check_in: checkIn || null,
      check_out: checkOut || null,
      guests: guests || null,
      bedrooms: bedrooms || null,
      budget: maxNight || minNight || maxTotal ? { min_per_night: minNight || null, max_per_night: maxNight || null, max_total: maxTotal || null } : null,
    },
    matching_units_not_yet_shown: countRows[0].c,
    skipped_for_budget: outsideBudget,
    prices_note: nights > 0 ? 'stay_total_egp includes cleaning/access/service fees; a refundable security deposit may apply.' : 'Nightly prices change by date; ask for dates to give an exact total.',
    results,
    // With nothing to show, give the model real options instead of letting it guess why.
    ...(results.length
      ? {}
      : {
          note: 'No unit matches all of these. Tell the customer plainly and suggest changing one thing (dates, area, bedrooms, guests or budget). Do not guess a reason.',
          destinations_we_have: (await listDestinations()).destinations.map((d) => `${d.destination} (${d.units} units)`),
        }),
  };
}

async function loadUnitBySlug(slug) {
  const { rows } = await query(
    `SELECT * FROM units WHERE slug = $1 AND status = 'published' AND COALESCE(listing_type, 'rent') = 'rent'`,
    [String(slug || '').trim()]
  );
  return rows[0] || null;
}

function listOf(value) {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (value && typeof value === 'object') return Object.values(value).flat().map((v) => String(v)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    try {
      return listOf(JSON.parse(value));
    } catch {
      return value.split(/[,\n]/).map((v) => v.trim()).filter(Boolean);
    }
  }
  return [];
}

function plain(text, max) {
  return String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function unitDetails(input) {
  const unit = await loadUnitBySlug(input.slug);
  if (!unit) return { error: 'No published unit with that slug.' };
  const facilities = await projectFacilitiesMap([unit.compound || unit.project]);
  const projectFacilities = facilities.get(String(unit.compound || unit.project || '').toLowerCase()) || [];
  const { map } = await loadTodayPriceMap([unit.wp_post_id]);
  const raw = map.get(Number(unit.wp_post_id)) || Number(unit.price_fallback) || 0;
  return {
    ...card(unit, { price_per_night_from_egp: raw > 0 ? money(applyGuestTenantMarkup(raw, unit)) : null }),
    min_nights: Number(unit.min_nights) || null,
    summary: plain(unit.short_description, 400),
    description: plain(unit.description, 1500),
    amenities: listOf(unit.amenities).slice(0, 40),
    compound_facilities: projectFacilities.slice(0, 30),
    security_deposit_egp: Number(unit.security_deposit_egp) > 0 ? money(unit.security_deposit_egp) : null,
    instant_booking: !unit.disable_automatic_reservations,
  };
}

async function checkStay(input) {
  const unit = await loadUnitBySlug(input.slug);
  if (!unit) return { error: 'No published unit with that slug.' };
  const checkIn = toIsoDate(input.check_in);
  const checkOut = toIsoDate(input.check_out);
  if (!checkIn || !checkOut) return { error: 'Both check-in and check-out dates are needed (YYYY-MM-DD).' };
  if (checkIn < todayIsoBusiness()) return { error: 'The check-in date is in the past.' };
  const guests = Number(input.guests) || 1;
  if (unit.guests && guests > Number(unit.guests)) {
    return { available: false, reason: `This unit takes up to ${unit.guests} guests.`, link: unitLink(unit.slug) };
  }
  const quote = await quoteStay({ wpPostId: unit.wp_post_id, checkin: checkIn, checkout: checkOut, unit, adults: guests });
  if (!quote.available) {
    return { available: false, reason: String(quote.reason || 'Not available').replace(/^Date (\S+) is unavailable$/, 'Already booked on $1'), link: unitLink(unit.slug) };
  }
  return {
    available: true,
    title: unit.title,
    link: unitLink(unit.slug),
    check_in: checkIn,
    check_out: checkOut,
    nights: quote.nights,
    nights_subtotal_egp: money(quote.subtotal),
    avg_price_per_night_egp: money(quote.subtotal / quote.nights),
    cleaning_fee_egp: money(quote.cleaning_fee_egp),
    access_fee_egp: money(quote.access_fee_egp),
    service_fee_egp: money(quote.service_fee_egp),
    total_egp: money(quote.total_egp),
    refundable_security_deposit_egp: money(quote.security_deposit_egp) || null,
    book_online: !unit.disable_automatic_reservations,
  };
}

/**
 * Public promo codes running now: active, not expired, not used up. Codes tied to a sales agent are
 * personal to that agent's customers, so they're never offered by the bot.
 */
async function activeOffers() {
  const { rows } = await query(
    `SELECT code, discount_percent, discount_amount, description, expires_at, COALESCE(once_per_guest, true) AS once_per_guest
     FROM promo_codes
     WHERE active = true
       AND (expires_at IS NULL OR expires_at > now())
       AND (max_uses IS NULL OR used_count < max_uses)
       AND sales_person_id IS NULL
     ORDER BY COALESCE(discount_percent, 0) DESC, COALESCE(discount_amount, 0) DESC
     LIMIT 5`
  );
  return {
    offers: rows.map((r) => ({
      code: r.code,
      discount: Number(r.discount_percent) > 0 ? `${Number(r.discount_percent)}% off` : Number(r.discount_amount) > 0 ? `EGP ${money(r.discount_amount)} off` : null,
      details: r.description ? plain(r.description, 200) : null,
      valid_until: r.expires_at ? new Date(r.expires_at).toISOString().slice(0, 10) : null,
      once_per_guest: r.once_per_guest,
    })).filter((o) => o.discount),
    how_to_use: 'Enter the code at checkout on the website; the discount comes off the stay total.',
  };
}

/** Tool definitions sent to the AI. Strict schemas keep the arguments valid. */
const TOOLS = [
  {
    name: 'list_destinations',
    description: 'List the destinations (areas) and compounds where Soul has units, with how many units each has. Use it when the customer is unsure where to go, or to match a place name they mention.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: 'search_units',
    description:
      'Find up to 5 random units that match what the customer wants and that they have not been shown yet. With check_in and check_out, only units free for the whole stay are returned, with the stay total. Call it again for "show me others": units already shown are skipped automatically. Use 0 or an empty string for anything the customer has not said.',
    input_schema: {
      type: 'object',
      properties: {
        destination: { type: 'string', description: 'Area, compound or city in English as in list_destinations, e.g. "North Coast", "Marassi", "El Gouna" (translate Arabic names: الساحل = North Coast). Empty for anywhere.' },
        check_in: { type: 'string', description: 'YYYY-MM-DD, or empty.' },
        check_out: { type: 'string', description: 'YYYY-MM-DD, or empty.' },
        guests: { type: 'integer', description: 'Total number of guests, or 0.' },
        bedrooms: { type: 'integer', description: 'Minimum bedrooms, or 0.' },
        property_type: { type: 'string', description: 'e.g. "Chalet", "Villa", "Apartment", or empty.' },
        min_price_per_night: { type: 'number', description: 'EGP, or 0.' },
        max_price_per_night: { type: 'number', description: 'EGP, or 0.' },
        max_total_budget: { type: 'number', description: 'EGP for the whole stay (needs dates), or 0.' },
      },
      required: ['destination', 'check_in', 'check_out', 'guests', 'bedrooms', 'property_type', 'min_price_per_night', 'max_price_per_night', 'max_total_budget'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'get_unit_details',
    description: 'Full guest details of one unit (description, amenities, compound facilities, bedrooms, guests, minimum nights, deposit) by its slug from search results.',
    input_schema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'], additionalProperties: false },
    strict: true,
  },
  {
    name: 'check_availability_and_price',
    description: 'Check whether one unit is free for exact dates and get the full price for the stay (nights, fees, total, deposit).',
    input_schema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        check_in: { type: 'string', description: 'YYYY-MM-DD' },
        check_out: { type: 'string', description: 'YYYY-MM-DD' },
        guests: { type: 'integer', description: 'Number of guests, or 0 if unknown.' },
      },
      required: ['slug', 'check_in', 'check_out', 'guests'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'get_active_offers',
    description:
      'Promo codes running right now (code, discount, valid until). Check it when you share results or when the customer asks about offers or discounts, and mention a code if there is one. Never invent codes or discounts.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: 'hand_off_to_agent',
    description:
      'Pass the chat to a human reservations agent in the Soul inbox. Use it when the customer asks for something outside units, details, prices and availability (an existing booking, payment, a complaint, a discount or negotiation, special arrangements, owners or partnerships, a job), asks for a person, wants to book and needs help, or you cannot find a suitable unit after a few tries. After calling it, tell the customer an agent will reply here shortly.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Short reason, e.g. "wants a discount", "existing booking change".' },
        summary_for_agent: {
          type: 'string',
          description: 'For the agent, in English: what the customer wants, their details (dates, guests, budget, destination) and the units already suggested.',
        },
      },
      required: ['reason', 'summary_for_agent'],
      additionalProperties: false,
    },
    strict: true,
  },
];

module.exports = { TOOLS, searchUnits, unitDetails, checkStay, listDestinations, activeOffers, unitLink, MAX_RESULTS };
