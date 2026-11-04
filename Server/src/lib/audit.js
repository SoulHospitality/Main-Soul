const { query } = require('../config/db');

// The audit_log insert trigger (migration 145) fills reservation_id, unit_id, unit_code and the
// actor snapshot from these fields, so callers only pass what they already know.
async function logAudit({ userId, action, entityType, entityId, details } = {}) {
  try {
    if (!action) return;
    await query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, COALESCE($5::jsonb, '{}'::jsonb))`,
      [
        userId || null,
        String(action),
        entityType ? String(entityType) : null,
        entityId != null ? String(entityId) : null,
        details != null ? JSON.stringify(details) : null,
      ]
    );
  } catch (err) {
    console.error('[audit]', err.message);
  }
}

const DIFF_IGNORED = new Set(['id', 'created_at', 'updated_at', 'search_vector', 'search_tsv']);
const MAX_CHANGES = 40;
const MAX_TEXT = 300;

function normalize(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (text === '') return null;
    // Numeric strings from pg (numeric/real columns) compare as numbers.
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
    return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
  }
  return undefined; // objects and arrays are not diffed
}

/**
 * Field-level changes between two rows: { field: { from, to } }.
 * Only scalar fields present in `after` are compared; `fields` limits the comparison.
 */
function diffChanges(before, after, fields) {
  if (!before || !after) return {};
  const keys = fields || Object.keys(after);
  const changes = {};
  let count = 0;
  for (const key of keys) {
    if (DIFF_IGNORED.has(key) || !(key in after) || !(key in before)) continue;
    const from = normalize(before[key]);
    const to = normalize(after[key]);
    if (from === undefined || to === undefined) continue;
    if (from === to) continue;
    changes[key] = { from, to };
    count += 1;
    if (count >= MAX_CHANGES) break;
  }
  return changes;
}

module.exports = { logAudit, diffChanges };
