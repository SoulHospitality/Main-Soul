require('dotenv').config({ path: require('path').join(__dirname, '../.env.old-pms') });
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Client } = require('pg');

async function sample(url, label) {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log('===' + label + '===');
  if (label === 'OLD') {
    const u = await c.query(
      `SELECT id, name, unit_number, project, type FROM units ORDER BY id LIMIT 5`
    );
    console.log('units sample', u.rows);
    const us = await c.query(
      `SELECT id, username, full_name, role FROM users ORDER BY id LIMIT 10`
    );
    console.log('users sample', us.rows);
    const r = await c.query(
      `SELECT id, unit_id, guest_name, check_in, check_out, total_amount, payment_status, status, sales_person_id, created_by, is_hold
       FROM reservations ORDER BY id LIMIT 3`
    );
    console.log('res sample', r.rows);
    const pc = await c.query(
      `SELECT id, type, location, amount, transaction_type, expense_date, description, unit_id, created_by
       FROM petty_cash ORDER BY id DESC LIMIT 3`
    );
    console.log('petty sample', pc.rows);
    const pay = await c.query(
      `SELECT id, reservation_id, amount, payment_method, payment_date, is_approved FROM payments LIMIT 5`
    );
    console.log('pay sample', pay.rows);
    const idt = await c.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name='units' AND column_name='id'`
    );
    console.log('units.id type', idt.rows[0]);
  } else {
    const u = await c.query(
      `SELECT id, title, unit_number, project, property_type, operator_unit_code, internal_code FROM units ORDER BY created_at LIMIT 5`
    );
    console.log('units sample', u.rows);
    const us = await c.query(
      `SELECT id, username, full_name, role FROM staff_users ORDER BY id LIMIT 10`
    );
    console.log('staff sample', us.rows);
    const idt = await c.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name='units' AND column_name='id'`
    );
    console.log('units.id type', idt.rows[0]);
    const sid = await c.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name='staff_users' AND column_name='id'`
    );
    console.log('staff.id type', sid.rows[0]);
    const rid = await c.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name='reservations' AND column_name='id'`
    );
    console.log('reservations.id type', rid.rows[0]);
    const prices = await c.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ILIKE '%price%'`
    );
    console.log('price tables', prices.rows);
  }
  await c.end();
}

(async () => {
  await sample(process.env.OLD_PMS_DATABASE_URL, 'OLD');
  await sample(process.env.DATABASE_URL, 'NEW');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
