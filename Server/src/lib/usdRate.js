/**
 * Live USD → EGP market rate for USD reservations, so agents never type the rate by hand.
 * Two free keyless sources; the last good value is reused for 10 minutes, and kept as a
 * fallback (up to a day old) when both sources are unreachable.
 */

const CACHE_MS = 10 * 60 * 1000;
const STALE_MAX_MS = 24 * 60 * 60 * 1000;

const SOURCES = [
  {
    name: 'open.er-api.com',
    url: 'https://open.er-api.com/v6/latest/USD',
    pick: (json) => json?.rates?.EGP,
  },
  {
    name: 'fawazahmed0/currency-api',
    url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    pick: (json) => json?.usd?.egp,
  },
];

let cached = null;

async function fetchFrom(source) {
  const res = await fetch(source.url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`${source.name} HTTP ${res.status}`);
  const rate = Number(source.pick(await res.json()));
  if (!(rate > 1 && rate < 10000)) throw new Error(`${source.name} returned no EGP rate`);
  return Math.round(rate * 10000) / 10000;
}

/** @returns {Promise<{ rate: number, source: string, fetched_at: string, stale: boolean }>} */
async function getLiveUsdEgpRate() {
  if (cached && Date.now() - cached.at < CACHE_MS) return toResult(cached, false);
  for (const source of SOURCES) {
    try {
      const rate = await fetchFrom(source);
      cached = { rate, source: source.name, at: Date.now() };
      return toResult(cached, false);
    } catch (err) {
      console.warn('[usdRate]', err.message);
    }
  }
  if (cached && Date.now() - cached.at < STALE_MAX_MS) return toResult(cached, true);
  const err = new Error('Could not fetch the live USD rate right now — try again in a minute');
  err.status = 503;
  throw err;
}

function toResult(entry, stale) {
  return { rate: entry.rate, source: entry.source, fetched_at: new Date(entry.at).toISOString(), stale };
}

module.exports = { getLiveUsdEgpRate };
