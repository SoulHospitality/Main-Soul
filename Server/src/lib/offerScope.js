/**
 * Where a promo code or an offer applies: some units, some projects (compounds), some destinations
 * (areas). Empty lists mean everywhere. A unit matches when it is in any of the three lists.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanList(value, { max = 200, uuid = false } = {}) {
  const raw = Array.isArray(value) ? value : value == null || value === '' ? [] : String(value).split(',');
  const out = [];
  for (const item of raw) {
    const s = String(item ?? '').trim().slice(0, 120);
    if (!s || (uuid && !UUID_RE.test(s))) continue;
    if (!out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Normalised scope from a request body. */
function scopeFrom(body = {}) {
  return {
    unit_ids: cleanList(body.unit_ids, { uuid: true, max: 500 }),
    projects: cleanList(body.projects),
    destinations: cleanList(body.destinations),
  };
}

function isEverywhere(scope) {
  return !(scope?.unit_ids?.length || scope?.projects?.length || scope?.destinations?.length);
}

const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** True when the scope covers this unit ({ id, compound|project, area }). */
function appliesToUnit(scope, unit) {
  if (isEverywhere(scope)) return true;
  if (!unit) return false;
  if ((scope.unit_ids || []).some((id) => same(id, unit.id))) return true;
  const project = unit.compound || unit.project;
  if (project && (scope.projects || []).some((p) => same(p, project) || same(p, unit.project))) return true;
  if (unit.area && (scope.destinations || []).some((d) => same(d, unit.area))) return true;
  return false;
}

/** Short words for where it applies, e.g. "Marassi, Hacienda Bay · 3 units". */
function describeScope(scope) {
  if (isEverywhere(scope)) return 'All units';
  const parts = [];
  if (scope.destinations?.length) parts.push(scope.destinations.join(', '));
  if (scope.projects?.length) parts.push(scope.projects.join(', '));
  if (scope.unit_ids?.length) parts.push(`${scope.unit_ids.length} unit${scope.unit_ids.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

module.exports = { scopeFrom, isEverywhere, appliesToUnit, describeScope, cleanList };
