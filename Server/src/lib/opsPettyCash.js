const { query } = require('../config/db');

function drawerFromText(area, blob, destination) {
  const dest = String(destination || area || '');
  const text = `${dest} ${blob || ''}`;
  if (/ain\s*sokhna|sokhna|galala/i.test(text)) return 'sokhna';
  if (/north\s*coast/i.test(text)) return 'north_coast';
  return null;
}

/** North Coast destinations → north_coast. Ain Sokhna → sokhna. */
async function classifyUnitDrawer(unitId) {
  if (!unitId) return null;
  const { rows } = await query(
    `SELECT area, city, project, compound FROM units WHERE id = $1`,
    [unitId]
  );
  const unit = rows[0];
  if (!unit) return null;
  const blob = [unit.area, unit.city, unit.project, unit.compound].filter(Boolean).join(' ');
  const direct = drawerFromText(unit.area, blob);
  if (direct) return direct;
  try {
    const { rows: projects } = await query(
      `SELECT destination FROM location_projects
       WHERE lower(name) = lower($1) OR lower(name) = lower($2)
       LIMIT 1`,
      [unit.project || '', unit.compound || '']
    );
    return drawerFromText(projects[0]?.destination, blob);
  } catch (err) {
    if (err.code === '42P01') return null;
    throw err;
  }
}

async function pettyLocationForUnit(unitId) {
  return (await classifyUnitDrawer(unitId)) || 'north_coast';
}

async function assertPettyUnitLocation(unitId, location) {
  if (!unitId) return null;
  const drawer = await classifyUnitDrawer(unitId);
  if (!drawer) return 'Choose a unit in a North Coast or Ain Sokhna destination';
  if (drawer === location) return null;
  return drawer === 'sokhna'
    ? 'Ain Sokhna units belong in the Sokhna petty cash'
    : 'North Coast units belong in the North Coast petty cash';
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
       transfer_proof_path, transfer_proof_name, source, source_ref, entry_kind
     ) VALUES ($1,$2,$3,$4,(timezone('Africa/Cairo', now()))::date,$5,$6,$7,'company',$8,'open',$9,$10,$11,$12,'ops_collection')
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

module.exports = {
  pettyLocationForUnit,
  classifyUnitDrawer,
  assertPettyUnitLocation,
  recordOpsPettyCash,
};
