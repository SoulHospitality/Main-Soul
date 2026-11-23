/**
 * Channel providers. To connect a channel manager (e.g. Rentals United, Hostaway, Channex), add a
 * provider class next to the others (see providers/README.md) and register it in `registerDefaults`.
 */
const { BookingApiProvider } = require('./providers/BookingApiProvider');
const { AirbnbApiProvider } = require('./providers/AirbnbApiProvider');

const providers = new Map();

function registerProvider(provider) {
  providers.set(provider.key, provider);
}

function registerDefaults() {
  for (const p of [new BookingApiProvider(), new AirbnbApiProvider()]) registerProvider(p);
}

registerDefaults();

function getProvider(key) {
  return providers.get(String(key || '').trim().toLowerCase()) || null;
}

function listProviders() {
  return [...providers.values()].map((p) => p.describe());
}

function labelForProviderKey(key) {
  const k = String(key || '');
  return getProvider(k)?.label || k;
}

module.exports = {
  getProvider,
  listProviders,
  registerProvider,
  registerDefaults,
  labelForProviderKey,
};
