const { normalizeName, namesAreAliases, nameMatchScore } = require('./salesNameMatch');

/** Canonical operations agents and every spreadsheet spelling that means them. */
const OPS_AGENT_GROUPS = [
  {
    canonical: 'Ahmed Osama',
    aliases: ['ahmed osama', 'osama'],
  },
  {
    canonical: 'Abdullah Al Nabarawi',
    aliases: [
      'abdullah al nabarawi',
      'abdullah nabarawy',
      'abdullah nabrawy',
      'nabrawy',
      'nabarawy',
    ],
  },
  {
    canonical: 'Ahmed Sherif',
    aliases: ['ahmed sherif', 'ahmed sharif'],
  },
  {
    canonical: 'Amro Mousa',
    aliases: ['amro mousa', 'amr mousa', 'amro moussa', 'amr moussa'],
  },
  {
    canonical: 'Mohamed Tarek',
    aliases: ['mohamed tarek', 'mohammad tarek', 'tarek'],
  },
  {
    canonical: 'Emery Adham',
    aliases: ['emery adham', 'emry adham', 'emery', 'emry'],
  },
  {
    canonical: 'Mazen Mohamed',
    aliases: ['mazen mohamed', 'mazen'],
  },
];

const ALIAS_TO_CANONICAL = new Map();
for (const group of OPS_AGENT_GROUPS) {
  for (const alias of group.aliases) ALIAS_TO_CANONICAL.set(alias, group.canonical);
  ALIAS_TO_CANONICAL.set(normalizeName(group.canonical), group.canonical);
}

function canonicalOpsAgentFromLabel(value) {
  const n = normalizeName(value);
  if (!n) return null;
  return ALIAS_TO_CANONICAL.get(n) || null;
}

function matchOpsStaff(canonicalName, staffList) {
  const wanted = normalizeName(canonicalName);
  if (!wanted) return null;
  const opsFirst = [...(staffList || [])].sort((a, b) => {
    const ar = a.role === 'operations' ? 0 : 1;
    const br = b.role === 'operations' ? 0 : 1;
    return ar - br;
  });

  const aliasHit = opsFirst.find((s) => namesAreAliases(canonicalName, s.full_name || s.name || ''));
  if (aliasHit) return aliasHit;

  let best = null;
  let bestScore = 0;
  for (const staff of opsFirst) {
    const score = nameMatchScore(canonicalName, staff.full_name || staff.name || '');
    if (score > bestScore) {
      bestScore = score;
      best = staff;
    }
  }
  if (best && bestScore >= 0.74) return best;
  return null;
}

module.exports = {
  OPS_AGENT_GROUPS,
  canonicalOpsAgentFromLabel,
  matchOpsStaff,
};
