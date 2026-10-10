const { config } = require('./config');
const { setting } = require('./settings');

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', hourCycle: 'h23' });
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Minutes since local midnight in the business timezone. */
function localMinutes(ts) {
  const parts = fmt.formatToParts(new Date(ts));
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}

function localHour(ts) {
  return Number(hourFmt.format(new Date(ts)));
}

function localDay(ts) {
  return dayFmt.format(new Date(ts));
}

function businessWindow(opts) {
  return {
    start: toMinutes(opts?.business_start ?? setting('business_start')),
    end: toMinutes(opts?.business_end ?? setting('business_end')),
  };
}

/** True when the SLA clock is running (agents are expected to reply). */
function isBusinessTime(ts = Date.now(), opts) {
  const { start, end } = businessWindow(opts);
  if (end - start >= 1440 || start === end) return true;
  const m = localMinutes(ts);
  return start < end ? m >= start && m < end : m >= start || m < end;
}

/** The moment the SLA clock should start for a message received at `ts`. */
function nextBusinessStart(ts, opts) {
  if (isBusinessTime(ts, opts)) return ts;
  const { start } = businessWindow(opts);
  const m = localMinutes(ts);
  const deltaMin = (start - m + 1440) % 1440;
  const startOfMinute = ts - (ts % 60000);
  return startOfMinute + deltaMin * 60000;
}

module.exports = { localMinutes, localHour, localDay, isBusinessTime, nextBusinessStart };
