/**
 * Migrate ALL possible financial/ops data from old Soulhospitality PMS → Main Soul.
 *
 * Usage:
 *   node scripts/migrate-old-pms.js --dry-run
 *   node scripts/migrate-old-pms.js --apply
 *
 * Requires:
 *   Server/.env            → DATABASE_URL (new)
 *   Server/.env.old-pms    → OLD_PMS_DATABASE_URL (old)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.old-pms') });
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const APPLY = process.argv.includes('--apply');
const DRY = !APPLY;

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function isoDate(v) {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function mapRole(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'admin' || r === 'finance') return 'admin';
  if (r === 'owner' || r === 'owner_experience') return 'owner';
  if (r === 'operation_manager' || r === 'operation_specialist') return 'reservations';
  if (r === 'hr') return 'hr';
  if (r === 'resale') return 'resale';
  // acquisition_reservation, broker, etc.
  return 'reservations_manual';
}

function mapPaymentStatus(s) {
  const v = String(s || '').toLowerCase();
  if (v === 'paid') return 'paid';
  if (v === 'partial') return 'partial';
  return 'pending'; // unpaid → pending
}

function mapReservationStatus(row) {
  const s = String(row.status || '').toLowerCase();
  if (['confirmed', 'cancelled', 'checked_in', 'checked_out', 'pending'].includes(s)) return s;
  if (row.is_hold) return 'pending';
  return 'pending';
}

function mapPaymentMethod(m) {
  const v = String(m || '').toLowerCase();
  const allowed = new Set(['cash', 'bank_transfer', 'credit_card', 'online', 'paymob_card', 'instapay']);
  if (allowed.has(v)) return v;
  return 'bank_transfer';
}

function destinationForProject(project) {
  const p = String(project || '').toLowerCase();
  if (p.includes('galala') || p.includes('sokhna') || p.includes('porto')) return 'Ain Sokhna';
  if (p.includes('gouna') || p.includes('makadi') || p.includes('hurghada')) return 'Red Sea';
  return 'North Coast';
}

function slugify(s) {
  const base = norm(s) || `unit-${crypto.randomBytes(3).toString('hex')}`;
  return base.slice(0, 80);
}

async function main() {
  const oldUrl = process.env.OLD_PMS_DATABASE_URL;
  const newUrl = process.env.DATABASE_URL;
  if (!oldUrl || !newUrl) throw new Error('Missing OLD_PMS_DATABASE_URL or DATABASE_URL');

  const oldDb = new Client({ connectionString: oldUrl, ssl: { rejectUnauthorized: false } });
  const newDb = new Client({ connectionString: newUrl, ssl: { rejectUnauthorized: false } });
  await oldDb.connect();
  await newDb.connect();

  console.log(DRY ? '=== DRY RUN (no writes) ===' : '=== APPLY MODE (writing to NEW db) ===');

  // Sanity: new finance tables should be empty-ish for reservations
  const { rows: [{ n: existingRes }] } = await newDb.query(`SELECT COUNT(*)::int n FROM reservations`);
  if (existingRes > 0 && APPLY) {
    throw new Error(`New DB already has ${existingRes} reservations — aborting to avoid duplicates`);
  }

  const stats = {
    units_matched: 0,
    units_created: 0,
    staff_matched: 0,
    staff_created: 0,
    reservations: 0,
    payments: 0,
    commissions: 0,
    petty_cash: 0,
    petty_settings: 0,
    daily_prices: 0,
    skipped_reservations: 0,
  };

  // ── Staff map ────────────────────────────────────────────────────────────
  const { rows: oldUsers } = await oldDb.query(`SELECT * FROM users ORDER BY id`);
  const { rows: newStaff } = await newDb.query(`SELECT id, username, full_name, role FROM staff_users`);
  const staffByUsername = new Map(newStaff.map((s) => [String(s.username).toLowerCase(), s]));
  const staffByName = new Map(
    newStaff.map((s) => [String(s.full_name || '').trim().toLowerCase(), s])
  );
  const userMap = new Map(); // oldUserId → newStaffId

  const defaultHash = await bcrypt.hash(`Migrated-${crypto.randomBytes(8).toString('hex')}`, 10);

  for (const u of oldUsers) {
    let hit =
      staffByUsername.get(String(u.username).toLowerCase()) ||
      staffByName.get(String(u.full_name || '').trim().toLowerCase());
    if (hit) {
      userMap.set(u.id, hit.id);
      stats.staff_matched++;
      continue;
    }
    if (DRY) {
      userMap.set(u.id, `NEW:${u.username}`);
      stats.staff_created++;
      continue;
    }
    const role = mapRole(u.role);
    try {
      const { rows } = await newDb.query(
        `INSERT INTO staff_users (
           username, password_hash, email, full_name, role,
           sales_commission_pct, operation_specialist_pct, operation_manager_pct, reservation_manager_pct,
           petty_cash_location, is_active, is_first_login
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id`,
        [
          String(u.username).slice(0, 100),
          u.password_hash || defaultHash,
          u.email || null,
          u.full_name || u.username,
          role,
          u.sales_commission_pct || 0,
          u.operation_specialist_pct || 0,
          u.operation_manager_pct || 0,
          u.reservation_manager_pct || 0,
          u.petty_cash_location || null,
          u.is_active == null ? 1 : u.is_active ? 1 : 0,
          1,
        ]
      );
      userMap.set(u.id, rows[0].id);
      stats.staff_created++;
    } catch (e) {
      const { rows: existing } = await newDb.query(
        `SELECT id FROM staff_users WHERE lower(username)=lower($1) LIMIT 1`,
        [u.username]
      );
      if (existing[0]) {
        userMap.set(u.id, existing[0].id);
        stats.staff_matched++;
      } else {
        throw e;
      }
    }
  }

  // Fallback admin for created_by
  const adminId =
    [...userMap.values()].find((v) => typeof v === 'number') ||
    newStaff.find((s) => s.role === 'admin')?.id ||
    1;

  const mapUser = (oldId) => {
    if (oldId == null) return null;
    const v = userMap.get(oldId);
    if (typeof v === 'number') return v;
    return typeof adminId === 'number' ? adminId : 1;
  };

  // ── Unit map ─────────────────────────────────────────────────────────────
  const { rows: oldUnits } = await oldDb.query(`SELECT * FROM units ORDER BY id`);
  const { rows: newUnitsFull } = await newDb.query(
    `SELECT id, wp_post_id, title, unit_number, project, operator_unit_code, internal_code FROM units`
  );
  const unitByCode = new Map();
  const wpByUnitId = new Map(newUnitsFull.map((u) => [u.id, u.wp_post_id]));
  for (const u of newUnitsFull) {
    for (const key of [u.unit_number, u.operator_unit_code, u.internal_code, u.title]) {
      const k = norm(key);
      if (k && !unitByCode.has(k)) unitByCode.set(k, u.id);
    }
  }
  const unitMap = new Map(); // oldUnitId → newUnitUUID
  const unitWpMap = new Map(); // oldUnitId → wp_post_id

  for (const o of oldUnits) {
    const hit =
      unitByCode.get(norm(o.unit_number)) ||
      unitByCode.get(norm(o.name)) ||
      null;
    if (hit) {
      unitMap.set(o.id, hit);
      unitWpMap.set(o.id, wpByUnitId.get(hit) || null);
      stats.units_matched++;
      continue;
    }

    if (DRY) {
      unitMap.set(o.id, `CREATE:${o.unit_number || o.name}`);
      stats.units_created++;
      continue;
    }

    let slug = slugify(o.unit_number || o.name);
    for (let i = 0; i < 5; i++) {
      const { rows: exists } = await newDb.query(`SELECT 1 FROM units WHERE slug=$1`, [slug]);
      if (!exists.length) break;
      slug = `${slugify(o.unit_number || o.name)}-${crypto.randomBytes(2).toString('hex')}`;
    }

    const beds = Number(o.bedrooms) || 0;
    const baths = Number(o.bathrooms) || 0;
    const guests = Math.max(2, beds * 2 || 2);
    const project = o.project || 'Unassigned';
    const { rows } = await newDb.query(
      `INSERT INTO units (
         slug, title, status, source, compound, area, city,
         property_type, beds, baths, guests, view, floor,
         unit_number, project, owner_name, owner_email, owner_phone,
         company_commission_pct, company_commission_owner_pct, commission_mode, commission_tenant_pct,
         utilities_cost, price_fallback, ops_status, listing_type, amenities, notes,
         created_by_staff
       ) VALUES (
         $1,$2,'draft','manual',$3,$4,$4,
         $5,$6,$7,$8,$9,$10,
         $11,$3,$12,$13,$14,
         $15,$16,$17,$18,
         $19,$20,'available','rent',$21,$22,
         $23
       ) RETURNING id, wp_post_id`,
      [
        slug,
        o.name || o.unit_number || slug,
        project,
        destinationForProject(project),
        o.type || 'Chalet',
        beds,
        baths,
        guests,
        o.view || 'Unspecified',
        o.floor == null ? 0 : Number(o.floor) || 0,
        o.unit_number || o.name || slug,
        o.owner_name || null,
        o.owner_email || null,
        o.owner_phone || null,
        o.company_commission_pct || 0,
        o.company_commission_owner_pct || 0,
        o.commission_mode || 'A',
        o.commission_tenant_pct || 0,
        o.utilities_cost || 0,
        o.price_per_night || null,
        Array.isArray(o.amenities) ? o.amenities : [],
        o.notes || `Imported from legacy PMS unit #${o.id}`,
        mapUser(o.created_by) || adminId,
      ]
    );
    unitMap.set(o.id, rows[0].id);
    unitWpMap.set(o.id, rows[0].wp_post_id);
    unitByCode.set(norm(o.unit_number || o.name), rows[0].id);
    wpByUnitId.set(rows[0].id, rows[0].wp_post_id);
    stats.units_created++;
  }

  if (DRY) {
    console.log('Staff map size', userMap.size, stats);
    console.log('Unit map size', unitMap.size, stats);
    console.log('Would import reservations/payments/commissions/petty/daily_prices next.');
    await oldDb.end();
    await newDb.end();
    return;
  }

  console.log('Mapped staff', stats.staff_matched, 'created', stats.staff_created);
  console.log('Mapped units', stats.units_matched, 'created', stats.units_created);
  await newDb.query(`SET statement_timeout = '180000'`);

  // ── Reservations ───────────────────────────────────────────────────────
  console.log('Loading old reservations…');
  const { rows: oldRes } = await oldDb.query(`SELECT * FROM reservations ORDER BY id`);
  console.log('Old reservations', oldRes.length);
  const resIdMap = new Map();

  for (let i = 0; i < oldRes.length; i++) {
    const r = oldRes[i];
    const newUnitId = unitMap.get(r.unit_id);
    if (!newUnitId || String(newUnitId).startsWith('CREATE:')) {
      stats.skipped_reservations++;
      continue;
    }
    const createdBy = mapUser(r.created_by) || adminId;
    const salesId = r.sales_person_id != null ? mapUser(r.sales_person_id) : null;
    const checkIn = isoDate(r.check_in);
    const checkOut = isoDate(r.check_out);
    const nights =
      Number(r.nights) ||
      Math.max(1, Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000));

    try {
      const { rows: inserted } = await newDb.query(
        `INSERT INTO reservations (
           id, unit_id, guest_name, guest_email, guest_phone, guest_nationality,
           check_in, check_out, nights, total_amount, amount_paid, down_payment,
           housekeeping_fees, insurance, utilities_amount, utilities_cost_override,
           price_per_night, payment_status, booking_source, sales_person_id,
           is_owner_reservation, transfer_proof_path, transfer_proof_name,
           status, notes, hold_expires_at, created_by, created_at, updated_at,
           broker_name, broker_amount_per_night, broker_total,
           owner_collected_type, owner_collected_amount
         ) VALUES (
           $1,$2,$3,$4,$5,$6,
           $7,$8,$9,$10,$11,$12,
           $13,$14,$15,$16,
           $17,$18,$19,$20,
           $21,$22,$23,
           $24,$25,$26,$27,$28,$29,
           $30,$31,$32,
           $33,$34
         )
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          r.id,
          newUnitId,
          r.guest_name || 'Guest',
          r.guest_email || null,
          r.guest_phone || null,
          r.guest_nationality || null,
          checkIn,
          checkOut,
          nights,
          Number(r.total_amount) || 0,
          Number(r.amount_paid) || 0,
          Number(r.down_payment) || 0,
          Number(r.housekeeping_fees) || 0,
          Number(r.insurance) || 0,
          Number(r.utilities_amount) || 0,
          r.utilities_cost_override != null ? Number(r.utilities_cost_override) : null,
          Number(r.price_per_night) || 0,
          mapPaymentStatus(r.payment_status),
          r.booking_source || null,
          salesId,
          r.is_owner_reservation ? 1 : 0,
          r.transfer_proof_path || null,
          r.transfer_proof_name || null,
          mapReservationStatus(r),
          [r.notes, r.is_hold ? '[legacy hold]' : null, r.external_source ? `ext:${r.external_source}` : null]
            .filter(Boolean)
            .join('\n') || null,
          r.hold_until || null,
          createdBy,
          r.created_at || new Date(),
          r.updated_at || r.created_at || new Date(),
          r.broker_name || null,
          r.broker_amount_per_night != null ? Number(r.broker_amount_per_night) : null,
          r.broker_total != null ? Number(r.broker_total) : null,
          r.owner_collected_type || null,
          r.owner_collected_amount != null ? Number(r.owner_collected_amount) : null,
        ]
      );
      resIdMap.set(r.id, inserted[0]?.id || r.id);
      if (inserted[0]) stats.reservations++;
    } catch (e) {
      console.error('reservation fail', r.id, e.message);
      stats.skipped_reservations++;
    }
    if ((i + 1) % 50 === 0) console.log(`  reservations ${i + 1}/${oldRes.length}`);
  }

  await newDb.query(
    `SELECT setval(pg_get_serial_sequence('reservations','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM reservations), 1))`
  );
  console.log('Reservations imported', stats.reservations, 'skipped', stats.skipped_reservations);

  // ── Payments ───────────────────────────────────────────────────────────
  console.log('Loading payments…');
  const { rows: oldPays } = await oldDb.query(`SELECT * FROM payments ORDER BY id`);
  for (const p of oldPays) {
    const newResId = resIdMap.get(p.reservation_id);
    if (!newResId) continue;
    try {
      await newDb.query(
        `INSERT INTO payments (
           id, reservation_id, amount, payment_date, payment_method, reference_number,
           notes, document_path, document_name, is_approved, approved_by, approved_at,
           status, created_by, created_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,
           $7,$8,$9,$10,$11,$12,
           $13,$14,$15
         )
         ON CONFLICT (id) DO NOTHING`,
        [
          p.id,
          newResId,
          Number(p.amount) || 0,
          isoDate(p.payment_date) || isoDate(p.created_at) || '2026-04-01',
          mapPaymentMethod(p.payment_method),
          p.reference_number || null,
          [p.notes, p.cancel_note].filter(Boolean).join('\n') || null,
          p.document_path || null,
          p.document_name || null,
          p.is_approved == null ? 1 : p.is_approved ? 1 : 0,
          p.approved_by != null ? mapUser(p.approved_by) : null,
          p.approved_at || null,
          p.is_active === 0 || p.is_active === false ? 'cancelled' : 'successful',
          mapUser(p.created_by) || adminId,
          p.created_at || new Date(),
        ]
      );
      stats.payments++;
    } catch (e) {
      console.error('payment fail', p.id, e.message);
    }
  }
  await newDb.query(
    `SELECT setval(pg_get_serial_sequence('payments','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM payments), 1))`
  );
  console.log('Payments imported', stats.payments);

  // ── Commissions ────────────────────────────────────────────────────────
  console.log('Loading commissions…');
  const { rows: oldComms } = await oldDb.query(`SELECT * FROM commissions ORDER BY id`);
  for (const c of oldComms) {
    const newResId = resIdMap.get(c.reservation_id);
    const newUserId = mapUser(c.user_id);
    if (!newResId || !newUserId) continue;
    const ctype = String(c.commission_type || 'sales');
    const allowed = new Set([
      'sales',
      'operation_specialist',
      'operation_manager',
      'reservation_manager',
    ]);
    try {
      await newDb.query(
        `INSERT INTO commissions (
           id, reservation_id, user_id, commission_type, percentage, amount, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [
          c.id,
          newResId,
          newUserId,
          allowed.has(ctype) ? ctype : 'sales',
          Number(c.percentage) || 0,
          Number(c.amount) || 0,
          c.created_at || new Date(),
        ]
      );
      stats.commissions++;
    } catch (e) {
      console.error('commission fail', c.id, e.message);
    }
  }
  await newDb.query(
    `SELECT setval(pg_get_serial_sequence('commissions','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM commissions), 1))`
  );
  console.log('Commissions imported', stats.commissions);

  // ── Petty cash settings ────────────────────────────────────────────────
  try {
    const { rows: settings } = await oldDb.query(`SELECT * FROM petty_cash_settings`);
    for (const s of settings) {
      const loc = s.location || 'north_coast';
      await newDb.query(
        `INSERT INTO petty_cash_settings (location, opening_balance, updated_at)
         VALUES ($1,$2,COALESCE($3, now()))
         ON CONFLICT (location) DO UPDATE SET
           opening_balance = EXCLUDED.opening_balance,
           updated_at = EXCLUDED.updated_at`,
        [loc, Number(s.opening_balance) || 0, s.updated_at || null]
      );
      stats.petty_settings++;
    }
  } catch (e) {
    console.warn('petty_cash_settings skip', e.message);
  }

  // ── Petty cash ─────────────────────────────────────────────────────────
  console.log('Loading petty cash…');
  const { rows: oldPc } = await oldDb.query(`SELECT * FROM petty_cash ORDER BY id`);
  for (let i = 0; i < oldPc.length; i++) {
    const p = oldPc[i];
    const entryType = String(p.type || p.transaction_type || 'out').toLowerCase() === 'in' ? 'in' : 'out';
    const loc = p.location || 'north_coast';
    try {
      await newDb.query(
        `INSERT INTO petty_cash (
           id, location, description, amount, entry_type, entry_date,
           created_by, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO NOTHING`,
        [
          p.id,
          loc,
          p.description || 'Imported petty cash',
          Number(p.amount) || 0,
          entryType,
          isoDate(p.expense_date) || isoDate(p.created_at) || '2026-04-01',
          mapUser(p.created_by) || adminId,
          p.created_at || new Date(),
        ]
      );
      stats.petty_cash++;
    } catch (e) {
      console.error('petty fail', p.id, e.message);
    }
    if ((i + 1) % 50 === 0) console.log(`  petty ${i + 1}/${oldPc.length}`);
  }
  await newDb.query(
    `SELECT setval(pg_get_serial_sequence('petty_cash','id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM petty_cash), 1))`
  );
  console.log('Petty cash imported', stats.petty_cash);

  // ── Daily prices → unit_daily_prices (keyed by wp_post_id) ─────────────
  console.log('Loading daily prices…');
  try {
    const { rows: prices } = await oldDb.query(`SELECT * FROM daily_prices ORDER BY id`);
    for (let i = 0; i < prices.length; i++) {
      const p = prices[i];
      const wp = unitWpMap.get(p.unit_id);
      const price = Math.round(Number(p.price) || 0);
      if (!wp || !(price > 0)) continue;
      const d = isoDate(p.date);
      if (!d) continue;
      try {
        await newDb.query(
          `INSERT INTO unit_daily_prices (wp_post_id, date, price, currency, source, updated_at)
           VALUES ($1,$2,$3,'EGP','manual',COALESCE($4, now()))
           ON CONFLICT (wp_post_id, date) DO UPDATE SET
             price = EXCLUDED.price,
             source = EXCLUDED.source,
             updated_at = now()`,
          [wp, d, price, p.updated_at || p.created_at || null]
        );
        stats.daily_prices++;
      } catch (e) {
        /* skip bad price rows */
      }
      if ((i + 1) % 200 === 0) console.log(`  prices ${i + 1}/${prices.length}`);
    }
  } catch (e) {
    console.warn('daily_prices skip', e.message);
  }
  console.log('Daily prices imported', stats.daily_prices);

  // Final counts
  const counts = {};
  for (const t of ['reservations', 'payments', 'commissions', 'petty_cash', 'units', 'staff_users']) {
    const { rows } = await newDb.query(`SELECT COUNT(*)::int n FROM ${t}`);
    counts[t] = rows[0].n;
  }

  console.log('Migration stats', stats);
  console.log('New DB counts', counts);

  await oldDb.end();
  await newDb.end();
}

main().catch((e) => {
  console.error('MIGRATE_FAIL', e);
  process.exit(1);
});
