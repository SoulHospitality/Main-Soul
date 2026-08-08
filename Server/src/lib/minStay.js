const { query } = require('../config/db');

const DEFAULT_MIN_STAY_NIGHTS = 4;
/** @deprecated Prefer location_projects.min_nights; kept for beach-fee helpers. */
const MIN_STAY_NIGHTS = DEFAULT_MIN_STAY_NIGHTS;
const GAIA_MIN_STAY_NIGHTS = 3;

/** Project names containing "GAIA" (case-insensitive). Used for beach fee modes, not min stay. */
function isGaiaUnit(unit = {}) {
  const fields = [
    unit.project,
    unit.projectName,
    unit.project_name,
    unit.compound,
    unit.destination,
    unit.area,
    unit.location,
  ];
  return fields.some((v) => String(v || '').toLowerCase().includes('gaia'));
}

function parseMinNightsValue(raw, fallback = DEFAULT_MIN_STAY_NIGHTS) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

/**
 * Runtime min stay for a unit row.
 * Prefers denormalized units.min_nights (synced from location_projects).
 */
function getMinimumStayNights(unit = {}) {
  return parseMinNightsValue(unit?.min_nights, DEFAULT_MIN_STAY_NIGHTS);
}

/**
 * Look up catalog min_nights for a project/compound name when writing units.
 */
async function lookupProjectMinNights({ project, compound } = {}) {
  const candidates = [...new Set(
    [project, compound]
      .map((v) => String(v || '').trim().toLowerCase())
      .filter(Boolean)
  )];
  if (!candidates.length) return DEFAULT_MIN_STAY_NIGHTS;

  const { rows } = await query(
    `SELECT min_nights, normalized_name
     FROM location_projects
     WHERE normalized_name = ANY($1::text[])
     ORDER BY CASE WHEN normalized_name = $2 THEN 0 ELSE 1 END, id ASC
     LIMIT 1`,
    [candidates, candidates[0]]
  );
  return parseMinNightsValue(rows[0]?.min_nights, DEFAULT_MIN_STAY_NIGHTS);
}

/**
 * When a project min stay changes, push it to all matching units.
 */
async function syncUnitsMinNightsForProject({ name, previousName, minNights } = {}) {
  const nights = parseMinNightsValue(minNights, DEFAULT_MIN_STAY_NIGHTS);
  const names = [...new Set(
    [name, previousName]
      .map((v) => String(v || '').trim().toLowerCase())
      .filter(Boolean)
  )];
  if (!names.length) return { rowCount: 0 };

  const result = await query(
    `UPDATE units
     SET min_nights = $1, updated_at = now()
     WHERE lower(trim(COALESCE(project, ''))) = ANY($2::text[])
        OR lower(trim(COALESCE(compound, ''))) = ANY($2::text[])`,
    [nights, names]
  );
  return { rowCount: result.rowCount || 0 };
}

module.exports = {
  DEFAULT_MIN_STAY_NIGHTS,
  MIN_STAY_NIGHTS,
  GAIA_MIN_STAY_NIGHTS,
  isGaiaUnit,
  parseMinNightsValue,
  getMinimumStayNights,
  lookupProjectMinNights,
  syncUnitsMinNightsForProject,
};
