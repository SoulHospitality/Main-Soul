
const FINANCIAL_EPOCH =
  process.env.FINANCIAL_EPOCH || '2026-04-01';

function maxDate(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return String(a) >= String(b) ? a : b;
}


function clampFromDate(fromDate) {
  return maxDate(fromDate || null, FINANCIAL_EPOCH);
}

/** Financial System books start; later than FINANCIAL_EPOCH, which owner statements and reports still use. */
const FINANCE_BOOKS_START = maxDate(process.env.FINANCE_BOOKS_START || '2026-10-01', FINANCIAL_EPOCH);

function clampBooksFromDate(fromDate) {
  return maxDate(fromDate || null, FINANCE_BOOKS_START);
}

module.exports = {
  FINANCIAL_EPOCH,
  FINANCE_BOOKS_START,
  clampFromDate,
  clampBooksFromDate,
  maxDate,
};
