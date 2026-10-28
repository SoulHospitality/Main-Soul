/** Calendar dates in Africa/Cairo. UTC timestamps should keep using toISOString. */

function todayCairo(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function addCalendarDays(isoDate, days) {
  const [y, m, d] = String(isoDate || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Number(days) || 0);
  return dt.toISOString().slice(0, 10);
}

function shiftMonth(isoDate, delta) {
  const [y, m] = String(isoDate || '').slice(0, 7).split('-').map(Number);
  if (!y || !m) return '';
  const dt = new Date(Date.UTC(y, m - 1 + Number(delta || 0), 1));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

function isoDateOr(value, fallback) {
  const iso = String(value || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return fallback;
}

/** Owner net still to pay after settlements and payout requests already counted. */
function adjustPayoutsDue(gross, paidSettlements, openPayouts) {
  const due = (Number(gross) || 0) - (Number(paidSettlements) || 0) - (Number(openPayouts) || 0);
  return Math.round(Math.max(0, due) * 100) / 100;
}

module.exports = { todayCairo, addCalendarDays, shiftMonth, isoDateOr, adjustPayoutsDue };
