import { isGaiaUnit } from './bookingRules';

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

export function isFreeBeachProject(unit = {}) {
  const s = projectText(unit);
  if (!s) return false;
  if (/hacienda\s*west/.test(s)) return true;
  if (/\bd[-\s]?bay\b/.test(s)) return true;
  return false;
}

export function beachAccessRequiresManualEntry(unit = {}) {
  if (String(unit?.listing_type || 'rent').toLowerCase() === 'sale') return false;
  if (isGaiaUnit(unit)) return false;
  if (isFreeBeachProject(unit)) return false;
  return true;
}

/**
 * @returns {{ adult: number, extra: number, days: number, mode: 'gaia'|'free'|'manual' }}
 */
export function resolveBeachAccessRates(unit = {}, nights = 0) {
  if (isFreeBeachProject(unit)) {
    return { adult: 0, extra: 0, days: 7, mode: 'free' };
  }

  if (isGaiaUnit(unit)) {
    const n = Math.max(0, Number(nights) || 0);
    if (n <= 3) return { adult: 1900, extra: 2500, days: 3, mode: 'gaia' };
    if (n === 4) return { adult: 2500, extra: 3100, days: 4, mode: 'gaia' };
    return { adult: 3500, extra: 4100, days: 7, mode: 'gaia' };
  }

  const adult = Number(unit.access_fee_per_adult_egp ?? unit.beach_access_price ?? 0);
  const extra = Number(unit.access_fee_per_teen_egp ?? unit.beach_access_extra_guest ?? 0);
  const days = Number(unit.access_card_count_included ?? unit.beach_access_days ?? 7) || 7;
  return {
    adult: Number.isFinite(adult) ? adult : 0,
    extra: Number.isFinite(extra) ? extra : 0,
    days,
    mode: 'manual',
  };
}

export function beachAccessFormDefaults(projectName) {
  const unit = { project: projectName, compound: projectName };
  if (isGaiaUnit(unit)) {
    return { beach_access_price: '', beach_access_extra_guest: '', beach_access_days: 7 };
  }
  if (isFreeBeachProject(unit)) {
    return { beach_access_price: 0, beach_access_extra_guest: 0, beach_access_days: 7 };
  }
  return null;
}
