const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { TEMP_PASSWORD, generateUniqueStaffCode } = require('./staffIdentity');
const { normalizeOwnerPhone } = require('./ownerPhone');

/**
 * Remove the old demo owner account and related demo data.
 */
async function deleteMockOwner() {
  const { rows } = await query(
    `SELECT id FROM staff_users
     WHERE username = 'owner.demo'
        OR staff_code = 'O9001'
        OR lower(email) = 'owner.demo@soulhospitality.co'`
  );
  if (!rows.length) {
    console.log('[seed] No mock owner to delete');
    return;
  }

  for (const row of rows) {
    const id = row.id;
    await query(`DELETE FROM owner_payout_requests WHERE owner_id = $1`, [id]);
    await query(`DELETE FROM owner_settlements WHERE owner_id = $1`, [id]);
    await query(`DELETE FROM owner_units WHERE owner_id = $1`, [id]);
    await query(`DELETE FROM reservations WHERE notes = 'mock-owner-demo' AND created_by = $1`, [id]);
    // Also clear demo reservations created under admin but tagged for mock owner
    await query(`DELETE FROM reservations WHERE notes = 'mock-owner-demo'`);
    await query(`DELETE FROM staff_users WHERE id = $1`, [id]);
    console.log(`[seed] Deleted mock owner id=${id}`);
  }
}

/**
 * Create owner staff accounts from units.owner_name + units.owner_phone,
 * and link each unit via owner_units. Skips units missing name or phone.
 * Password: Soul@123 with is_first_login = 1.
 */
async function seedOwnersFromUnits() {
  if (process.env.SEED_OWNERS_FROM_UNITS === '0' || process.env.SEED_OWNERS_FROM_UNITS === 'false') {
    console.log('[seed] Owners-from-units skipped (SEED_OWNERS_FROM_UNITS=0)');
    return { created: 0, linked: 0, skipped: 0 };
  }

  await deleteMockOwner();

  const { rows: units } = await query(
    `SELECT id, owner_name, owner_phone
     FROM units
     WHERE nullif(trim(owner_name), '') IS NOT NULL
       AND nullif(trim(owner_phone), '') IS NOT NULL`
  );

  /** @type {Map<string, { phone: string, names: Map<string, number>, unitIds: string[] }>} */
  const byPhone = new Map();
  let skipped = 0;

  for (const u of units) {
    const phone = normalizeOwnerPhone(u.owner_phone);
    const name = String(u.owner_name || '').trim();
    if (!phone || !name) {
      skipped += 1;
      continue;
    }
    let entry = byPhone.get(phone);
    if (!entry) {
      entry = { phone, names: new Map(), unitIds: [] };
      byPhone.set(phone, entry);
    }
    entry.names.set(name, (entry.names.get(name) || 0) + 1);
    if (!entry.unitIds.includes(u.id)) entry.unitIds.push(u.id);
  }

  const hash = await bcrypt.hash(TEMP_PASSWORD, 10);
  let created = 0;
  let updated = 0;
  let linked = 0;

  for (const entry of byPhone.values()) {
    // Prefer the most frequent name; break ties with longest string
    let bestName = '';
    let bestCount = -1;
    for (const [name, count] of entry.names.entries()) {
      if (count > bestCount || (count === bestCount && name.length > bestName.length)) {
        bestName = name;
        bestCount = count;
      }
    }

    const username = entry.phone;
    const { rows: existing } = await query(
      `SELECT id, is_first_login FROM staff_users WHERE username = $1 LIMIT 1`,
      [username]
    );

    let ownerId;
    if (existing[0]) {
      ownerId = existing[0].id;
      await query(
        `UPDATE staff_users
         SET full_name = $1,
             role = 'owner',
             is_active = 1,
             password_hash = CASE WHEN is_first_login = 1 THEN $2 ELSE password_hash END,
             updated_at = now()
         WHERE id = $3`,
        [bestName, hash, ownerId]
      );
      updated += 1;
    } else {
      const staffCode = await generateUniqueStaffCode('owner');
      const { rows } = await query(
        `INSERT INTO staff_users (
           username, password_hash, email, full_name, role, staff_code,
           is_first_login, is_active
         ) VALUES ($1, $2, NULL, $3, 'owner', $4, 1, 1)
         RETURNING id`,
        [username, hash, bestName, staffCode]
      );
      ownerId = rows[0].id;
      created += 1;
    }

    for (const unitId of entry.unitIds) {
      // One owner per unit: clear other owner links then attach
      await query(`DELETE FROM owner_units WHERE unit_id = $1 AND owner_id <> $2`, [unitId, ownerId]);
      const { rowCount } = await query(
        `INSERT INTO owner_units (owner_id, unit_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [ownerId, unitId]
      );
      if (rowCount) linked += 1;
    }
  }

  console.log(
    `[seed] Owners from units → created=${created} updated=${updated} unitLinks=${linked} skippedUnits=${skipped} uniquePhones=${byPhone.size}`
  );
  console.log(`[seed] Owner temp password: ${TEMP_PASSWORD} (must change on first login)`);

  return { created, updated, linked, skipped, owners: byPhone.size };
}

module.exports = { seedOwnersFromUnits, deleteMockOwner };
