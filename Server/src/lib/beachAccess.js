/**
 * Beach-access rules by project.
 * - GAIA: night-tiered rates at quote time (no manual unit fields)
 * - IL Monte Galala: fixed 750 / 7 days, extra guest 1000
 * - Hacienda West: flat per stay — studio 10,000 / else 12,000 (not per person)
 * - D-Bay: free
 * - Others: stored unit fields
 */

const { isGaiaUnit } = require('./minStay');

const GALALA_BEACH = { adult: 750, extra: 1000, days: 7 };
const HACIENDA_WEST_BEACH = { studio: 10000, other: 12000 };

function projectText(unit = {}) {
  return [
    unit.project,
    unit.projectName,
    unit.project_name,
    unit.compound,
  ]
    .map((v) => String(v || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function isIlMonteGalalaUnit(unit = {}) {
  const s = projectText(unit);
  if (!s) return false;
  // IL Monte Galala / Ilmonte Galala / Monte Galala
  return /(?:il\s*)?monte\s*galala|ilmonte\s*galala/.test(s);
}

function isHaciendaWestUnit(unit = {}) {
  const s = projectText(unit);
  if (!s) return false;
  return /hacienda\s*west/.test(s);
}

/** Studio by type name, or 0 / empty bedrooms. */
function isStudioUnit(unit = {}) {
  const type = String(unit.property_type || unit.type || '').trim().toLowerCase();
  if (type.includes('studio')) return true;
  const beds = Number(unit.beds ?? unit.bedrooms);
  if (Number.isFinite(beds) && beds <= 0) return true;
  return false;
}

function isFreeBeachProject(unit = {}) {
  const s = projectText(unit);
  if (!s) return false;
  // D-Bay only — Hacienda West has flat paid beach access
  if (/\bd[-\s]?bay\b/.test(s)) return true;
  return false;
}

function haciendaWestFlatFee(unit = {}) {
  return isStudioUnit(unit) ? HACIENDA_WEST_BEACH.studio : HACIENDA_WEST_BEACH.other;
}

/** Beach fields are entered manually only for standard rentals. */
function beachAccessRequiresManualEntry(unit = {}) {
  if (String(unit?.listing_type || 'rent').toLowerCase() === 'sale') return false;
  if (isGaiaUnit(unit)) return false;
  if (isIlMonteGalalaUnit(unit)) return false;
  if (isHaciendaWestUnit(unit)) return false;
  if (isFreeBeachProject(unit)) return false;
  return true;
}

/**
 * @returns {{
 *   adult: number,
 *   extra: number,
 *   days: number,
 *   mode: 'gaia'|'galala'|'free'|'hacienda_flat'|'manual',
 *   billing?: 'per_guest'|'flat',
 *   flat?: number
 * }}
 */
function resolveBeachAccessRates(unit = {}, nights = 0) {
  if (isFreeBeachProject(unit)) {
    return { adult: 0, extra: 0, days: 7, mode: 'free', billing: 'flat', flat: 0 };
  }

  if (isHaciendaWestUnit(unit)) {
    const flat = haciendaWestFlatFee(unit);
    return {
      adult: flat,
      extra: 0,
      days: 7,
      mode: 'hacienda_flat',
      billing: 'flat',
      flat,
    };
  }

  if (isGaiaUnit(unit)) {
    const n = Math.max(0, Number(nights) || 0);
    if (n <= 3) {
      return { adult: 1900, extra: 2500, days: 3, mode: 'gaia', billing: 'per_guest' };
    }
    if (n === 4) {
      return { adult: 2500, extra: 3100, days: 4, mode: 'gaia', billing: 'per_guest' };
    }
    // nights > 4 → 3500 / 7 nights period
    return { adult: 3500, extra: 4100, days: 7, mode: 'gaia', billing: 'per_guest' };
  }

  if (isIlMonteGalalaUnit(unit)) {
    return { ...GALALA_BEACH, mode: 'galala', billing: 'per_guest' };
  }

  const adult = Number(unit.access_fee_per_adult_egp ?? unit.beach_access_price ?? 0);
  const extra = Number(unit.access_fee_per_teen_egp ?? unit.beach_access_extra_guest ?? 0);
  const days = Number(unit.access_card_count_included ?? unit.beach_access_days ?? 7) || 7;
  return {
    adult: Number.isFinite(adult) ? adult : 0,
    extra: Number.isFinite(extra) ? extra : 0,
    days,
    mode: 'manual',
    billing: 'per_guest',
  };
}

/** Total beach access fee for a stay (respects flat vs per-guest billing). */
function computeBeachAccessFee(unit = {}, { nights = 0, adults = 1, teens = 0 } = {}) {
  const beach = resolveBeachAccessRates(unit, nights);
  if (beach.billing === 'flat' || beach.mode === 'hacienda_flat' || beach.mode === 'free') {
    const fee = Number(beach.flat != null ? beach.flat : beach.adult) || 0;
    return { fee, beach };
  }
  const accessAdult = Number(beach.adult || 0) * Math.max(0, Number(adults) || 0);
  const accessTeen = Number(beach.extra || 0) * Math.max(0, Number(teens) || 0);
  return { fee: accessAdult + accessTeen, beach };
}

/**
 * Values to persist on create/update for rent units.
 * GAIA → null; Galala → fixed; Hacienda → flat by unit type; free → 0; else passthrough.
 */
function beachAccessPersistValues(unit = {}, incoming = {}) {
  if (String(unit?.listing_type || incoming.listing_type || 'rent').toLowerCase() === 'sale') {
    return { adult: null, extra: null, days: null };
  }
  const ctx = { ...unit, ...incoming };
  if (isGaiaUnit(ctx)) {
    return { adult: null, extra: null, days: null };
  }
  if (isIlMonteGalalaUnit(ctx)) {
    return { adult: GALALA_BEACH.adult, extra: GALALA_BEACH.extra, days: GALALA_BEACH.days };
  }
  if (isHaciendaWestUnit(ctx)) {
    const flat = haciendaWestFlatFee(ctx);
    return { adult: flat, extra: 0, days: 7 };
  }
  if (isFreeBeachProject(ctx)) {
    return { adult: 0, extra: 0, days: 7 };
  }
  return null; // caller keeps form values
}

module.exports = {
  isFreeBeachProject,
  isHaciendaWestUnit,
  isStudioUnit,
  isIlMonteGalalaUnit,
  beachAccessRequiresManualEntry,
  resolveBeachAccessRates,
  computeBeachAccessFee,
  beachAccessPersistValues,
  haciendaWestFlatFee,
  GALALA_BEACH,
  HACIENDA_WEST_BEACH,
};
