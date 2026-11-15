const crypto = require('crypto');
const { query } = require('../config/db');

const MAX_ATTEMPTS = 100;

/**
 * Staff ID = role prefix + "-" + a random 4-digit number, e.g. RS-4827. The number is unique across every
 * prefix, so the door fingerprint machine can use the 4 digits alone. CEOs (admin) and owners have none.
 */
const ROLE_PREFIX = {
  reservations: 'RS',
  reservations_web: 'RS',
  reservations_manual: 'RS',
  reservations_manager: 'RM',
  unit_acquisition_agent: 'UA',
  unit_acquisition_manager: 'AM',
  operations: 'OP',
  operations_supervisor: 'OM',
  housekeeping: 'HK',
  housekeeping_supervisor: 'HS',
  resale: 'RA',
  resale_manager: 'SM',
  finance: 'FN',
  finance_manager: 'FM',
  hr: 'HR',
  hr_supervisor: 'HM',
  owners_relations: 'OE',
  marketing_pr: 'MA',
  web_developer: 'WD',
};

const STAFF_CODE_RE = /^([A-Z]{1,2})-(\d{4})$/;

/** Roles without a Staff ID (CEO, owner) have no prefix. */
function hasStaffId(role) {
  return Boolean(ROLE_PREFIX[role]);
}

/** The 4 digits of a Staff ID in the current format ("RS-4827" gives "4827"), else null. */
function staffCodeDigits(code) {
  const m = String(code || '').toUpperCase().match(STAFF_CODE_RE);
  return m ? m[2] : null;
}

function randomDigitString(length) {
  return Array.from({ length }, () => String(Math.floor(Math.random() * 10))).join('');
}

function isValidPattern(digits) {
  const value = String(digits || '');
  for (let i = 0; i < value.length - 2; i += 1) {
    if (value[i] === value[i + 1] && value[i] === value[i + 2]) return false;
  }
  return true;
}

/**
 * A new Staff ID for a role: its prefix + random 4 digits (1000-9999, no digit three times in a row) that no
 * other staff member has under any prefix. `keepDigits` reuses a person's number when only their role changes.
 * Returns null for roles without a Staff ID (CEO, owner).
 */
async function generateUniqueStaffCode(role, { keepDigits = null, exceptId = null } = {}) {
  const prefix = ROLE_PREFIX[role];
  if (!prefix) return null;
  const taken = async (digits) => {
    const params = [digits];
    // Also never reuse someone's old door-machine number, so a door punch cannot point at two people.
    let sql = `SELECT 1 FROM staff_users
               WHERE ((staff_code ~ '^[A-Z]{1,2}-[0-9]{4}$' AND right(staff_code, 4) = $1)
                  OR NULLIF(regexp_replace(COALESCE(legacy_staff_code, ''), '\\D', '', 'g'), '')::bigint = $1::bigint)`;
    if (exceptId) {
      params.push(exceptId);
      sql += ` AND id <> $2`;
    }
    const { rows } = await query(`${sql} LIMIT 1`, params);
    return Boolean(rows[0]);
  };
  if (keepDigits && /^\d{4}$/.test(keepDigits) && !(await taken(keepDigits))) return `${prefix}-${keepDigits}`;
  for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts += 1) {
    const digits = String(crypto.randomInt(1000, 10000));
    if (!isValidPattern(digits)) continue;
    if (!(await taken(digits))) return `${prefix}-${digits}`;
  }
  throw new Error('Unable to generate a unique staff ID');
}

/** Owners keep a code as typed; staff IDs are generated, never typed. */
function normalizeStaffCode(value) {
  const raw = String(value || '').trim();
  return raw || null;
}

/** A typed Staff ID in any spelling ("rs4827", "RS 4827") gives "RS-4827"; null when it isn't one. */
function canonicalStaffCode(value) {
  const m = String(value || '').trim().toUpperCase().match(/^([A-Z]{1,2})[\s-]*(\d{4})$/);
  return m ? `${m[1]}-${m[2]}` : null;
}

async function assertStaffCodeAvailable(code, exceptId = null) {
  if (!code) return;
  const params = [code];
  let sql = `SELECT id FROM staff_users WHERE lower(staff_code) = lower($1)`;
  if (exceptId) {
    params.push(exceptId);
    sql += ` AND id <> $2`;
  }
  const { rows } = await query(sql, params);
  if (rows[0]) {
    const err = new Error('This staff ID is already in use');
    err.status = 409;
    throw err;
  }
}

/** One-time temporary password that meets policy (shown once to the admin). */
function generateTempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const pick = (alphabet, n) =>
    Array.from({ length: n }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join('');
  const raw = `${pick(upper, 2)}${pick(lower, 4)}${pick(digits, 2)}${pick(upper, 1)}${pick(lower, 1)}`;
  return raw
    .split('')
    .sort(() => crypto.randomInt(0, 3) - 1)
    .join('');
}

/** @deprecated Use generateTempPassword(); kept for scripts that print a one-off value. */
const TEMP_PASSWORD = null;

function isPasswordPolicyExempt(_email) {
  return false;
}

function passwordPolicyOk(password, _email) {
  const value = String(password || '');
  return value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value);
}

async function applyExemptUserPasswords() {
  // Intentionally no-op: hardcoded password overrides were removed for security.
}

function passwordPolicyMessage() {
  return 'Password must be at least 8 characters and include uppercase and lowercase letters';
}

function getPasswordPolicyChecks(password) {
  const value = String(password || '');
  return {
    minLength: value.length >= 8,
    uppercase: /[A-Z]/.test(value),
    lowercase: /[a-z]/.test(value),
  };
}

module.exports = {
  TEMP_PASSWORD,
  generateTempPassword,
  ROLE_PREFIX,
  generateUniqueStaffCode,
  normalizeStaffCode,
  canonicalStaffCode,
  hasStaffId,
  staffCodeDigits,
  assertStaffCodeAvailable,
  isPasswordPolicyExempt,
  passwordPolicyOk,
  passwordPolicyMessage,
  getPasswordPolicyChecks,
  applyExemptUserPasswords,
};
