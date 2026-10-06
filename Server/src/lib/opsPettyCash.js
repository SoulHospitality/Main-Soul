const { query } = require('../config/db');

/** Petty cash box for a unit: Ain Sokhna units use 'sokhna', everything else 'north_coast'. */
async function pettyLocationForUnit(unitId) {
  if (!unitId) return 'north_coast';
  const { rows } = await query(
    `SELECT concat_ws(' ', area, city, project, compound) AS place FROM units WHERE id = $1`,
    [unitId]
  );
  return /sokhna/i.test(String(rows[0]?.place || '')) ? 'sokhna' : 'north_coast';
}

/**
 * Mirror an ops cash movement into the petty cash box. These rows carry a `source`
 * because the ledger already journals the underlying payment / refund.
 */
async function recordOpsPettyCash({
  entryType,
  amount,
  description,
  unitId,
  reservationId,
  userId,
  source,
  sourceRef,
  proofUrl,
  proofName,
  notes,
}) {
  const amt = Math.round((Number(amount) || 0) * 100) / 100;
  if (!(amt > 0) || !userId) return null;
  const location = await pettyLocationForUnit(unitId);
  const { rows } = await query(
    `INSERT INTO petty_cash (
       location, description, amount, entry_type, entry_date, created_by,
       unit_id, linked_reservation_id, paid_by, notes, status,
       transfer_proof_path, transfer_proof_name, source, source_ref
     ) VALUES ($1,$2,$3,$4,(timezone('Africa/Cairo', now()))::date,$5,$6,$7,'company',$8,'open',$9,$10,$11,$12)
     RETURNING *`,
    [
      location,
      String(description || '').slice(0, 500),
      amt,
      entryType === 'in' ? 'in' : 'out',
      userId,
      unitId || null,
      reservationId || null,
      notes || null,
      proofUrl || null,
      proofName || null,
      source,
      sourceRef != null ? String(sourceRef) : null,
    ]
  );
  return rows[0] || null;
}

module.exports = { pettyLocationForUnit, recordOpsPettyCash };
