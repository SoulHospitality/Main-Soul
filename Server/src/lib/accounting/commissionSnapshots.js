/**
 * Commission snapshots (D-12). Capture is automatic (DB trigger, migration 175). This module covers the
 * two things people do with them: list what needs review, and make an authorised correction.
 */
const { pool, query } = require('../../config/db');
const m = require('./money');

const PCT_FIELDS = ['company_commission_pct', 'company_commission_owner_pct', 'commission_tenant_pct'];

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
 * `rates`: { company_commission_pct, company_commission_owner_pct?, commission_tenant_pct?, sales_commission_pct? }
 * Never called automatically; the caller enforces who may correct (admin / finance manager).
 */
async function correctSnapshot({ reservationId, rates, reason, actorId, approvedBy = null }) {
  if (!reason || String(reason).trim().length < 10) {
    throw Object.assign(new Error('Give a reason of at least 10 characters for the correction'), { status: 400 });
  }
  if (!rates || rates.company_commission_pct == null) {
    throw Object.assign(new Error('The company commission % is required'), { status: 400 });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, unit_id, sales_person_id, commission_snapshot FROM reservations WHERE id = $1 FOR UPDATE`,
      [reservationId]
    );
    const r = rows[0];
    if (!r) throw Object.assign(new Error('Reservation not found'), { status: 404 });
    const prev = r.commission_snapshot || null;
    const unit = { ...(prev?.unit || { id: r.unit_id }) };
    for (const f of PCT_FIELDS) if (rates[f] != null) unit[f] = validPct(rates[f]);
    const salesperson = rates.sales_commission_pct != null || prev?.salesperson
      ? { ...(prev?.salesperson || { id: r.sales_person_id }), ...(rates.sales_commission_pct != null ? { sales_commission_pct: validPct(rates.sales_commission_pct) } : {}) }
      : null;
    const corrected = {
      ...(prev || { version: 1, basis: null }),
      captured_on: 'correction',
      effective_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }),
      unit,
      salesperson,
    };
    await client.query(`SELECT set_config('app.commission_correction', 'on', true)`);
    await client.query(
      `UPDATE reservations SET commission_snapshot = $2, commission_snapshot_at = now(), commission_snapshot_status = 'corrected' WHERE id = $1`,
      [reservationId, JSON.stringify(corrected)]
    );
    await client.query(
      `INSERT INTO reservation_commission_corrections (reservation_id, previous, corrected, reason, corrected_by, approved_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [reservationId, prev ? JSON.stringify(prev) : null, JSON.stringify(corrected), String(reason).trim(), actorId, approvedBy]
    );
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
