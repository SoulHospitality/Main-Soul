/**
 * Company books start here — revenue, payments, expenses, and related totals
 * ignore anything before this date.
 */
const FINANCIAL_EPOCH =
  process.env.FINANCIAL_EPOCH || '2026-08-01';

function maxDate(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return String(a) >= String(b) ? a : b;
}

/** Floor a requested from-date at the financial epoch. */
function clampFromDate(fromDate) {
  return maxDate(fromDate || null, FINANCIAL_EPOCH);
}

module.exports = {
  FINANCIAL_EPOCH,
  clampFromDate,
  maxDate,
};
