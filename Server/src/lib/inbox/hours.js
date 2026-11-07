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

/** Staff are off from 22:00 until 11:00 Cairo time. */
function isQuietHours(ts = Date.now()) {
  return !isBusinessTime(ts, { business_start: '11:00', business_end: '22:00' });
}

/**
 * Working-hours seconds between two moments: time outside business hours (nights) is not counted,
 * so a message at 21:55 answered at 11:05 the next morning took 10 minutes, not 13 hours.
 */
function businessSeconds(fromTs, toTs, opts) {
  const a = Number(fromTs);
  const b = Number(toTs);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  const { start, end } = businessWindow(opts);
  if (end - start >= 1440 || start === end) return Math.round((b - a) / 1000);
  let total = 0;
  let t = a;
  for (let guard = 0; t < b && guard < 2000; guard += 1) {
    if (!isBusinessTime(t, opts)) {
      t = Math.max(t + 60000, nextBusinessStart(t, opts));
      continue;
    }
    const m = localMinutes(t);
    const left = ((end - m + 1440) % 1440 || 1440) * 60000 - (t % 60000);
    const stop = Math.min(b, t + left);
    total += stop - t;
    t = stop;
  }
  return Math.round(total / 1000);
}

module.exports = { localMinutes, localHour, localDay, isBusinessTime, nextBusinessStart, isQuietHours, businessSeconds };
