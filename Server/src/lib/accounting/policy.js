/**
 * Recording an accounting policy and its two approvals (D-01 revenue presentation; VAT base). The database
 * (migration 176) enforces every rule: each approver is an active admin who records their own approval in their own
 * verified transaction; the recorder is a different, verified staff member; the written references are mandatory;
 * an approved policy can never be edited or deleted (only retired by a verified admin).
 */
const { pool: defaultPool } = require('../../config/db');
const { attestActor, recordApproval } = require('./identity');

const PURPOSES = { d01: 'policy_d01', vat: 'policy_vat' };

/** An admin records their own approval of `version` for `purpose` ('d01' or 'vat'). */
async function approve({ version, purpose, actorId }) {
  if (!PURPOSES[purpose]) throw new Error(`purpose must be d01 or vat (got ${purpose})`);
  if (!version || !actorId) throw new Error('version and actorId are required');
  return recordApproval({ purpose: PURPOSES[purpose], subject: version, approverId: Number(actorId) });
}

/**
 * The recorder (a verified staff member who is NOT one of the approvers) records the approved policy, citing both
 * written approvals. `settings` must contain revenue_presentation and vat_base.
 */
async function recordApproved({ version, effectiveFrom, settings, recorderId, d01ApproverId, d01Ref, vatApproverId, vatRef }, { pool = defaultPool } = {}) {
  for (const [k, v] of Object.entries({ version, effectiveFrom, recorderId, d01ApproverId, d01Ref, vatApproverId, vatRef })) {
    if (v == null || String(v).trim() === '') throw new Error(`${k} is required`);
  }
  if (!settings || !settings.revenue_presentation || !settings.vat_base) throw new Error('settings must include revenue_presentation and vat_base');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await attestActor(client, Number(recorderId));
    const { rows } = await client.query(
      `INSERT INTO ledger_policies (version, effective_from, settings, status, approved_by, approved_at, approval_ref,
                                    vat_approved_by, vat_approved_at, vat_approval_ref, created_by)
       VALUES ($1, $2::date, $3::jsonb, 'approved', $4, now(), $5, $6, now(), $7, $8) RETURNING version, status, effective_from::text`,
      [version, effectiveFrom, JSON.stringify(settings), Number(d01ApproverId), String(d01Ref), Number(vatApproverId), String(vatRef), Number(recorderId)]
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { approve, recordApproved, PURPOSES };
