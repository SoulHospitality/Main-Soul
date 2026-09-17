const { listProviders, getProvider, providerKeyForIcalPlatform, labelForProviderKey } = require('./registry');
const {
  listConnections,
  runChannelSync,
  syncIcalFeed,
  syncAllIcal,
  upsertApiConnection,
  upsertUnitMapping,
  updateIcalFeedMapping,
  listSyncLogs,
} = require('./syncEngine');
const { CAPABILITIES, ICAL_CAPABILITIES, FULL_API_CAPABILITIES } = require('./capabilities');

module.exports = {
  CAPABILITIES,
  ICAL_CAPABILITIES,
  FULL_API_CAPABILITIES,
  listProviders,
  getProvider,
  providerKeyForIcalPlatform,
  labelForProviderKey,
  listConnections,
  runChannelSync,
  syncIcalFeed,
  syncAllIcal,
  upsertApiConnection,
  upsertUnitMapping,
  updateIcalFeedMapping,
  listSyncLogs,
};
