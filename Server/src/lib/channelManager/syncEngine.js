const { query } = require('../../config/db');
const { CAPABILITIES } = require('./capabilities');
const { getProvider, listProviders } = require('./registry');
const { writeSyncLog, listSyncLogs } = require('./syncLogs');
const { GUEST_AVAILABILITY_MONTHS } = require('../calendarOccupancy');
const { normalizeOtaPlatform } = require('../otaPlatforms');

async function listApiConnections() {
  try {
    const { rows } = await query(
      `SELECT c.*,
              COALESCE(
                (SELECT json_agg(json_build_object(
                   'id', m.id,
                   'unit_id', m.unit_id,
                   'external_listing_id', m.external_listing_id,
                   'external_room_type_id', m.external_room_type_id,
                   'external_rate_plan_id', m.external_rate_plan_id
                 ) ORDER BY m.updated_at DESC)
                 FROM channel_unit_mappings m WHERE m.connection_id = c.id),
                '[]'::json
              ) AS mappings
       FROM channel_connections c
       ORDER BY c.updated_at DESC`
    );
    return rows.map((c) => {
      const provider = getProvider(c.provider_key);
      const creds = c.credentials && typeof c.credentials === 'object' ? c.credentials : {};
      const hasCredentials = Boolean(
        creds.api_key ||
          creds.access_token ||
          creds.client_id ||
          creds.client_secret ||
          (creds.base_url && Object.keys(creds).length > 1)
      );
      return {
        id: c.id,
        kind: 'api_connection',
        connection_type: c.connection_type,
        provider_key: c.provider_key,
        provider_label: provider?.label || c.provider_key,
        display_name: c.display_name || provider?.label || c.provider_key,
        enabled: c.enabled,
        sync_enabled: c.sync_enabled,
        status: c.sync_status,
        last_sync_at: c.last_sync_at,
        last_sync_error: c.last_sync_error,
        mappings: c.mappings || [],
        capabilities: provider?.capabilities || [],
        config: c.config || {},
        credential_keys: Object.keys(creds),
        configured: hasCredentials,
        has_credentials: hasCredentials,
      };
    });
  } catch (err) {
    if (/channel_connections/i.test(err.message)) return [];
    throw err;
  }
}

async function listConnections() {
  const api = await listApiConnections();
  return { api, providers: listProviders() };
}

async function syncApiConnection(connectionId) {
  const { rows } = await query(`SELECT * FROM channel_connections WHERE id = $1`, [connectionId]);
  const connection = rows[0];
  if (!connection) throw new Error('Connection not found');
  if (!connection.enabled || !connection.sync_enabled) {
    return { ok: false, error: 'Connection sync is disabled', status: 'disconnected' };
  }

  const provider = getProvider(connection.provider_key);
  if (!provider) throw new Error(`Unknown provider: ${connection.provider_key}`);

  await query(
    `UPDATE channel_connections SET sync_status = 'syncing', updated_at = now() WHERE id = $1`,
    [connectionId]
  );

  try {
    const outcomes = {};
    await provider.authenticate(connection);

    if (provider.supports(CAPABILITIES.AVAILABILITY_PUSH)) {
      try {
        outcomes.availability_push = await provider.pushAvailability(connection);
      } catch (err) {
        outcomes.availability_push = { error: err.message };
      }
    }
    if (provider.supports(CAPABILITIES.RATES_PUSH)) {
      try {
        outcomes.rates_push = await provider.pushRates(connection);
      } catch (err) {
        outcomes.rates_push = { error: err.message };
      }
    }
    if (provider.supports(CAPABILITIES.AVAILABILITY_PULL)) {
      try {
        outcomes.availability_pull = await provider.pullAvailability(connection);
      } catch (err) {
        outcomes.availability_pull = { error: err.message };
      }
    }
    if (provider.supports(CAPABILITIES.RESERVATIONS_PULL)) {
      outcomes.reservations = await provider.pullReservations(connection);
    }
    if (provider.supports(CAPABILITIES.CANCELLATIONS_PULL)) {
      try {
        outcomes.cancellations = await provider.pullCancellations(connection);
      } catch (err) {
        outcomes.cancellations = { error: err.message };
      }
    }
    if (provider.supports(CAPABILITIES.MODIFICATIONS_PULL)) {
      try {
        outcomes.modifications = await provider.pullModifications(connection);
      } catch (err) {
        outcomes.modifications = { error: err.message };
      }
    }
    if (provider.supports(CAPABILITIES.MESSAGES_PULL)) {
      try {
        const { ingestProviderMessages } = require('./messaging');
        const raw = await provider.pullMessages(connection);
        outcomes.messages = await ingestProviderMessages(connection, raw);
      } catch (err) {
        outcomes.messages = { error: err.message };
      }
    }

    const hardFail =
      outcomes.reservations?.error ||
      (outcomes.availability_push?.error && outcomes.rates_push?.error);

    await query(
      `UPDATE channel_connections
       SET sync_status = $2, last_sync_at = now(),
           last_sync_error = $3, updated_at = now()
       WHERE id = $1`,
      [
        connectionId,
        hardFail ? 'failed' : 'connected',
        hardFail ? String(hardFail) : null,
      ]
    );
    await writeSyncLog({
      connectionId,
      providerKey: connection.provider_key,
      direction: 'inbound',
      operation: 'full_sync',
      status: hardFail ? 'error' : 'success',
      message: hardFail ? String(hardFail) : 'API sync completed',
      details: outcomes,
    });
    return { ok: !hardFail, result: outcomes, status: hardFail ? 'failed' : 'connected' };
  } catch (err) {
    await query(
      `UPDATE channel_connections
       SET sync_status = 'failed', last_sync_error = $2, updated_at = now()
       WHERE id = $1`,
      [connectionId, err.message]
    );
    await writeSyncLog({
      connectionId,
      providerKey: connection.provider_key,
      direction: 'inbound',
      operation: 'full_sync',
      status: 'error',
      message: err.message,
    });
    return { ok: false, error: err.message, status: 'failed' };
  }
}

