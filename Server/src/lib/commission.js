/**
 * Company commission = rental (price/night × nights) × %
 *
 * Modes only choose which % applies. Housekeeping and utilities are NOT
 * included in the commission base — those are tracked on their own pages.
 *
 *   A — company_commission_pct on all bookings
 *   B — company_commission_pct (owner commission); tenant % is separate revenue
 *   C — company_commission_pct (via us) or company_commission_owner_pct (via owner);
 *       tenant % is separate revenue on sales bookings
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

  // Tenant % is separate company revenue — still on rental base only, never on HK/utilities
  let tenantDeduction = 0;
  if ((mode === 'B' || mode === 'C') && tenantPct > 0 && !isOwner) {
    tenantDeduction = round2((base * tenantPct) / 100);
  }

  // Owner net: rental after commission + tenant; utilities deducted here (not from commission %)
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

module.exports = { calcReservationFinancials, calcStatementFinancials, round2, rentalBase };
