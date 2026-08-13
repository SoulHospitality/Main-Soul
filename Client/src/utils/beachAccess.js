import { isGaiaUnit } from './bookingRules';

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

export function isIlMonteGalalaUnit(unit = {}) {
  const s = projectText(unit);
  if (!s) return false;
  return /(?:il\s*)?monte\s*galala|ilmonte\s*galala/.test(s);
}

export function isFoukaBayUnit(unit = {}) {
  const s = projectText(unit);
  if (!s) return false;
  return /fouka/.test(s);
}

export function isHaciendaWestUnit(unit = {}) {
  const s = projectText(unit);
  if (!s) return false;
  return /hacienda\s*west/.test(s);
}


export function isStudioUnit(unit = {}) {
  const type = String(unit.property_type || unit.type || '').trim().toLowerCase();
  if (type.includes('studio')) return true;
  const beds = Number(unit.beds ?? unit.bedrooms);
  if (Number.isFinite(beds) && beds <= 0) return true;
  return false;
}

export function isFreeBeachProject(unit = {}) {
  const s = projectText(unit);
  if (!s) return false;
  
  if (/\bd[-\s]?bay\b/.test(s)) return true;
  return false;
}

export function haciendaWestFlatFee(unit = {}) {
  return isStudioUnit(unit) ? HACIENDA_WEST_BEACH.studio : HACIENDA_WEST_BEACH.other;
}

export function beachAccessRequiresManualEntry(unit = {}) {
  if (String(unit?.listing_type || 'rent').toLowerCase() === 'sale') return false;
  if (isGaiaUnit(unit)) return false;
  if (isIlMonteGalalaUnit(unit)) return false;
  if (isHaciendaWestUnit(unit)) return false;
  if (isFreeBeachProject(unit)) return false;
  return true;
}


export function resolveBeachAccessRates(unit = {}, nights = 0) {
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
    if (n <= 3) return { adult: 1900, extra: 2500, days: 3, mode: 'gaia', billing: 'per_guest' };
    if (n === 4) return { adult: 2500, extra: 3100, days: 4, mode: 'gaia', billing: 'per_guest' };
    return { adult: 3500, extra: 4100, days: 7, mode: 'gaia', billing: 'per_guest' };
  }

  if (isIlMonteGalalaUnit(unit)) {
    return { ...GALALA_BEACH, mode: 'galala', billing: 'per_guest' };
  }

  const adult = Number(unit.access_fee_per_adult_egp ?? unit.beach_access_price ?? 0);
  const extra = isFoukaBayUnit(unit)
    ? 0
    : Number(unit.access_fee_per_teen_egp ?? unit.beach_access_extra_guest ?? 0);
  const days = Number(unit.access_card_count_included ?? unit.beach_access_days ?? 7) || 7;
  return {
    adult: Number.isFinite(adult) ? adult : 0,
    extra: Number.isFinite(extra) ? extra : 0,
    days,
    mode: isFoukaBayUnit(unit) ? 'fouka' : 'manual',
    billing: 'per_guest',
  };
}

export function beachAccessFormDefaults(projectName) {
  const unit = { project: projectName, compound: projectName };
  if (isGaiaUnit(unit)) {
    return { beach_access_price: '', beach_access_extra_guest: '', beach_access_days: 7 };
  }
  if (isIlMonteGalalaUnit(unit)) {
    return {
      beach_access_price: GALALA_BEACH.adult,
      beach_access_extra_guest: GALALA_BEACH.extra,
      beach_access_days: GALALA_BEACH.days,
    };
  }
  if (isHaciendaWestUnit(unit)) {
    
    return {
      beach_access_price: HACIENDA_WEST_BEACH.other,
      beach_access_extra_guest: 0,
      beach_access_days: 7,
    };
  }
  if (isFreeBeachProject(unit)) {
    return { beach_access_price: 0, beach_access_extra_guest: 0, beach_access_days: 7 };
  }
  if (isFoukaBayUnit(unit)) {
    return null; 
  }
  return null;
}


export function getGuestLoad(adults, children) {
  return Number(adults || 0) + Number(children || 0) * 0.5;
}


export function computeBeachAccessFee(unit = {}, { nights = 0, adults = 1, teens = 0 } = {}) {
  const beach = resolveBeachAccessRates(unit, nights);
  if (beach.billing === 'flat' || beach.mode === 'hacienda_flat' || beach.mode === 'free') {
    const fee = Number(beach.flat != null ? beach.flat : beach.adult) || 0;
    return { fee, beach };
  }
  const accessAdult = Number(beach.adult || 0) * Math.max(0, Number(adults) || 0);
  const accessTeen = Number(beach.extra || 0) * Math.max(0, Number(teens) || 0);
  return { fee: accessAdult + accessTeen, beach };
}

export { GALALA_BEACH, HACIENDA_WEST_BEACH };
