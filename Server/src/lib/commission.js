/**
 * Company commission = rental (nights accommodation) × %
 *
 * Modes only choose which % applies. Housekeeping, utilities, and guest
 * service fees are NOT included in the commission base.
 *
 *   A — company_commission_pct on all bookings
 *   B — company_commission_pct (owner commission); tenant % is separate revenue
 *   C — company_commission_pct (via us) or company_commission_owner_pct (via owner);
 *       tenant % is separate revenue on sales bookings
 */

const DEFAULT_OWNER_COMMISSION_PCT = 20;
const GUEST_SERVICE_FEE_PCT = 15;

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
 * Nights-only accommodation amount for owner portal.
 * Guest totals often include housekeeping, utilities/access, and 15% service+tax —
 * those must not appear in owner Gross.
 */
function ownerAccommodationGross(reservation, unit = {}) {
  const nights = Math.max(parseInt(reservation.nights, 10) || 1, 1);
  const total =
    parseFloat(
      reservation.total_amount != null ? reservation.total_amount : reservation.total_egp
    ) || 0;
  const hk = parseFloat(reservation.housekeeping_fees) || 0;
  const utilStored = parseFloat(reservation.utilities_amount);
  const util =
    Number.isFinite(utilStored) && utilStored > 0
      ? utilStored
      : nights * (parseFloat(unit.utilities_cost || reservation.utilities_cost) || 0);
  const ppn = parseFloat(reservation.price_per_night) || 0;
  const fromPpn = ppn > 0 ? round2(ppn * nights) : 0;

  // Prefer explicit nightly rate when it is clearly accommodation-only
  // (total ≈ nights + known fees + 15% service on nights).
  if (fromPpn > 0 && total > 0) {
    const expectedWithService = round2(
      fromPpn + hk + util + fromPpn * (GUEST_SERVICE_FEE_PCT / 100)
    );
    const expectedWithoutService = round2(fromPpn + hk + util);
    if (
      Math.abs(total - expectedWithService) <= Math.max(5, total * 0.02) ||
      Math.abs(total - expectedWithoutService) <= Math.max(5, total * 0.02)
    ) {
      return fromPpn;
    }
    // price_per_night was likely stored as total/nights (includes fees) — fall through
  }

  // Reverse guest quote: total = nights + HK + utilities + 15% service on nights
  const extras = round2(hk + util);
  if (total > extras) {
    return round2((total - extras) / (1 + GUEST_SERVICE_FEE_PCT / 100));
  }

  if (fromPpn > 0) return fromPpn;
  return round2(total);
}

/**
 * Owner-facing money: Gross = nights only, Commission = % of Gross, Net = Gross − Commission.
 * Money is hidden for rejected / cancelled stays.
 */
function ownerPortalFinancials(unit, reservation, { status } = {}) {
  const displayStatus = String(status || reservation?.status || '').toLowerCase();
  const showMoney = displayStatus === 'confirmed' || displayStatus === 'pending';
  const commissionPct =
    parseFloat(unit?.company_commission_pct) > 0
      ? parseFloat(unit.company_commission_pct)
      : DEFAULT_OWNER_COMMISSION_PCT;

  if (!showMoney) {
    return {
      gross: 0,
      commission: 0,
      net: 0,
      commissionPct,
      showMoney: false,
    };
  }

  const gross = ownerAccommodationGross(reservation, unit);
  const commission = round2((gross * commissionPct) / 100);
  const net = round2(gross - commission);
  return { gross, commission, net, commissionPct, showMoney: true };
}

function calcReservationFinancials(unit, reservation) {
  if (!unit || !reservation) {
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

  const mode = String(unit.commission_mode || 'A').toUpperCase();
  const nights = Math.max(parseInt(reservation.nights, 10) || 1, 1);
  const isOwner = Boolean(
    parseInt(reservation.is_owner_reservation, 10) ||
      reservation.is_owner_reservation === true
  );

  const companyPct = parseFloat(unit.company_commission_pct) || 0;
  const ownerResPct = parseFloat(unit.company_commission_owner_pct) || 0;
  const tenantPct = parseFloat(unit.commission_tenant_pct) || 0;

  // Prefer nights-only accommodation so commission never sits on fees
  const base = ownerAccommodationGross(reservation, unit);
  const utilitiesDeduction =
    parseFloat(reservation.utilities_amount) ||
    nights * (parseFloat(unit.utilities_cost) || 0) ||
    0;
  const housekeepingFees = parseFloat(reservation.housekeeping_fees) || 0;

  let appliedCommissionPct = 0;
  if (mode === 'C' && isOwner) {
    appliedCommissionPct = ownerResPct;
  } else {
    appliedCommissionPct = companyPct || DEFAULT_OWNER_COMMISSION_PCT;
  }

  const companyCommission =
    appliedCommissionPct > 0 ? round2((base * appliedCommissionPct) / 100) : 0;

  let tenantDeduction = 0;
  if ((mode === 'B' || mode === 'C') && tenantPct > 0 && !isOwner) {
    tenantDeduction = round2((base * tenantPct) / 100);
  }

  const subtotal = round2(base - tenantDeduction);
  const ownerNet = round2(subtotal - companyCommission);
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

function calcStatementFinancials(unit, reservations) {
  let totalGross = 0;
  let totalTenantDeduction = 0;
  let totalUtilitiesDeduction = 0;
  let totalHousekeeping = 0;
  let totalSubtotal = 0;
  let totalCompanyCommission = 0;
  let totalOwnerNet = 0;

  const rows = (reservations || []).map((r) => {
    const fin = calcReservationFinancials(unit, r);
    totalGross += fin.grossAmount;
    totalTenantDeduction += fin.tenantDeduction;
    totalUtilitiesDeduction += fin.utilitiesDeduction;
    totalHousekeeping += fin.housekeepingFees;
    totalSubtotal += fin.subtotal;
    totalCompanyCommission += fin.companyCommission;
    totalOwnerNet += fin.ownerNet;
    return { ...r, _fin: fin };
  });

  return {
    rows,
    totalGross: round2(totalGross),
    totalTenantDeduction: round2(totalTenantDeduction),
    totalUtilitiesDeduction: round2(totalUtilitiesDeduction),
    totalHousekeeping: round2(totalHousekeeping),
    totalSubtotal: round2(totalSubtotal),
    totalCompanyCommission: round2(totalCompanyCommission),
    totalOwnerNet: round2(totalOwnerNet),
  };
}

module.exports = {
  calcReservationFinancials,
  calcStatementFinancials,
  ownerAccommodationGross,
  ownerPortalFinancials,
  round2,
  rentalBase,
  DEFAULT_OWNER_COMMISSION_PCT,
  GUEST_SERVICE_FEE_PCT,
};
