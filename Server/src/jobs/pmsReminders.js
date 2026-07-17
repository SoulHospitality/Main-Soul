const cron = require('node-cron');
const { query } = require('../config/db');
const { refreshIcalBlocks } = require('../services/ical');

function startPmsReminderJobs() {
  // 08:00 check-in reminders
  cron.schedule('0 8 * * *', async () => {
    try {
      const { rows } = await query(
        `SELECT r.id, r.guest_name, u.title
         FROM reservations r
         JOIN units u ON u.id = r.unit_id
         WHERE r.check_in = CURRENT_DATE AND r.status = 'confirmed'`
      );
      for (const r of rows) {
        await query(
          `INSERT INTO notifications (user_id, type, title, message, entity_type, entity_id)
           SELECT id, 'checkin', 'Check-in today', $1, 'reservation', $2
           FROM staff_users WHERE role IN ('admin','reservations') AND is_active = 1`,
          [`${r.guest_name} — ${r.title}`, r.id]
        );
      }
    } catch (err) {
      console.error('[cron checkin]', err.message);
    }
  });

  // 09:00 payment pending
  cron.schedule('0 9 * * *', async () => {
    try {
      const { rows } = await query(
        `SELECT id, guest_name FROM reservations
         WHERE payment_status = 'pending' AND status = 'confirmed' AND check_in >= CURRENT_DATE`
      );
      for (const r of rows) {
        await query(
          `INSERT INTO notifications (user_id, type, title, message, entity_type, entity_id)
           SELECT id, 'payment', 'Payment pending', $1, 'reservation', $2
           FROM staff_users WHERE role IN ('admin') AND is_active = 1`,
          [`${r.guest_name} still pending payment`, r.id]
        );
      }
    } catch (err) {
      console.error('[cron payment]', err.message);
    }
  });

  // Nightly iCal refresh 03:00
  cron.schedule('0 3 * * *', async () => {
    try {
      const result = await refreshIcalBlocks();
      console.log('[cron ical]', result);
    } catch (err) {
      console.error('[cron ical]', err.message);
    }
  });
}

module.exports = { startPmsReminderJobs };
