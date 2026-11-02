const { query } = require('../../config/db');
const { setCustomAccounts } = require('./chartOfAccounts');

/** Every petty cash drawer keeps a sub-account under 108000 Petty Cash, even after the books are reset. */
async function ensurePettySubAccounts() {
  try {
    const { rows } = await query(
      `SELECT p.id, p.name, p.account_code
       FROM petty_cash_accounts p
       LEFT JOIN financial_custom_accounts c ON c.code = p.account_code
       WHERE p.account_code IS NULL OR c.code IS NULL
       ORDER BY p.id`
    );
    for (const acct of rows) {
      let code = acct.account_code;
      if (!code) {
        const { rows: taken } = await query(
          `SELECT code FROM financial_custom_accounts WHERE code LIKE '108%'
           UNION SELECT account_code FROM petty_cash_accounts WHERE account_code IS NOT NULL`
        );
        const used = new Set(taken.map((r) => r.code));
        for (let n = 1; n <= 999 && !code; n += 1) {
          const candidate = `108${String(n).padStart(3, '0')}`;
          if (!used.has(candidate)) code = candidate;
        }
        if (!code) continue;
        await query(`UPDATE petty_cash_accounts SET account_code = $2 WHERE id = $1`, [acct.id, code]);
      }
      await query(
        `INSERT INTO financial_custom_accounts (code, name, account_group, parent_code)
         VALUES ($1, $2, 'assets', '108000')
         ON CONFLICT (code) DO NOTHING`,
        [code, `Petty Cash - ${acct.name}`]
      );
    }
  } catch (e) {
    if (e.code !== '42P01' && e.code !== '42703') throw e;
  }
}

async function refreshCustomAccounts() {
  try {
    await ensurePettySubAccounts();
    const { rows } = await query(
      `SELECT code, name, account_group, parent_code, created_at
       FROM financial_custom_accounts
       ORDER BY code`
    );
    return setCustomAccounts(rows);
  } catch (e) {
    if (e.code === '42P01') return setCustomAccounts([]);
    throw e;
  }
}

/** Petty cash drawer location for a sub-account under 108000, or null. */
async function pettyLocationForAccount(code) {
  if (!code || !String(code).startsWith('108') || code === '108000') return null;
  const { rows } = await query(`SELECT location_key FROM petty_cash_accounts WHERE account_code = $1`, [code]);
  return rows[0]?.location_key || null;
}

module.exports = { refreshCustomAccounts, ensurePettySubAccounts, pettyLocationForAccount };
