/**
 * Egyptian tax engine — client mirror for display / previews.
 */

export const VAT_OUTPUT_PCT = 14;
export const WHT_STANDARD_PCT = 3;
export const WHT_REDUCED_PCT = 1;

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function outputVatOnCommission(commissionBase) {
  const base = Math.max(0, Number(commissionBase) || 0);
  return {
    rate_pct: VAT_OUTPUT_PCT,
    taxable_base: round2(base),
    vat_amount: round2(base * (VAT_OUTPUT_PCT / 100)),
    account_code: '205000',
  };
}

export function withholdingTax(vendorBillAmount, { ratePct = WHT_STANDARD_PCT } = {}) {
  const base = Math.max(0, Number(vendorBillAmount) || 0);
  const rate = ratePct === WHT_REDUCED_PCT ? WHT_REDUCED_PCT : WHT_STANDARD_PCT;
  return {
    rate_pct: rate,
    vendor_base: round2(base),
    wht_amount: round2(base * (rate / 100)),
    account_code: '206000',
  };
}

export function bookingSplitPreview(fin, reservation) {
  const gross = fin.grossAmount || 0;
  const cleaning = fin.housekeepingFees || 0;
  const commission = fin.companyCommission || 0;
  const ownerNet = fin.ownerNet || 0;
  const vat = outputVatOnCommission(commission);

  return {
    gross_booking: round2(gross + cleaning),
    soul_commission: round2(commission),
    cleaning_fee: round2(cleaning),
    vat_on_commission: vat.vat_amount,
    owner_trust_credit: round2(ownerNet),
  };
}
