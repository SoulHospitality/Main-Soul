/**
 * Commission snapshots (D-12). Capture is automatic (DB trigger, migration 175). This module covers the
 * two things people do with them: list what needs review, and make an authorised correction.
 */
const { pool, query } = require('../../config/db');
const m = require('./money');
const { attestActor } = require('./identity');

/** Who may correct saved rates until the segregation-of-duties decision (D-14) sets finance roles. */
const CORRECTION_ROLES = ['admin'];

/** Confirmed stays whose original rates are unknown or need re-checking (no personal data). */
async function listForReview({ limit = 200 } = {}) {
  const { rows } = await query(
    `SELECT * FROM reservation_commission_review ORDER BY check_in DESC LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 200, 1), 1000)]
  );
  return rows;
}

function validPct(v) {
  const d = m.money(v, { allowEmpty: false });
  if (d.lt(0) || d.gt(100)) throw Object.assign(new Error('Percentages must be between 0 and 100'), { status: 400 });
  return d.toString();
}

/**
 * Authorised correction: sets the rates a reservation should use, with a reason and who did it.
 * `rates`: { company_pct, tenant_deduction_pct?, sales_pct? } (the applied rates).
 * Never called automatically. The actor (and approver, if given) must be active admins; the database
 * trigger writes the before/after log row (migration 175), so the change cannot go unrecorded.
 */
async function correctSnapshot({ reservationId, rates, reason, actorId, approvedBy = null }) {
  if (!reason || String(reason).trim().length < 10) {
    throw Object.assign(new Error('Give a reason of at least 10 characters for the correction'), { status: 400 });
  }
  if (!rates || rates.company_pct == null) {
    throw Object.assign(new Error('The company commission % is required'), { status: 400 });
  }
  if (approvedBy != null && Number(approvedBy) === Number(actorId)) {
    throw Object.assign(new Error('The approver must be a different person from the one making the correction'), { status: 400 });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const people = await client.query(
      `SELECT id, role FROM staff_users WHERE id = ANY($1::int[]) AND COALESCE(is_active::text, '1') NOT IN ('0', 'false', 'f')`,
      [[actorId, approvedBy].filter((x) => x != null).map(Number)]
    );
    const byId = new Map(people.rows.map((p) => [Number(p.id), p.role]));
    if (!CORRECTION_ROLES.includes(byId.get(Number(actorId)))) {
      throw Object.assign(new Error('Only an active admin can correct commission rates'), { status: 403 });
    }
    if (approvedBy != null && !CORRECTION_ROLES.includes(byId.get(Number(approvedBy)))) {
      throw Object.assign(new Error('The approver must be an active admin'), { status: 403 });
    }
    const { rows } = await client.query(
      `SELECT id, unit_id, sales_person_id, commission_snapshot FROM reservations WHERE id = $1 FOR UPDATE`,
      [reservationId]
    );
    const r = rows[0];
    if (!r) throw Object.assign(new Error('Reservation not found'), { status: 404 });
    const prev = r.commission_snapshot || null;
    const prevApplied = prev?.applied || {};
    const applied = {
      company_pct: validPct(rates.company_pct),
      company_pct_source: 'correction',
      tenant_deduction_pct: rates.tenant_deduction_pct != null ? validPct(rates.tenant_deduction_pct) : String(prevApplied.tenant_deduction_pct ?? 0),
      sales_pct: rates.sales_pct != null ? validPct(rates.sales_pct) : prevApplied.sales_pct ?? null,
    };
    const corrected = {
      ...(prev || { version: 2, basis: null, unit: { id: r.unit_id }, salesperson: r.sales_person_id ? { id: r.sales_person_id } : null }),
      version: 2,
      captured_on: 'correction',
      effective_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }),
      applied,
    };
    // Verified identity: the corrector signs a claim for this transaction; the database refuses the
    // correction unless the claimed corrector is that verified actor. An approver must have recorded their
    // approval beforehand (identity.recordApproval, purpose commission_correction, subject reservation id).
    await attestActor(client, actorId);
    // The database trigger writes the correction log from these settings, so a change cannot go unrecorded.
    await client.query(
      `SELECT set_config('app.commission_correction', 'on', true),
              set_config('app.commission_correction_reason', $1, true),
              set_config('app.commission_correction_actor', $2, true),
              set_config('app.commission_correction_approver', $3, true)`,
      [String(reason).trim(), String(actorId), approvedBy != null ? String(approvedBy) : '']
    );
    await client.query(`UPDATE reservations SET commission_snapshot = $2 WHERE id = $1`, [reservationId, JSON.stringify(corrected)]);
    await client.query(`SELECT set_config('app.commission_correction', 'off', true)`);
    await client.query('COMMIT');
    return corrected;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { listForReview, correctSnapshot };
