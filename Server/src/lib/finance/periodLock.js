const { isPeriodClosed } = require('./ledgerEngine');

async function assertPeriodOpen(date, label = 'This date') {
  const iso = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
  if (await isPeriodClosed(iso)) {
    const err = new Error(
      `${label} is in a closed month (${iso.slice(0, 7)}). Record the correction in the open month.`
    );
    err.status = 409;
    throw err;
  }
}

module.exports = { assertPeriodOpen };
