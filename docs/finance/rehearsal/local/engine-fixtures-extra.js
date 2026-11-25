// Extra synthetic fixtures (integration gaps T-2): insurance, cancellation forfeit, vendor invoice with WHT,
// recurring charge, petty cash, housekeeping order, owner holdback and owner payout. No real data.
async function seedExtraFixtures(query, { staff, units }) {
  const admin = staff[1];
  const owner = (await query(`INSERT INTO staff_users (username, password_hash, full_name, role, is_active) VALUES ('fx_owner','x','Fixture Owner','owner',1) RETURNING id`)).rows[0].id;
  await query(`INSERT INTO owner_units (owner_id, unit_id) VALUES ($1, $2)`, [owner, units.a]);
  const ids = { owner };
  // S7: stay with a 1,000 refundable insurance; 700 refunded, 300 kept for damage.
  ids.s7 = (await query(`INSERT INTO reservations (unit_id, guest_name, guest_phone, check_in, check_out, nights, price_per_night, total_amount, status,
      insurance, insurance_refund_status, insurance_refunded_amount, insurance_damage_amount, insurance_refunded_at, sales_person_id, created_by, created_at)
    VALUES ($1,'Fixture Guest','0100','2026-11-03','2026-11-05',2,1000,3000,'checked_out',1000,'partial',700,300,'2026-11-07',NULL,$2,'2026-10-20') RETURNING id`, [units.a, admin])).rows[0].id;
  await query(`INSERT INTO payments (reservation_id, amount, payment_date, payment_method, status, kind) VALUES ($1, 3000, '2026-11-03', 'cash', 'successful', 'collection')`, [ids.s7]);
  // S8: deposit paid, then the stay was cancelled (deposit forfeited).
  ids.s8 = (await query(`INSERT INTO reservations (unit_id, guest_name, guest_phone, check_in, check_out, nights, price_per_night, total_amount, status, created_by, created_at, updated_at)
    VALUES ($1,'Fixture Guest','0100','2026-12-10','2026-12-12',2,1500,3000,'cancelled',$2,'2026-11-01','2026-11-20') RETURNING id`, [units.b, admin])).rows[0].id;
  await query(`INSERT INTO payments (reservation_id, amount, payment_date, payment_method, status, kind) VALUES ($1, 900, '2026-11-02', 'cash', 'successful', 'collection')`, [ids.s8]);
  // Vendor invoice 1,000 with 1% WHT (10), approved and paid.
  const vendor = (await query(`INSERT INTO vendors (name) VALUES ('Fixture Supplier') RETURNING id`)).rows[0].id;
  ids.vi = (await query(`INSERT INTO vendor_invoices (vendor_id, invoice_number, invoice_date, due_date, amount, wht_amount, net_payable, status, category, approved_at, paid_at, unit_id)
    VALUES ($1,'FX-INV-1','2026-11-08','2026-11-30',1000,10,990,'paid','other','2026-11-09','2026-11-12',$2) RETURNING id`, [vendor, units.a])).rows[0].id;
  // Recurring campus utilities 4,000 a month (rent was retired with account 604000 in migration 143).
  await query(`INSERT INTO financial_recurring_charges (kind, label, account_code, amount_egp, day_of_month, is_active)
    VALUES ('utilities','Campus utilities','608000',4000,5,1) ON CONFLICT (kind) DO UPDATE SET amount_egp = 4000, is_active = 1, day_of_month = 5`);
  // Petty cash: 1,000 funded, 150 spent.
  await query(`INSERT INTO petty_cash (location, description, amount, entry_type, entry_date, created_by) VALUES
    ('office','Fixture float',1000,'in','2026-11-04',$1),('office','Fixture supplies',150,'out','2026-11-06',$1)`, [admin]);
  // Housekeeping service order for an outside client.
  ids.hk = (await query(`INSERT INTO housekeeping_service_orders (client_name, unit_number, amount, period_start, period_end, status, created_at)
    VALUES ('Fixture Client','X-9',600,'2026-11-10','2026-11-10','done','2026-11-10') RETURNING id`)).rows[0].id;
  // Owner holdback and an owner payout.
  await query(`INSERT INTO financial_owner_holdbacks (owner_id, amount, reason, created_at) VALUES ($1, 300, 'Fixture repair reserve', '2026-11-15')`, [owner]);
  ids.po = (await query(`INSERT INTO owner_payout_requests (owner_id, amount, status, paid_at, created_at) VALUES ($1, 1000, 'paid', '2026-11-28', '2026-11-25') RETURNING id`, [owner])).rows[0].id;
  return ids;
}
module.exports = { seedExtraFixtures };
