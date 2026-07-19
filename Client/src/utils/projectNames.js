/**
 * Canonical project / compound display names.
 * Gaia / gaia / gAiA → GAIA
 */
export function normalizeProjectName(name) {
  const raw = String(name || '').trim();
  if (!raw) return raw;
  if (raw.toLowerCase() === 'gaia') return 'GAIA';
  return raw;
}
