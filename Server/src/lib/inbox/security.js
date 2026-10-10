const crypto = require('crypto');
const { config } = require('./config');

let cachedKey = null;
let cachedFor = null;
function key() {
  const secret = config.tokenSecret;
  if (!cachedKey || cachedFor !== secret) {
    cachedKey = crypto.scryptSync(secret, 'soul-inbox-token-key', 32);
    cachedFor = secret;
  }
  return cachedKey;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Channel access tokens are encrypted at rest (AES-256-GCM). */
function encrypt(plaintext) {
  if (!plaintext) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

function decrypt(payload) {
  if (!payload) return null;
  const [iv, tag, enc] = payload.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/** Meta signs every webhook body with the app secret (X-Hub-Signature-256). */
function verifyMetaSignature(rawBody, header, appSecret) {
  if (!rawBody || !header || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const given = header.slice('sha256='.length);
  if (given.length !== expected.length || !/^[0-9a-f]+$/i.test(given)) return false;
  return crypto.timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
}

module.exports = { randomToken, encrypt, decrypt, verifyMetaSignature };
