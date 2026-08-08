/**
 * Provision Ops/HK supervisor + agent demo accounts.
 *
 * Usage: node scripts/provision-ops-hk-accounts.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query } = require('../src/config/db');
const { TEMP_PASSWORD, generateUniqueStaffCode } = require('../src/lib/staffIdentity');

const ACCOUNTS = [
  {
    role: 'operations_supervisor',
    username: 'ops.supervisor',
    email: 'ops.supervisor@soulhospitality.co',
    full_name: 'Operations Supervisor',
  },
  {
    role: 'operations',
    username: 'ops.demo',
    email: 'ops.demo@soulhospitality.co',
    full_name: 'Operations Demo',
  },
  {
    role: 'housekeeping_supervisor',
    username: 'hk.supervisor',
    email: 'hk.supervisor@soulhospitality.co',
    full_name: 'Housekeeping Supervisor',
  },
  {
    role: 'housekeeping',
    username: 'hk.demo',
    email: 'hk.demo@soulhospitality.co',
    full_name: 'Housekeeping Demo',
  },
];

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
    await query(
      `UPDATE staff_users SET
         role = $2,
         full_name = $3,
         email = $4,
         is_active = 1,
         password_hash = $5,
         is_first_login = 0,
         updated_at = now()
       WHERE id = $1`,
      [row.id, acc.role, acc.full_name, acc.email, passwordHash]
    );
    return { action: 'updated', id: row.id, staff_code: row.staff_code, username: acc.username };
  }

  const staffCode = await generateUniqueStaffCode(acc.role);
  const { rows } = await query(
    `INSERT INTO staff_users (
       username, email, full_name, role, password_hash,
       staff_code, is_active, is_first_login, sales_commission_pct, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, 1, 0, 0, now(), now()
     )
     RETURNING id, staff_code, username`,
    [
      acc.username,
      acc.email,
      acc.full_name,
      acc.role,
      passwordHash,
      staffCode,
    ]
  );
  return { action: 'created', id: rows[0].id, staff_code: rows[0].staff_code, username: rows[0].username };
}

async function main() {
  const hash = await bcrypt.hash(TEMP_PASSWORD, 10);
  const results = [];
  for (const acc of ACCOUNTS) {
    const result = await ensureAccount(acc, hash);
    results.push({ ...result, role: acc.role });
    console.log(
      `[${result.action}] ${acc.role} username=${acc.username} staff_code=${result.staff_code} id=${result.id}`
    );
  }
  console.log('');
  console.log('Sign in at /sign-in with password', TEMP_PASSWORD);
  for (const r of results) {
    console.log(`  ${r.role}: ${r.username}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
