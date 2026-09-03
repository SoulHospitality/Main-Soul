const { query } = require('../config/db');

const AUTO_NOTE_PREFIX = 'auto_salary_month=';

function yearMonth(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function firstOfMonth(ym) {
  return `${ym}-01`;
}

function autoNote(ym, staffId) {
  return `${AUTO_NOTE_PREFIX}${ym} staff_id=${staffId}`;
}

async function resolveSystemUserId() {
  const { rows } = await query(
    `SELECT id FROM staff_users
     WHERE role = 'admin' AND COALESCE(is_active, 1) = 1
     ORDER BY id ASC
     LIMIT 1`
  );
  if (rows[0]?.id) return rows[0].id;
  const { rows: any } = await query(`SELECT id FROM staff_users ORDER BY id ASC LIMIT 1`);
  return any[0]?.id || null;
}

/**
 * Post monthly salary expenses for a YYYY-MM period.
 * One company expense per active staff member with base_salary > 0 (owners excluded).
 * Idempotent: skips staff already posted for that month.
 */
async function postMonthlySalaryExpenses(periodMonth = yearMonth()) {
  if (!/^\d{4}-\d{2}$/.test(String(periodMonth))) {
    throw new Error('periodMonth must be YYYY-MM');
  }

  const createdBy = await resolveSystemUserId();
  if (!createdBy) {
    return { period_month: periodMonth, created: 0, skipped: 0, error: 'No staff user to attribute expenses' };
  }

  const expenseDate = firstOfMonth(periodMonth);
  const { rows: staff } = await query(
    `SELECT id, full_name, staff_code, base_salary
     FROM staff_users
     WHERE COALESCE(is_active, 1) = 1
       AND COALESCE(role, '') <> 'owner'
       AND COALESCE(base_salary, 0) > 0.009
     ORDER BY id ASC`
  );

  let created = 0;
  let skipped = 0;
  const posted = [];

  for (const s of staff) {
    const amount = Math.round((Number(s.base_salary) || 0) * 100) / 100;
    if (!(amount > 0.009)) {
      skipped += 1;
      continue;
    }

    const note = autoNote(periodMonth, s.id);
    const { rows: existing } = await query(
      `SELECT id FROM expenses
       WHERE category = 'salary'
         AND notes = $1
       LIMIT 1`,
      [note]
    );
    if (existing[0]) {
      skipped += 1;
      continue;
    }

    const name = s.full_name || s.staff_code || `Staff #${s.id}`;
    const { rows } = await query(
      `INSERT INTO expenses (
         unit_id, description, amount, paid_by, expense_date, notes, created_by, category
       ) VALUES (
         NULL, $1, $2, 'company', $3::date, $4, $5, 'salary'
       )
       RETURNING id, amount, expense_date`,
      [`Monthly salary — ${name}`, amount, expenseDate, note, createdBy]
    );
    created += 1;
    posted.push({ staff_id: s.id, expense_id: rows[0].id, amount: rows[0].amount });
  }

  return {
    period_month: periodMonth,
    expense_date: expenseDate,
    staff_count: staff.length,
    created,
    skipped,
    posted,
  };
}

/**
 * Ensure the current month is posted. Safe to call any day —
 * only creates missing rows. On the 1st this is the normal trigger;
 * later days catch up if the job missed the 1st.
 */
async function ensureCurrentMonthSalaryExpenses() {
  return postMonthlySalaryExpenses(yearMonth(new Date()));
}

function startMonthlySalaryExpenseJob() {
  const interval = Number(process.env.SALARY_EXPENSE_INTERVAL_MS || 6 * 60 * 60 * 1000);

  const run = async () => {
    try {
      const result = await ensureCurrentMonthSalaryExpenses();
      if (result.created > 0) {
        console.log(
          `[salary-expenses] ${result.period_month}: created=${result.created} skipped=${result.skipped}`
        );
      }
    } catch (err) {
      console.error('[salary-expenses]', err.message);
    }
  };

  setTimeout(run, 20_000).unref?.();
  const timer = setInterval(run, interval);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = {
  postMonthlySalaryExpenses,
  ensureCurrentMonthSalaryExpenses,
  startMonthlySalaryExpenseJob,
  AUTO_NOTE_PREFIX,
};