/**
 * Central Channel Manager sync entrypoint: one connection, or every enabled one.
 * A channel manager pushes availability and rates out and pulls bookings in (as reservations).
 */
async function runChannelSync({ connectionId = null } = {}) {
  if (connectionId) return syncApiConnection(connectionId);
  const { rows: apiRows } = await query(
    `SELECT id FROM channel_connections WHERE enabled = true AND sync_enabled = true AND connection_type = 'api'`
  ).catch((err) => {
    if (/channel_connections/i.test(err.message)) return { rows: [] };
    throw err;
  });
  const apiResults = [];
  for (const row of apiRows) {
    apiResults.push({ connection_id: row.id, ...(await syncApiConnection(row.id)) });
  }
  return {
    api_connections: apiRows.length,
    api_errors: apiResults.filter((r) => !r.ok).length,
    api_results: apiResults,
    monthsAhead: GUEST_AVAILABILITY_MONTHS,
  };
}

async function upsertApiConnection({
  providerKey,
  displayName = null,
  credentials = {},
  config = {},
  enabled = true,
  syncEnabled = true,
} = {}) {
  const provider = getProvider(providerKey);
  if (!provider || provider.connectionType !== 'api') {
    throw new Error('Invalid API provider');
  }
  const { rows } = await query(
    `INSERT INTO channel_connections
       (provider_key, connection_type, display_name, credentials, config, enabled, sync_enabled, sync_status)
     VALUES ($1,'api',$2,$3::jsonb,$4::jsonb,$5,$6,'disconnected')
     RETURNING *`,
    [
      provider.key,
      displayName || provider.label,
      JSON.stringify(credentials || {}),
      JSON.stringify(config || {}),
      enabled !== false,
      syncEnabled !== false,
    ]
  );
  return rows[0];
}

async function updateApiConnection(
  connectionId,
  {
    displayName = undefined,
    credentials = undefined,
    config = undefined,
    enabled = undefined,
    syncEnabled = undefined,
  } = {}
) {
  const { rows: existing } = await query(`SELECT * FROM channel_connections WHERE id = $1`, [
    connectionId,
  ]);
  const row = existing[0];
  if (!row) throw new Error('Connection not found');

  const nextCreds =
    credentials && typeof credentials === 'object'
      ? { ...(row.credentials || {}), ...credentials }
      : row.credentials;
  const nextConfig =
    config && typeof config === 'object' ? { ...(row.config || {}), ...config } : row.config;

  const { rows } = await query(
    `UPDATE channel_connections SET
       display_name = COALESCE($2, display_name),
       credentials = $3::jsonb,
       config = $4::jsonb,
       enabled = COALESCE($5, enabled),
       sync_enabled = COALESCE($6, sync_enabled),
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      connectionId,
      displayName ?? null,
      JSON.stringify(nextCreds || {}),
      JSON.stringify(nextConfig || {}),
      enabled === undefined ? null : Boolean(enabled),
      syncEnabled === undefined ? null : Boolean(syncEnabled),
    ]
  );
  return rows[0];
}

async function upsertUnitMapping({
  connectionId,
  unitId,
  externalListingId,
  externalRoomTypeId = null,
  externalRatePlanId = null,
} = {}) {
  if (!connectionId || !unitId || !externalListingId) {
    throw new Error('connectionId, unitId, and externalListingId are required');
  }
  const { rows } = await query(
    `INSERT INTO channel_unit_mappings
       (connection_id, unit_id, external_listing_id, external_room_type_id, external_rate_plan_id, updated_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (connection_id, unit_id) DO UPDATE SET
       external_listing_id = EXCLUDED.external_listing_id,
       external_room_type_id = EXCLUDED.external_room_type_id,
       external_rate_plan_id = EXCLUDED.external_rate_plan_id,
       updated_at = now()
     RETURNING *`,
    [connectionId, unitId, String(externalListingId).trim(), externalRoomTypeId, externalRatePlanId]
  );
  return rows[0];
}

module.exports = {
  listConnections,
  listApiConnections,
  runChannelSync,
  syncApiConnection,
  upsertApiConnection,
  updateApiConnection,
  upsertUnitMapping,
  listSyncLogs,
  normalizeOtaPlatform,
};
