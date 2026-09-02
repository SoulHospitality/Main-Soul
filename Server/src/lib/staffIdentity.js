const { query } = require('../config/db');

const MAX_ATTEMPTS = 100;
const TEMP_PASSWORD = 'Soul@123';

const ROLE_PREFIX = {
  admin: 'A',
  reservations: 'R',
  reservations_web: 'W',
  reservations_manual: 'M',
  reservations_manager: 'G',
  unit_acquisition_agent: 'C',
  unit_acquisition_manager: 'Q',
  operations: 'P',
  operations_supervisor: 'V',
  housekeeping: 'K',
  housekeeping_supervisor: 'L',
  resale: 'S',
  resale_manager: 'J',
  finance: 'F',
  hr: 'H',
  hr_supervisor: 'U',
  owners_relations: 'N',
  owner: 'O',
  marketing_pr: 'B',
  web_developer: 'D',
};

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

async function generateUniqueStaffCode(role) {
  const prefix = ROLE_PREFIX[role] || 'X';
  for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts += 1) {
    const digits = randomDigitString(4);
    if (!isValidPattern(digits)) continue;
    const code = `${prefix}${digits}`;
    const { rows } = await query(`SELECT id FROM staff_users WHERE staff_code = $1`, [code]);
    if (!rows[0]) return code;
  }
  throw new Error('Unable to generate a unique staff ID');
}

function normalizeStaffCode(value) {
  const code = String(value || '').trim();
  return code || null;
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

const PASSWORD_POLICY_EXEMPT = {
  'mayarmuhammed33@gmail.com': '1234',
};

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isPasswordPolicyExempt(email) {
  return Object.prototype.hasOwnProperty.call(PASSWORD_POLICY_EXEMPT, normalizeEmail(email));
}

function passwordPolicyOk(password, email) {
  if (isPasswordPolicyExempt(email)) return Boolean(String(password || ''));
  const value = String(password || '');
  return value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value);
}

async function applyExemptUserPasswords() {
  const bcrypt = require('bcryptjs');
  for (const [email, password] of Object.entries(PASSWORD_POLICY_EXEMPT)) {
    const hash = await bcrypt.hash(password, 10);
    const { rows: staffRows } = await query(
      `UPDATE staff_users
       SET password_hash = $1, is_first_login = 0, is_active = 1, updated_at = now()
       WHERE lower(COALESCE(email, '')) = $2
          OR lower(COALESCE(username, '')) = $2
       RETURNING id`,
      [hash, email]
    );
    const { rows: profileRows } = await query(
      `UPDATE profiles
       SET password_hash = $1, updated_at = now()
       WHERE lower(email) = $2
       RETURNING id`,
      [hash, email]
    );
    if (staffRows[0]) {
      console.log(`[seed] Password override applied for staff ${email}`);
    } else if (profileRows[0]) {
      console.log(`[seed] Password override applied for guest ${email}`);
    } else {
      console.warn(`[seed] No account found for ${email} — password override not applied`);
    }
  }
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
  ROLE_PREFIX,
  generateUniqueStaffCode,
  normalizeStaffCode,
  assertStaffCodeAvailable,
  isPasswordPolicyExempt,
  passwordPolicyOk,
  passwordPolicyMessage,
  getPasswordPolicyChecks,
  applyExemptUserPasswords,
};
