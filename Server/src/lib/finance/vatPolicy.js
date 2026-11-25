/**
 * Tax suspensions (accountant's decisions, 2026-11-25: taxes postponed while the company negotiates with the tax
 * authority).
 *   financial_settings.vat_suspended_from = 'YYYY-MM-DD': from that date no output or input VAT is booked.
 *   financial_settings.wht_suspended_from = 'YYYY-MM-DD': from that date no withholding is deducted from vendor bills
 *   or company-paid expenses (the vendor is paid in full).
 * Before each date the standard treatment applies as before. Each tax resumes on its own by removing its setting;
 * no code change is needed.
 */
const { query } = require('../../config/db');
const { VAT_OUTPUT_PCT } = require('./taxEngine');

const ISO = /^\d{4}-\d{2}-\d{2}$/;
let suspendedFrom = null;
let whtSuspendedFrom = null;
let loadedAt = 0;

async function refreshVatPolicy() {
  if (Date.now() - loadedAt < 15000) return suspendedFrom;
  try {
    const { rows } = await query(
      `SELECT key, value_text FROM financial_settings WHERE key IN ('vat_suspended_from', 'wht_suspended_from')`
    );
    const get = (k) => {
      const v = String(rows.find((r) => r.key === k)?.value_text || '').slice(0, 10);
      return ISO.test(v) ? v : null;
    };
    suspendedFrom = get('vat_suspended_from');
    whtSuspendedFrom = get('wht_suspended_from');
  } catch (e) {
    if (e.code !== '42P01') throw e;
    suspendedFrom = null;
    whtSuspendedFrom = null;
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

function whtSuspendedFromDate() {
  return whtSuspendedFrom;
}

/** Whether withholding applies to a transaction dated `isoDate` (false while suspended). */
function whtActiveFor(isoDate) {
  return !(whtSuspendedFrom && isoDate && String(isoDate).slice(0, 10) >= whtSuspendedFrom);
}

/** Tests only: set the policy without the database. `wht` left undefined keeps the current withholding setting. */
function _setForTests(value, wht = undefined) {
  suspendedFrom = value || null;
  if (wht !== undefined) whtSuspendedFrom = wht || null;
  loadedAt = Date.now();
}

module.exports = { refreshVatPolicy, vatSuspendedFrom, vatRateFor, whtSuspendedFromDate, whtActiveFor, _setForTests };
