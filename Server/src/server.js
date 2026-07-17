require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const http = require('http');
const bcrypt = require('bcryptjs');
const { createApp } = require('./app');
const { runMigrations, query } = require('./config/db');
const { initSocket } = require('./config/socket');
const { startBookingHoldExpiryJob } = require('./jobs/bookingHoldExpiry');
const { startPmsReminderJobs } = require('./jobs/pmsReminders');

async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'Admin@123';
  const email = process.env.ADMIN_EMAIL || 'admin@soulhospitality.co';
  const hash = await bcrypt.hash(password, 10);

  const { rows } = await query(`SELECT id FROM staff_users WHERE username = $1`, [username]);
  if (rows.length) {
    await query(
      `UPDATE staff_users
       SET password_hash = $1, email = COALESCE($2, email), role = 'admin', is_active = 1, updated_at = now()
       WHERE username = $3`,
      [hash, email, username]
    );
    console.log(`[seed] Ensured staff admin "${username}" password is in sync`);
    return;
  }

  await query(
    `INSERT INTO staff_users (username, password_hash, email, full_name, role)
     VALUES ($1,$2,$3,$4,'admin')`,
    [username, hash, email, 'System Admin']
  );
  console.log(`[seed] Created staff admin user "${username}"`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.warn('[boot] DATABASE_URL not set — migrations/API will fail until configured');
  } else {
    await runMigrations();
    await seedAdmin();
  }

  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);
  startBookingHoldExpiryJob();
  startPmsReminderJobs();

  const port = Number(process.env.PORT || 5000);
  server.listen(port, () => {
    console.log(`[main-soul] API listening on :${port}`);
  });
}

main().catch((err) => {
  console.error('[boot] fatal', err);
  process.exit(1);
});
