/**
 * Egyptian tax engine — VAT (14%) and WHT (1% / 3%) calculations.
 */

const VAT_OUTPUT_PCT = 14;
const WHT_STANDARD_PCT = 3;
const WHT_REDUCED_PCT = 1;

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Output VAT on Soul commission / management fees (taxable service revenue). */
function outputVatOnCommission(commissionBase) {
  const base = Math.max(0, Number(commissionBase) || 0);
  return {
    rate_pct: VAT_OUTPUT_PCT,
    taxable_base: round2(base),
    vat_amount: round2(base * (VAT_OUTPUT_PCT / 100)),
    account_code: '205000',
  };
}

/** WHT withheld on vendor bills (default 3%; 1% for qualifying small vendors). */
function withholdingTax(vendorBillAmount, { ratePct = WHT_STANDARD_PCT } = {}) {
  const base = Math.max(0, Number(vendorBillAmount) || 0);
  const rate = ratePct === WHT_REDUCED_PCT ? WHT_REDUCED_PCT : WHT_STANDARD_PCT;
  return {
    rate_pct: rate,
    vendor_base: round2(base),
    wht_amount: round2(base * (rate / 100)),
    account_code: '206000',
  };
}

/**
 * Booking split for trust accounting display.
 * @param {object} fin — calcReservationFinancials output
 * @param {object} reservation — raw reservation row
 */
function bookingSplit(fin, reservation) {
  const gross = fin.grossAmount || 0;
  const cleaning = fin.housekeepingFees || 0;
  const commission = fin.companyCommission || 0;
  const ownerNet = fin.ownerNet || 0;
  const vat = outputVatOnCommission(commission);

  return {
    gross_booking: round2(gross + cleaning),
    accommodation: round2(gross),
    soul_commission: round2(commission),
    soul_commission_pct: fin.appliedCommissionPct || 0,
    cleaning_fee: round2(cleaning),
    vat_on_commission: vat.vat_amount,
    vat_pct: VAT_OUTPUT_PCT,
    owner_trust_credit: round2(ownerNet),
    owner_trust_account: '202000',
    commission_revenue_account: '401000',
    cleaning_revenue_account: '402000',
    guest_name: reservation.guest_name,
    unit_name: reservation.unit_name,
    project: reservation.project,
    check_in: reservation.check_in,
    check_out: reservation.check_out,
    reservation_id: reservation.id,
  };
}

/** Monthly tax liability rollup */
function monthlyTaxLiability({ commissionTotal, vendorBills = [], monthLabel }) {
  const vat = outputVatOnCommission(commissionTotal);
  const whtLines = vendorBills.map((bill) => ({
    vendor: bill.vendor || bill.description || 'Vendor',
    amount: bill.amount,
    ...withholdingTax(bill.amount, { ratePct: bill.wht_rate_pct }),
  }));
  const totalWht = round2(whtLines.reduce((s, l) => s + l.wht_amount, 0));

  return {
    month: monthLabel,
    output_vat: vat,
    withholding: {
      lines: whtLines,
      total_wht: totalWht,
      account_code: '206000',
    },
    total_tax_liability: round2(vat.vat_amount + totalWht),
  };
}

module.exports = {
  VAT_OUTPUT_PCT,
  WHT_STANDARD_PCT,
  WHT_REDUCED_PCT,
  round2,
  outputVatOnCommission,
  withholdingTax,
  bookingSplit,
  monthlyTaxLiability,
};
