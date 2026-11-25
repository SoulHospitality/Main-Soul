// Synthetic fixtures for engine and report validation (PGlite, all migrations applied). No real data.
async function seedFixtures(query) {
  const staff = (await query(`INSERT INTO staff_users (username, password_hash, full_name, role, is_active, sales_commission_pct)
    VALUES ('fx_sales','x','Fixture Sales','reservations',1,10),('fx_admin','x','Fixture Admin','admin',1,0) RETURNING id`)).rows.map((r) => r.id);
  const unit = async (slug, pct, mode, ownerPct = null, tenant = null) => (await query(
    `INSERT INTO units (slug, title, unit_number, status, listing_type, compound, project, beds, baths, guests,
       company_commission_pct, commission_mode, company_commission_owner_pct, commission_tenant_pct)
     VALUES ($1,$1,$1,'published','rent','Marassi','Marassi',2,1,4,$2,$3,$4,$5) RETURNING id`, [slug, pct, mode, ownerPct, tenant])).rows[0].id;
  const units = { a: await unit('fx-a', 20, 'A'), b: await unit('fx-b', 25, 'B', null, 5), c: await unit('fx-c', 22, 'C', 12, 10) };
  const res = {};
  const stay = async (key, u, checkIn, nights, ppn, status, extra = {}) => {
    const v = { currency: 'EGP', fx: null, owner: 0, hk: 0, sp: staff[0], ...extra };
    res[key] = (await query(
      `INSERT INTO reservations (unit_id, guest_name, guest_phone, check_in, check_out, nights, price_per_night, total_amount, status,
         currency, exchange_rate, is_owner_reservation, housekeeping_fees, sales_person_id, created_by, created_at)
       VALUES ($1,'Fixture Guest','0100',$2::date,$2::date + $3::int,$3::int,$4::numeric,$4::numeric*$3::int + $8::numeric,$5,$6,$7,$9,$8::numeric,$10,$11,$2::date - 15)
       RETURNING id`, [u, checkIn, nights, ppn, status, v.currency, v.fx, v.hk, v.owner, v.sp, staff[1]])).rows[0].id;
    return res[key];
  };
  // S1: EGP, mode A, spans the Oct/Nov month end (2 nights in Oct, 2 in Nov), cleaning 500.
  await stay('s1', units.a, '2026-10-30', 4, 1000, 'checked_out', { hk: 500 });
  // S2: USD stay at a stated rate.
  await stay('s2', units.b, '2026-10-10', 3, 3000, 'checked_out', { currency: 'USD', fx: 48.5 });
  // S3: mode C owner-booked stay.
  await stay('s3', units.c, '2026-11-05', 2, 2000, 'checked_out', { owner: 1 });
  // S4: mode C guest stay (tenant deduction).
  await stay('s4', units.c, '2026-11-10', 3, 1500, 'checked_out');
  // S5: future confirmed stay paid in advance (guest deposit).
  await stay('s5', units.a, '2026-12-20', 2, 1200, 'confirmed');
  // S6: cancelled stay.
  await stay('s6', units.b, '2026-11-20', 2, 2500, 'cancelled');
  const pay = (key, amount, date, method, kind = 'collection', ref = null) => query(
    `INSERT INTO payments (reservation_id, amount, payment_date, payment_method, status, kind, transaction_reference)
     VALUES ($1,$2,$3,$4,'successful',$5,$6)`, [res[key], amount, date, method, kind, ref]);
  await pay('s1', 4500, '2026-10-25', 'cash');
  // USD reservations store EGP equivalents (lib/reservationCurrency.js); USD payments are always cash.
  await pay('s2', 9000, '2026-10-10', 'cash');
  await pay('s4', 4500, '2026-11-10', 'paymob_card', 'collection', 'FX-PM-1');
  await pay('s5', 2400, '2026-11-15', 'instapay', 'collection', 'FX-IP-1');
  await pay('s4', -500, '2026-11-14', 'paymob_card', 'refund', 'FX-PM-1R');
  await query(`INSERT INTO expenses (unit_id, paid_by, category, description, amount, expense_date, created_by)
    VALUES ($1,'company','utilities_cost','Fixture electricity',850,'2026-10-15',$2),($1,'owner','other','Fixture repair',1200,'2026-11-05',$2)`, [units.a, staff[1]]);
  // Bad debt: an approved write-off and a monthly allowance that rises, then is partly released.
  await query(`INSERT INTO ar_write_offs (reservation_id, amount, reason, status, approved_by, approved_at, created_by)
    VALUES ($1, 100, 'Fixture: guest unreachable', 'approved', $2, '2026-11-25', $2)`, [res.s4, staff[1]]);
  await query(`INSERT INTO ar_bad_debt_provisions (period_month, total_ar, total_provision, created_by)
    VALUES ('2026-10', 5000, 200, $1), ('2026-11', 4000, 150, $1)`, [staff[1]]);
  // Month close for October.
  await query(`INSERT INTO financial_period_closes (year_month, pnl_amount, closed_at, notes) VALUES ('2026-10', 0, '2026-11-02', 'Fixture close')`);
  return { staff, units, res };
}
module.exports = { seedFixtures };
