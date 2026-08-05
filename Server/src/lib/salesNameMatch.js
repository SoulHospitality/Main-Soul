/**
 * Fuzzy matching between reservation "Sales / Owner" labels and staff full names.
 * Handles spacing, order, accents-ish ASCII, and small typos (Hesham/Hisham).
 */

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return normalizeName(value)
    .split(' ')
    .filter((t) => t.length > 1);
}

function levenshtein(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const rows = s.length + 1;
  const cols = t.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) matrix[i][0] = i;
  for (let j = 0; j < cols; j++) matrix[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[s.length][t.length];
}

/** 0..1 similarity from Levenshtein. */
function stringSimilarity(a, b) {
  const s = normalizeName(a);
  const t = normalizeName(b);
  if (!s || !t) return 0;
  if (s === t) return 1;
  const dist = levenshtein(s, t);
  return 1 - dist / Math.max(s.length, t.length);
}

/**
 * Score how well a sales label matches a staff name.
 * Higher is better. Typical good matches are >= DEFAULT_MIN_SCORE.
 */
function nameMatchScore(salesLabel, staffName) {
  const label = normalizeName(salesLabel);
  const staff = normalizeName(staffName);
  if (!label || !staff) return 0;
  if (/^owner\b/.test(label)) return 0;
  if (label === staff) return 1;

  const direct = stringSimilarity(label, staff);
  const labelTokens = tokens(label);
  const staffTokens = tokens(staff);
  if (!labelTokens.length || !staffTokens.length) return direct;

  // Token-set compare (order-insensitive): Amira Hesham vs Hesham Amira
  const sortedLabel = [...labelTokens].sort().join(' ');
  const sortedStaff = [...staffTokens].sort().join(' ');
  const sortedScore = stringSimilarity(sortedLabel, sortedStaff);

  // Each staff token must find a close label token (typo-tolerant)
  let tokenHits = 0;
  let worstStaffToken = 1;
  for (const st of staffTokens) {
    let best = 0;
    for (const lt of labelTokens) {
      best = Math.max(best, stringSimilarity(st, lt));
    }
    worstStaffToken = Math.min(worstStaffToken, best);
    if (best >= 0.8) tokenHits += 1;
  }
  const tokenCoverage = tokenHits / staffTokens.length;

  // Containment: "Amira Hesham Mohamed" label vs staff "Amira Hesham"
  const contained =
    label.includes(staff) || staff.includes(label)
      ? 0.94
      : staffTokens.length >= 2 && tokenCoverage >= 1
        ? 0.9
        : 0;

  let score = Math.max(direct, sortedScore, tokenCoverage * 0.95, contained);

  // Shorter label than staff name ("Tarek" vs "Tarek Mostafa"): judge only on
  // the tokens the label actually provides. Ties between several staff sharing
  // that token are rejected later as ambiguous.
  if (labelTokens.length < staffTokens.length) {
    let labelHits = 0;
    for (const lt of labelTokens) {
      let best = 0;
      for (const st of staffTokens) best = Math.max(best, stringSimilarity(lt, st));
      if (best >= 0.85) labelHits += 1;
    }
    score = Math.max(score, (labelHits / labelTokens.length) * 0.9);
  } else if (staffTokens.length >= 2 && worstStaffToken < 0.78) {
    // The label names a different last name → different person
    score = Math.min(score, 0.7);
  }

  return score;
}

const DEFAULT_MIN_SCORE = 0.74;

/**
 * Pick the closest staff user for a sales label.
 * Returns { staff, score } or null if below threshold / ambiguous.
 */
function matchSalesLabelToStaff(salesLabel, staffList, { minScore = DEFAULT_MIN_SCORE } = {}) {
  const label = String(salesLabel || '').trim();
  if (!label || /^owner$/i.test(label)) return null;

  const ranked = (staffList || [])
    .map((staff) => ({
      staff,
      score: nameMatchScore(label, staff.full_name || staff.name || ''),
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) return null;

  // Ambiguous: top two nearly tied → skip rather than mis-assign
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < 0.05 && ranked[1].score >= minScore) {
    return null;
  }

  return ranked[0];
}

/** True if this reservation sales label belongs to the given staff user. */
function salesLabelBelongsToUser(salesLabel, user, { minScore = DEFAULT_MIN_SCORE } = {}) {
  if (!user?.full_name) return false;
  return nameMatchScore(salesLabel, user.full_name) >= minScore;
}

module.exports = {
  normalizeName,
  nameMatchScore,
  matchSalesLabelToStaff,
  salesLabelBelongsToUser,
  DEFAULT_MIN_SCORE,
};
