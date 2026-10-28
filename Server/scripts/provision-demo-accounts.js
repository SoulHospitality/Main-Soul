/**
 * Provision demo staff accounts for every role except admin (and owner portal).
 *
 * Usage: node scripts/provision-demo-accounts.js
 *
 * Refuses to run when NODE_ENV is production, or when DATABASE_URL points at
 * Supabase, unless ALLOW_DEMO_ACCOUNTS=yes. Never changes an account that
 * already exists. Each new account gets its own temporary password and must
 * change it on first login.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query, pool } = require('../src/config/db');
const { generateUniqueStaffCode } = require('../src/lib/staffIdentity');

function databaseHost() {
  try {
    return new URL(process.env.DATABASE_URL || '').hostname;
  } catch {
    return '';
  }
}

function assertSafeToRun() {
  const host = databaseHost();
  const production = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT === 'production';
  const hosted = /supabase\.co|railway\.internal|rlwy\.net/i.test(host);
  if (production || (hosted && process.env.ALLOW_DEMO_ACCOUNTS !== 'yes')) {
    console.error('Refusing to provision demo accounts against this database.');
    console.error('This script does not run when NODE_ENV or Railway is production.');
    console.error('Against a hosted database, set ALLOW_DEMO_ACCOUNTS=yes only on a database you can afford to fill with demo staff.');
    process.exit(1);
  }
}

function temporaryPassword() {
  return crypto.randomBytes(9).toString('base64url');
}

/** All staff roles except admin / owner. */
const ACCOUNTS = [
  {
    role: 'reservations_manager',
    username: 'demo.reservations.manager',
    email: 'demo.reservations.manager@soulhospitality.co',
    full_name: 'Demo Reservations Manager',
  },
  {
    role: 'reservations_web',
    username: 'demo.reservations.web',
    email: 'demo.reservations.web@soulhospitality.co',
    full_name: 'Demo Website Reservations',
  },
  {
    role: 'reservations_manual',
    username: 'demo.reservations.manual',
    email: 'demo.reservations.manual@soulhospitality.co',
    full_name: 'Demo Manual Reservations',
  },
  {
    role: 'reservations',
    username: 'demo.reservations',
    email: 'demo.reservations@soulhospitality.co',
    full_name: 'Demo Reservations (legacy)',
  },
  {
    role: 'unit_acquisition_manager',
    username: 'demo.acquisition.manager',
    email: 'demo.acquisition.manager@soulhospitality.co',
    full_name: 'Demo Unit Acquisition Manager',
  },
  {
    role: 'unit_acquisition_agent',
    username: 'demo.acquisition',
    email: 'demo.acquisition@soulhospitality.co',
    full_name: 'Demo Unit Acquisition Agent',
  },
  {
    role: 'operations_supervisor',
    username: 'demo.ops.supervisor',
    email: 'demo.ops.supervisor@soulhospitality.co',
    full_name: 'Demo Operations Supervisor',
  },
  {
    role: 'operations',
    username: 'demo.ops',
    email: 'demo.ops@soulhospitality.co',
    full_name: 'Demo Operations',
  },
  {
    role: 'resale_manager',
    username: 'demo.resale.manager',
    email: 'demo.resale.manager@soulhospitality.co',
    full_name: 'Demo Resale Manager',
  },
  {
    role: 'resale',
    username: 'demo.resale',
    email: 'demo.resale@soulhospitality.co',
    full_name: 'Demo Resale',
  },
  {
    role: 'finance_manager',
    username: 'demo.finance.manager',
    email: 'demo.finance.manager@soulhospitality.co',
    full_name: 'Demo Financial Manager',
  },
  {
    role: 'finance',
    username: 'demo.finance',
    email: 'demo.finance@soulhospitality.co',
    full_name: 'Demo Finance',
  },
  {
    role: 'hr_supervisor',
    username: 'demo.hr.manager',
    email: 'demo.hr.manager@soulhospitality.co',
    full_name: 'Demo HR Manager',
  },
  {
    role: 'hr',
    username: 'demo.hr',
    email: 'demo.hr@soulhospitality.co',
    full_name: 'Demo HR',
  },
  {
    role: 'owners_relations',
    username: 'demo.owners',
    email: 'demo.owners@soulhospitality.co',
    full_name: 'Demo Owner Experience',
  },
  {
    role: 'marketing_pr',
    username: 'demo.marketing',
    email: 'demo.marketing@soulhospitality.co',
    full_name: 'Demo Marketing and PR',
  },
  {
    role: 'web_developer',
    username: 'demo.web',
    email: 'demo.web@soulhospitality.co',
    full_name: 'Demo Web Developer',
  },
];

