const { query } = require('../config/db');

const DEFAULT_CHECKLIST = [
  { key: 'beds', label: 'Beds made / linen changed', done: false },
  { key: 'bathrooms', label: 'Bathrooms cleaned', done: false },
  { key: 'kitchen', label: 'Kitchen / kitchenette cleaned', done: false },
  { key: 'floors', label: 'Floors vacuumed / mopped', done: false },
  { key: 'trash', label: 'Trash removed', done: false },
  { key: 'amenities', label: 'Amenities restocked', done: false },
];

async function ensurePreArrivalTasks() {
  const { rows } = await query(
    `SELECT r.id AS reservation_id, r.unit_id, r.check_in
     FROM reservations r
     WHERE r.status IN ('confirmed', 'pending', 'checked_in')
       AND r.check_in::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '1 day')::date
       AND NOT EXISTS (
         SELECT 1 FROM housekeeping_tasks t
         WHERE t.reservation_id = r.id
           AND COALESCE(t.source, 'pre_arrival') = 'pre_arrival'
       )`
  );

  let created = 0;
  for (const row of rows) {
    const dueAt = new Date(`${String(row.check_in).slice(0, 10)}T12:00:00.000Z`);
    dueAt.setUTCHours(dueAt.getUTCHours() - 24);
    await query(
      `INSERT INTO housekeeping_tasks (
         reservation_id, unit_id, status, checklist, due_at, source
       ) VALUES ($1, $2, 'pending', $3::jsonb, $4, 'pre_arrival')`,
      [row.reservation_id, row.unit_id, JSON.stringify(DEFAULT_CHECKLIST), dueAt.toISOString()]
    );
    created += 1;
  }
  return created;
}

function startHousekeepingTaskJob() {
  const interval = Number(process.env.HOUSEKEEPING_TASK_SWEEP_INTERVAL_MS || 15 * 60 * 1000);
  const run = async () => {
    try {
      const n = await ensurePreArrivalTasks();
      if (n) console.log(`[housekeeping] created ${n} pre-arrival tasks`);
    } catch (err) {
      console.error('[housekeeping]', err.message);
    }
  };
  run();
  const timer = setInterval(run, interval);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = {
  DEFAULT_CHECKLIST,
  ensurePreArrivalTasks,
  startHousekeepingTaskJob,
};
