const { listProviders, getProvider, registerProvider, labelForProviderKey } = require('./registry');
const {
  listConnections,
  runChannelSync,
  upsertApiConnection,
  updateApiConnection,
  upsertUnitMapping,
  listSyncLogs,
} = require('./syncEngine');
const { CAPABILITIES, FULL_API_CAPABILITIES } = require('./capabilities');
const {
  listThreads,
  getThread,
  replyToThread,
  unreadCount,
  ingestProviderMessages,
} = require('./messaging');
const { channelRevenueSummary } = require('./channelRevenue');

module.exports = {
  CAPABILITIES,
  FULL_API_CAPABILITIES,
  listProviders,
  getProvider,
  registerProvider,
  labelForProviderKey,
  listConnections,
  runChannelSync,
  upsertApiConnection,
  updateApiConnection,
  upsertUnitMapping,
  listSyncLogs,
  listThreads,
  getThread,
  replyToThread,
  unreadCount,
  ingestProviderMessages,
  channelRevenueSummary,
};
