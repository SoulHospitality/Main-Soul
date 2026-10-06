const { query } = require('../../config/db');
const { setCustomAccounts } = require('./chartOfAccounts');

async function refreshCustomAccounts() {
  try {
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

module.exports = { refreshCustomAccounts };