/** Agent → manager role for line-manager linking after create. */
const MANAGER_OF = {
  reservations_web: 'reservations_manager',
  reservations_manual: 'reservations_manager',
  reservations: 'reservations_manager',
  unit_acquisition_agent: 'unit_acquisition_manager',
  operations: 'operations_supervisor',
  resale: 'resale_manager',
  finance: 'finance_manager',
  hr: 'hr_supervisor',
};

async function ensureAccount(acc, passwordHash) {
  const { rows: existing } = await query(
    `SELECT id, username, role, staff_code, is_active
     FROM staff_users
     WHERE lower(username) = lower($1) OR lower(email) = lower($2)
     LIMIT 1`,
    [acc.username, acc.email]
  );

  if (existing[0]) {
    const row = existing[0];
    return { action: 'skipped', id: row.id, staff_code: row.staff_code, username: row.username };
  }

  const staffCode = await generateUniqueStaffCode(acc.role);
  const { rows } = await query(
    `INSERT INTO staff_users (
       username, email, full_name, role, password_hash,
       staff_code, is_active, is_first_login, sales_commission_pct,
       base_salary, salary_change_status, leave_casual_days, leave_annual_days,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, 1, 1, 0,
       10000, 'none', 3, 15,
       now(), now()
     )
     RETURNING id, staff_code, username`,
    [acc.username, acc.email, acc.full_name, acc.role, passwordHash, staffCode]
  );
  return { action: 'created', id: rows[0].id, staff_code: rows[0].staff_code, username: rows[0].username };
}

async function linkManagers(resultsByRole) {
  for (const [agentRole, managerRole] of Object.entries(MANAGER_OF)) {
    const agent = resultsByRole[agentRole];
    const manager = resultsByRole[managerRole];
    if (!agent || !manager || agent.action !== 'created' || manager.action !== 'created') continue;
    await query(`UPDATE staff_users SET manager_id = $2, updated_at = now() WHERE id = $1`, [
      agent.id,
      manager.id,
    ]);
    await query(`DELETE FROM staff_user_managers WHERE staff_user_id = $1`, [agent.id]);
    await query(
      `INSERT INTO staff_user_managers (staff_user_id, manager_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [agent.id, manager.id]
    );
  }
}

async function main() {
  assertSafeToRun();
  const results = [];
  const byRole = {};

  for (const acc of ACCOUNTS) {
    const password = temporaryPassword();
    const hash = await bcrypt.hash(password, 10);
    const result = await ensureAccount(acc, hash);
    const row = { ...result, role: acc.role, email: acc.email, password: result.action === 'created' ? password : null };
    results.push(row);
    byRole[acc.role] = row;
    console.log(
      `[${result.action}] ${acc.role.padEnd(28)} ${acc.username.padEnd(32)} id=${result.id}`
    );
  }

  await linkManagers(byRole);

  console.log('');
  console.log('New accounts must change this password at first login.');
  console.log('Existing accounts were left unchanged.');
  console.log('');
  console.log('username'.padEnd(32), 'role'.padEnd(28), 'temporary password');
  console.log('-'.repeat(80));
  for (const r of results) {
    console.log(r.username.padEnd(32), r.role.padEnd(28), r.password || '(already existed)');
  }

  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
