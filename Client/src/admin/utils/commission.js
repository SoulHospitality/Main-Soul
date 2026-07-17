/**
 * Company commission = rental (price/night × nights) × %
 *
 * Modes only choose which % applies. Housekeeping and utilities are NOT
 * included in the commission base — those are tracked on their own pages.
 */

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function rentalBase(reservation) {
  const nights = Math.max(parseInt(reservation.nights, 10) || 1, 1);
  const pricePerNight = parseFloat(reservation.price_per_night) || 0;
  if (pricePerNight > 0) return round2(pricePerNight * nights);
  return round2(parseFloat(reservation.total_amount) || 0);
}

/**
 * @param {Object} unit
 * @param {Object} reservation
 */
export function calcReservationFinancials(unit, reservation) {
  if (!unit || !reservation) return nullFinancials();

  const mode = String(unit.commission_mode || 'A').toUpperCase();
  const nights = Math.max(parseInt(reservation.nights, 10) || 1, 1);
  const isOwner = Boolean(
    parseInt(reservation.is_owner_reservation, 10) ||
      reservation.is_owner_reservation === true
  );

  const companyPct = parseFloat(unit.company_commission_pct) || 0;
  const ownerResPct = parseFloat(unit.company_commission_owner_pct) || 0;
  const tenantPct = parseFloat(unit.commission_tenant_pct) || 0;

  const base = rentalBase(reservation);
  const utilitiesDeduction = parseFloat(reservation.utilities_amount) || 0;
  const housekeepingFees = parseFloat(reservation.housekeeping_fees) || 0;

  let appliedCommissionPct = 0;
  if (mode === 'C' && isOwner) {
    appliedCommissionPct = ownerResPct;
  } else {
    appliedCommissionPct = companyPct;
  }

  const companyCommission =
    appliedCommissionPct > 0 ? round2((base * appliedCommissionPct) / 100) : 0;

  let tenantDeduction = 0;
  if ((mode === 'B' || mode === 'C') && tenantPct > 0 && !isOwner) {
    tenantDeduction = round2((base * tenantPct) / 100);
  }

  const subtotal = round2(base - tenantDeduction);
  const ownerNet = round2(subtotal - companyCommission - utilitiesDeduction);
  const intermediatePricePerNight = nights > 0 ? round2(subtotal / nights) : 0;
  const adjustedPricePerNight = nights > 0 ? round2(ownerNet / nights) : 0;

  return {
    mode,
    grossAmount: base,
    rentalBase: base,
    tenantDeduction,
    utilitiesDeduction,
    housekeepingFees,
    subtotal,
    intermediatePricePerNight,
    companyCommission,
    ownerNet,
    adjustedPricePerNight,
    appliedCommissionPct,
    isOwner,
  };
}

function nullFinancials() {
  return {
    mode: 'A',
    grossAmount: 0,
    rentalBase: 0,
    tenantDeduction: 0,
    utilitiesDeduction: 0,
    housekeepingFees: 0,
    subtotal: 0,
    intermediatePricePerNight: 0,
    companyCommission: 0,
    ownerNet: 0,
    adjustedPricePerNight: 0,
    appliedCommissionPct: 0,
    isOwner: false,
  };
}

export function commissionModeLabel(unit) {
  if (!unit) return '—';
  const mode = String(unit.commission_mode || 'A').toUpperCase();
  if (mode === 'A') return `Fixed ${unit.company_commission_pct ?? 0}% of nightly rate`;
  if (mode === 'B') {
    return `Owner ${unit.company_commission_pct ?? 0}% + Tenant ${unit.commission_tenant_pct ?? 0}% of nightly rate`;
  }
  return `Via Us ${unit.company_commission_pct ?? 0}% / Via Owner ${unit.company_commission_owner_pct ?? 0}% + Tenant ${unit.commission_tenant_pct ?? 0}% (nightly rate only)`;
}

export function appliedPctLabel(fin, unit) {
  if (!fin || !unit) return '—';
  if (fin.mode === 'C' && fin.isOwner) return `Via Owner ${unit.company_commission_owner_pct ?? 0}%`;
  if (fin.appliedCommissionPct > 0) return `${fin.appliedCommissionPct}%`;
  return 'None';
}
