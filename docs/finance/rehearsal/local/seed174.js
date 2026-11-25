// Synthetic pre-deployment database (state after migration 174) shared by rehearsal.js and runbook-real.js.
// No real data: fixed fake names and phone numbers.
async function seed174(query) {
  const staff = (await query(`INSERT INTO staff_users (username, password_hash, full_name, role, is_active, sales_commission_pct)
    VALUES ('seed_sales','x','Seed Sales','reservations',1,10),('seed_admin','x','Seed Admin','admin',1,0) RETURNING id`)).rows.map((r) => r.id);
  const mkUnit = async (slug, pct, mode, ownerPct = null, tenant = null) => (await query(
    `INSERT INTO units (slug, title, unit_number, status, listing_type, compound, project, beds, baths, guests, company_commission_pct, commission_mode, company_commission_owner_pct, commission_tenant_pct)
     VALUES ($1,$1,$1,'published','rent','Marassi','Marassi',2,1,4,$2,$3,$4,$5) RETURNING id`, [slug, pct, mode, ownerPct, tenant])).rows[0].id;
  const uA = await mkUnit('seed-a', 20, 'A'); const uB = await mkUnit('seed-b', 25, 'B', null, 5); const uC = await mkUnit('seed-c', 22, 'C', 12, 10);
  const res = [];
  const stays = [
    [uA, '2026-10-03', 3, 2500, 'checked_out', 'EGP', null, 0], [uB, '2026-10-10', 4, 3000, 'checked_out', 'EGP', null, 0],
    [uC, '2026-10-20', 2, 4000, 'checked_out', 'USD', 48.5, 0], [uC, '2026-11-02', 5, 2200, 'checked_out', 'EGP', null, 1],
    [uA, '2026-11-15', 2, 2600, 'confirmed', 'EGP', null, 0], [uB, '2026-11-20', 3, 3100, 'checked_in', 'EGP', null, 0],
    [uA, '2026-12-05', 4, 2700, 'pending', 'EGP', null, 0], [uB, '2026-12-12', 2, 3000, 'cancelled', 'EGP', null, 0],
  ];
  for (const [u, ci, n, ppn, st, cur, fx, owner] of stays) {
    const r = (await query(`INSERT INTO reservations (unit_id, guest_name, guest_phone, check_in, check_out, nights, price_per_night, total_amount, status, currency, exchange_rate, is_owner_reservation, sales_person_id, created_by, created_at)
      VALUES ($1,'Seed Guest','0100',$2::date,$2::date + $3::int,$3::int,$4::numeric,$4::numeric*$3::int,$5,$6,$7,$8,$9,$10,$2::date - 20) RETURNING id`, [u, ci, n, ppn, st, cur, fx, owner, staff[0], staff[1]])).rows[0].id;
    res.push(r);
  }
  for (const [i, amt, method, kind, ref] of [[0, 7500, 'cash', 'collection', null], [1, 12000, 'bank_transfer', 'collection', 'TRX-1'], [2, 8000, 'paymob_card', 'collection', 'PM-1'], [4, 5200, 'cash', 'collection', null], [3, -1000, 'cash', 'refund', null]]) {
    await query(`INSERT INTO payments (reservation_id, amount, payment_date, payment_method, status, kind, transaction_reference) VALUES ($1,$2,(SELECT check_in FROM reservations WHERE id=$1),$3,'successful',$4,$5)`, [res[i], amt, method, kind, ref]);
  }
  await query(`INSERT INTO expenses (unit_id, paid_by, category, description, amount, expense_date, created_by) VALUES ($2,'company','utilities_cost','Seed electricity',850,'2026-10-15',$1),($2,'owner','other','Seed repair',1200,'2026-11-05',$1)`, [staff[1], uA]);
  await query(`INSERT INTO cash_ledger (entry_type, category, description, amount, entry_date, created_by) VALUES ('in','collection','Seed cash in',7500,'2026-10-06',$1),('out','expense','Seed cash out',850,'2026-10-15',$1)`, [staff[1]]);
  await query(`INSERT INTO financial_posted_entries (year_month, kind, entry_id, entry_date, entry) VALUES ('2026-10','frozen','B-seed-1','2026-10-03',
     '{"id":"B-seed-1","date":"2026-10-03","type":"booking","lines":[{"account":"105000","debit":7500,"credit":0},{"account":"404000","debit":0,"credit":6000},{"account":"401000","debit":0,"credit":1500}]}')`);
  return { staff, res, uA, uB, uC };
}

module.exports = { seed174 };
