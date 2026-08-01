require('dotenv').config({ path: require('path').join(__dirname, '../.env.old-pms') });
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Client } = require('pg');

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

(async () => {
  const oldDb = new Client({
    connectionString: process.env.OLD_PMS_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const newDb = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await oldDb.connect();
  await newDb.connect();

  const { rows: oldUnits } = await oldDb.query(
    `SELECT id, name, unit_number, project FROM units`
  );
  const { rows: newUnits } = await newDb.query(
    `SELECT id, title, unit_number, project, operator_unit_code, internal_code FROM units`
  );

  const byCode = new Map();
  for (const u of newUnits) {
    for (const key of [u.unit_number, u.operator_unit_code, u.internal_code, u.title]) {
      const k = norm(key);
      if (k) byCode.set(k, u);
    }
  }

  let matched = 0;
  const unmatched = [];
  for (const o of oldUnits) {
    const hit =
      byCode.get(norm(o.unit_number)) ||
      byCode.get(norm(o.name)) ||
      byCode.get(norm(`${o.project}-${o.unit_number}`));
    if (hit) matched++;
    else unmatched.push({ id: o.id, name: o.name, unit_number: o.unit_number, project: o.project });
  }
  console.log('units old', oldUnits.length, 'new', newUnits.length, 'matched', matched, 'unmatched', unmatched.length);
  console.log('unmatched sample', unmatched.slice(0, 20));

  const { rows: oldUsers } = await oldDb.query(`SELECT id, username, full_name, role FROM users`);
  const { rows: newStaff } = await newDb.query(`SELECT id, username, full_name, role FROM staff_users`);
  const byUser = new Map(newStaff.map((s) => [String(s.username).toLowerCase(), s]));
  let um = 0;
  const missingUsers = [];
  for (const u of oldUsers) {
    if (byUser.get(String(u.username).toLowerCase())) um++;
    else missingUsers.push(u);
  }
  console.log('users matched', um, 'missing', missingUsers.length, missingUsers);

  const { rows: statuses } = await oldDb.query(
    `SELECT payment_status, COUNT(*)::int n FROM reservations GROUP BY 1 ORDER BY 2 DESC`
  );
  console.log('old payment_status', statuses);
  const { rows: st } = await oldDb.query(
    `SELECT status, COUNT(*)::int n FROM reservations GROUP BY 1 ORDER BY 2 DESC`
  );
  console.log('old status', st);
  const { rows: holds } = await oldDb.query(
    `SELECT COUNT(*)::int n FROM reservations WHERE is_hold = 1 OR status = 'hold'`
  );
  console.log('holds', holds[0]);

  const { rows: payMethods } = await oldDb.query(
    `SELECT payment_method, COUNT(*)::int n FROM payments GROUP BY 1`
  );
  console.log('payment methods', payMethods);

  const { rows: pcTypes } = await oldDb.query(
    `SELECT COALESCE(type, transaction_type) AS t, location, COUNT(*)::int n FROM petty_cash GROUP BY 1,2 ORDER BY 3 DESC`
  );
  console.log('petty types', pcTypes);

  // reservations referencing unmatched units
  if (unmatched.length) {
    const ids = unmatched.map((u) => u.id);
    const { rows: r } = await oldDb.query(
      `SELECT COUNT(*)::int n FROM reservations WHERE unit_id = ANY($1::int[])`,
      [ids]
    );
    console.log('reservations on unmatched units', r[0].n);
  }

  await oldDb.end();
  await newDb.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
