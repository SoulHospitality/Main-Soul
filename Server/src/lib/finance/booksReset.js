const { query } = require('../../config/db');

let resetIso = null;
let loadedAt = 0;

/** Moment the Financial System was zeroed; records created before it are ignored by the books. */
async function refreshBooksReset() {
  if (Date.now() - loadedAt < 15000) return resetIso;
  try {
    const { rows } = await query(
      `SELECT value_text FROM financial_settings WHERE key = 'books_reset_at'`
    );
    const d = rows[0]?.value_text ? new Date(rows[0].value_text) : null;
    resetIso = d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
  } catch (e) {
    if (e.code !== '42P01') throw e;
    resetIso = null;
  }
  loadedAt = Date.now();
  return resetIso;
}

function booksResetAt() {
  return resetIso;
}

/** SQL fragment (leading AND) keeping rows whose timestamp column is at or after the reset. */
function afterReset(column) {
  return resetIso ? ` AND ${column} >= '${resetIso}'::timestamptz` : '';
}

module.exports = { refreshBooksReset, booksResetAt, afterReset };
