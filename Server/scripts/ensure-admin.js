require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const bcrypt = require('bcryptjs');
const { query, pool } = require('../src/config/db');

(async () => {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'Admin@123';
  const email = process.env.ADMIN_EMAIL || 'admin@soulhospitality.co';
  const hash = await bcrypt.hash(password, 10);

  const { rows } = await query(`SELECT id FROM staff_users WHERE username = $1`, [username]);
  if (rows.length) {
    await query(
      `UPDATE staff_users
       SET password_hash = $1, email = $2, role = 'admin', is_active = 1, updated_at = now()
       WHERE username = $3`,
      [hash, email, username]
    );
    console.log(`Updated admin "${username}"`);
  } else {
    await query(
      `INSERT INTO staff_users (username, password_hash, email, full_name, role)
       VALUES ($1,$2,$3,'System Admin','admin')`,
      [username, hash, email]
    );
    console.log(`Created admin "${username}"`);
  }
  await pool.end();
})().catch(async (e) => {
  console.error(e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
