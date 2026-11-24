/**
 * Verified identity for the ledger (review finding H3).
 *
 * The database never trusts a caller-supplied staff id for ledger actions. Instead, inside the SAME
 * transaction as the action, this module signs a short-lived claim with a key held in the application
 * environment, and the database checks it (migration 176: ledger_verified_actor):
 *
 *   v1.<key_id>.<actor_id>.<txid>.<expiry_epoch>.act.<hex HMAC-SHA256("v1|key_id|actor|txid|expiry|act")>
 *
 * - The claim is bound to the current transaction id, so it cannot be replayed in another transaction.
 * - The database holds the same key in ledger_identity_keys. Once the application connects as the
 *   restricted role (docs/finance/db-security), it cannot read that table or alter the checking functions,
 *   so a claim can only come from code holding LEDGER_IDENTITY_KEY.
 * - Callers must pass the id of the AUTHENTICATED user (req.user.id from the verified JWT) and nothing else.
 *
 * Configuration (application environment, never committed):
 *   LEDGER_IDENTITY_KEY_ID  e.g. "k2026a"           (letters, digits, - or _)
 *   LEDGER_IDENTITY_KEY     64+ hex characters (≥ 32 bytes), the same secret the DBA stores in the database
 */
const crypto = require('crypto');

class IdentityError extends Error {
  constructor(message, code = 'IDENTITY_NOT_CONFIGURED', status = 503) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const APPROVAL_PURPOSES = ['policy_d01', 'policy_vat', 'closed_period_adjustment', 'commission_correction'];

function identityKey() {
  const id = process.env.LEDGER_IDENTITY_KEY_ID;
  const hex = process.env.LEDGER_IDENTITY_KEY;
  if (!id || !hex) return null;
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new IdentityError('LEDGER_IDENTITY_KEY_ID has an invalid format');
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 64 || hex.length % 2) {
    throw new IdentityError('LEDGER_IDENTITY_KEY must be at least 64 hex characters (32 bytes)');
  }
  return { id, secret: Buffer.from(hex, 'hex') };
}

function signClaim({ keyId, secret, actorId, txid, expiry }) {
  const payload = ['v1', keyId, String(actorId), String(txid), String(expiry), 'act'];
  const sig = crypto.createHmac('sha256', secret).update(payload.join('|')).digest('hex');
  return [...payload, sig].join('.');
}

/**
 * Attest that `actorId` is acting in the current transaction of `db` (a client inside BEGIN … COMMIT).
 * No-op when actorId is null/undefined (system entries name no person).
 */
async function attestActor(db, actorId, { ttlSeconds = 120 } = {}) {
  if (actorId == null) return null;
  if (!/^[0-9]{1,9}$/.test(String(actorId))) throw new IdentityError('Actor must be a numeric staff id', 'BAD_ACTOR', 400);
  const key = identityKey();
  if (!key) {
    throw new IdentityError('Ledger identity signing is not configured (LEDGER_IDENTITY_KEY_ID / LEDGER_IDENTITY_KEY)');
  }
  const { rows } = await db.query(`SELECT txid_current()::text AS txid, extract(epoch FROM clock_timestamp())::bigint AS now`);
  const claim = signClaim({ keyId: key.id, secret: key.secret, actorId, txid: rows[0].txid, expiry: Number(rows[0].now) + ttlSeconds });
  await db.query(`SELECT set_config('app.identity_claim', $1, true)`, [claim]);
  return claim;
}

async function withTransaction(client, fn) {
  if (client) return fn(client);
  const { pool } = require('../../config/db');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/**
 * The approver records an approval in their OWN verified transaction, before the action it approves.
 * purpose: policy_d01 | policy_vat (subject = policy version) · closed_period_adjustment (subject = the
 * adjustment's idempotency key) · commission_correction (subject = reservation id).
 */
async function recordApproval({ purpose, subject, approverId }, { client = null } = {}) {
  if (!APPROVAL_PURPOSES.includes(purpose)) throw new IdentityError(`Unknown approval purpose ${purpose}`, 'BAD_PURPOSE', 400);
  if (!subject) throw new IdentityError('An approval needs a subject', 'BAD_SUBJECT', 400);
  return withTransaction(client, async (db) => {
    await attestActor(db, approverId);
    const { rows } = await db.query(
      `INSERT INTO ledger_approvals (purpose, subject, approver_id) VALUES ($1, $2, $3) RETURNING *`,
      [purpose, String(subject), Number(approverId)]
    );
    return rows[0];
  });
}

module.exports = { attestActor, recordApproval, signClaim, identityKey, IdentityError, APPROVAL_PURPOSES };
