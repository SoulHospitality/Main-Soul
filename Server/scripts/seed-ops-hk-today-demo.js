/**
 * Seed today's check-ins + pre-arrival HK tasks for Ops/HK demo accounts.
 * Usage: node scripts/seed-ops-hk-today-demo.js
 */
require('dotenv').config();
const { query, pool } = require('../src/config/db');
const { DEFAULT_CHECKLIST } = require('../src/jobs/housekeepingTasks');

const DEMO_TAG = '[demo-ops-hk-today]';

const GUESTS = [
  { name: 'Ahmed Hassan', phone: '01011112222', total: 40000, paid: 20000 },
  { name: 'Sara Magdy', phone: '01022223333', total: 28000, paid: 28000 },
  { name: 'Omar Khaled', phone: '01033334444', total: 55000, paid: 15000 },
  { name: 'Nour ElDin', phone: '01044445555', total: 32000, paid: 0 },
  { name: 'Lina Farouk', phone: '01055556666', total: 45000, paid: 22500 },
];

async function main() {
  const { rows: todayRows } = await query(
    `SELECT (timezone('Africa/Cairo', now()))::date::text AS today`
  );
  const today = todayRows[0].today;
  console.log(`[seed] today (Cairo)=${today}`);

  const { rows: adminRows } = await query(
    `SELECT id FROM staff_users WHERE role = 'admin' AND is_active = 1 ORDER BY id LIMIT 1`
  );
  const createdBy = adminRows[0]?.id;
  if (!createdBy) throw new Error('No admin staff user for created_by');

  // Clear previous demo rows for today (safe re-run)
  const { rows: old } = await query(
    `SELECT id FROM reservations
     WHERE notes ILIKE '%' || $1 || '%'
       AND check_in::date = $2::date`,
    [DEMO_TAG, today]
  );
  for (const r of old) {
    await query(`DELETE FROM payments WHERE reservation_id = $1`, [r.id]);
    await query(`DELETE FROM housekeeping_tasks WHERE reservation_id = $1`, [r.id]);
    await query(`DELETE FROM reservations WHERE id = $1`, [r.id]);
  }
  if (old.length) console.log(`[seed] cleared ${old.length} previous demo reservations`);

  const { rows: units } = await query(
    `SELECT id, unit_number, wp_post_id
     FROM units
     WHERE COALESCE(status, '') NOT IN ('archived', 'cancelled')
       AND unit_number IS NOT NULL
       AND unit_number <> ''
     ORDER BY unit_number
     LIMIT 20`
  );
  if (units.length < 3) throw new Error('Need at least 3 units to seed demo check-ins');

  // Avoid units that already have a real check-in today
  const { rows: busy } = await query(
    `SELECT DISTINCT unit_id FROM reservations
     WHERE check_in::date = $1::date
       AND status IS DISTINCT FROM 'cancelled'`,
    [today]
  );
  const busyIds = new Set(busy.map((b) => b.unit_id));
  const freeUnits = units.filter((u) => !busyIds.has(u.id));
  const pick = (freeUnits.length >= GUESTS.length ? freeUnits : units).slice(0, GUESTS.length);

  let created = 0;
  for (let i = 0; i < GUESTS.length; i += 1) {
    const g = GUESTS[i];
    const unit = pick[i % pick.length];
    const nights = 3;
    const checkout = new Date(`${today}T00:00:00Z`);
    checkout.setUTCDate(checkout.getUTCDate() + nights);
    const checkOut = checkout.toISOString().slice(0, 10);
    const remaining = Math.max(0, g.total - g.paid);
    const paymentStatus = remaining <= 0.5 ? 'paid' : g.paid > 0 ? 'partial' : 'pending';
    const pricePerNight = Math.round((g.total / nights) * 100) / 100;

    const { rows } = await query(
      `INSERT INTO reservations (
         unit_id, guest_name, guest_phone, check_in, check_out, nights,
         total_amount, amount_paid, payment_status, booking_source, status, notes,
         created_by, price_per_night, down_payment, payment_method, adults,
         ops_money_collected, ops_handed_over
       ) VALUES (
         $1,$2,$3,$4::date,$5::date,$6,
         $7,$8,$9,'demo','confirmed',$10,
         $11,$12,$8,'cash',2,
         0,0
       )
       RETURNING id`,
      [
        unit.id,
        g.name,
        g.phone,
        today,
        checkOut,
        nights,
        g.total,
        g.paid,
        paymentStatus,
        `${DEMO_TAG} Seeded for Ops/HK demo`,
        createdBy,
        pricePerNight,
      ]
    );

    const reservationId = rows[0].id;

    // If already paid, optionally record a payment so sync stays consistent
    if (g.paid > 0) {
      await query(
        `INSERT INTO payments (
           reservation_id, amount, payment_date, payment_method,
           notes, created_by, status, is_approved, approved_by, approved_at, paid_at
         ) VALUES (
           $1,$2,CURRENT_DATE,'instapay',
           $3,$4,'successful',1,$4,now(),now()
         )`,
        [reservationId, g.paid, `${DEMO_TAG} pre-paid portion`, createdBy]
      );
    }

    await query(
      `INSERT INTO housekeeping_tasks (
         reservation_id, unit_id, status, checklist, due_at, source
       ) VALUES ($1,$2,'pending',$3::jsonb,now(),'pre_arrival')`,
      [reservationId, unit.id, JSON.stringify(DEFAULT_CHECKLIST)]
    );

    console.log(
      `[seed] #${reservationId} ${unit.unit_number} ${g.name} total=${g.total} paid=${g.paid} remain=${remaining}`
    );
    created += 1;
  }

  // Tasks already inserted above; skip global ensure (can fail on bad legacy dates)
  console.log(`[seed] done created=${created}`);

  const { rows: list } = await query(
    `SELECT r.id, u.unit_number, r.guest_name, r.total_amount, r.amount_paid,
            (SELECT t.status FROM housekeeping_tasks t
             WHERE t.reservation_id = r.id
             ORDER BY t.created_at DESC LIMIT 1) AS hk_status
     FROM reservations r
     JOIN units u ON u.id = r.unit_id
     WHERE r.check_in::date = $1::date
       AND r.status IS DISTINCT FROM 'cancelled'
     ORDER BY r.id DESC
     LIMIT 20`,
    [today]
  );
  console.log('[seed] today check-ins now:');
  for (const row of list) {
    console.log(
      `  #${row.id} ${row.unit_number} ${row.guest_name} paid=${row.amount_paid}/${row.total_amount} hk=${row.hk_status}`
    );
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
