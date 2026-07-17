const { query } = require('../config/db');

const MAX_ATTEMPTS = 100;
const TEMP_PASSWORD = 'Soul@123';

const ROLE_PREFIX = {
  admin: 'A',
  reservations: 'R',
  resale: 'S',
  hr: 'H',
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

function passwordPolicyOk(password) {
  const value = String(password || '');
  return value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value);
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
  passwordPolicyOk,
  passwordPolicyMessage,
  getPasswordPolicyChecks,
};
