/**
 * VAT suspension (accountant's decision, 2026-11-25: "taxes 0 until decided" while the company negotiates with the
 * tax authority). financial_settings.vat_suspended_from = 'YYYY-MM-DD': from that date no output or input VAT is
 * booked; before it, the standard 14% applies as before. Removing the row (or setting a resume date in future work)
 * brings VAT back without a code change. Withholding tax on vendor bills is NOT affected.
 */
const { query } = require('../../config/db');
const { VAT_OUTPUT_PCT } = require('./taxEngine');

let suspendedFrom = null;
let loadedAt = 0;

async function refreshVatPolicy() {
  if (Date.now() - loadedAt < 15000) return suspendedFrom;
  try {
    const { rows } = await query(`SELECT value_text FROM financial_settings WHERE key = 'vat_suspended_from'`);
    const v = String(rows[0]?.value_text || '').slice(0, 10);
    suspendedFrom = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  } catch (e) {
    if (e.code !== '42P01') throw e;
    suspendedFrom = null;
  }
  loadedAt = Date.now();
  return suspendedFrom;
}

function vatSuspendedFrom() {
  return suspendedFrom;
}

/** The VAT rate (%) for a transaction dated `isoDate`: 0 while suspended, otherwise the standard rate. */
function vatRateFor(isoDate) {
  if (suspendedFrom && isoDate && String(isoDate).slice(0, 10) >= suspendedFrom) return 0;
  return VAT_OUTPUT_PCT;
}

/** Tests only: set the policy without the database. */
function _setForTests(value) {
  suspendedFrom = value || null;
  loadedAt = Date.now();
}

module.exports = { refreshVatPolicy, vatSuspendedFrom, vatRateFor, _setForTests };
