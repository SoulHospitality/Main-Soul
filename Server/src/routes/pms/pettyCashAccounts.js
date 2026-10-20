const express = require('express');
const { query, pool } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { refreshCustomAccounts } = require('../../lib/finance/customAccounts');
const { getAccount, isTreasuryCode } = require('../../lib/finance/chartOfAccounts');
const { buildFinancialPortal, FINANCIAL_EPOCH } = require('../../lib/finance/ledgerEngine');
const { listPettyCashAccounts, pettyCashLocationsFor } = require('../../lib/pettyCashAccess');

const router = express.Router();

function locationKey(name) {
  const base = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
  return base || `petty_${Date.now()}`;
}

router.get('/petty-cash/accounts', requireRoles('admin', 'finance', 'finance_manager', 'operations_supervisor'), async (req, res, next) => {
  try {
    const allowed = new Set(await pettyCashLocationsFor(req.user));
    const accounts = (await listPettyCashAccounts()).filter((row) => allowed.has(row.location_key));
    res.json(accounts);
  } catch (err) {
    next(err);
  }
});

router.get('/petty-cash/treasury-sources', requireRoles('admin', 'finance_manager'), async (_req, res, next) => {
  try {
    await refreshCustomAccounts();
    const today = new Date().toISOString().slice(0, 10);
    const portal = await buildFinancialPortal(FINANCIAL_EPOCH, today);
    res.json(
      (portal.treasury || []).map((row) => ({
        code: row.code,
        name: row.name,
        balance: Number(row.balance) || 0,
        currency: row.currency || 'EGP',
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.post('/petty-cash/accounts', requireRoles('admin', 'finance_manager'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const amount = Math.round((Number(req.body?.amount) || 0) * 100) / 100;
    const treasuryCode = String(req.body?.treasury_account_code || '').trim();
    const destination = String(req.body?.destination || '').trim().slice(0, 80) || null;
    if (!name) return res.status(400).json({ error: 'Name the petty cash account' });
    if (!(amount > 0)) return res.status(400).json({ error: 'Opening amount must be greater than zero' });

    await refreshCustomAccounts();
    if (!treasuryCode || !isTreasuryCode(treasuryCode) || !getAccount(treasuryCode)) {
      return res.status(400).json({ error: 'Choose a treasury account to fund this petty cash' });
    }

    const today = new Date().toISOString().slice(0, 10);
    try {
      const { rows: closed } = await query(
        `SELECT year_month FROM financial_period_closes WHERE year_month = $1`,
        [today.slice(0, 7)]
      );
      if (closed[0]) return res.status(400).json({ error: 'This month is closed' });
    } catch (err) {
      if (err.code !== '42P01') throw err;
    }

    const portal = await buildFinancialPortal(FINANCIAL_EPOCH, today);
    const source = (portal.treasury || []).find((row) => row.code === treasuryCode);
    const available = Math.round((Number(source?.balance) || 0) * 100) / 100;
    if (amount > available + 0.009) {
      return res.status(400).json({
        error: `${source?.name || 'That treasury account'} has EGP ${available.toFixed(2)}. The opening amount has to be in treasury.`,
      });
    }

    const existing = await listPettyCashAccounts();
    let key = locationKey(name);
    if (existing.some((row) => row.location_key === key)) key = `${key}_${Date.now().toString().slice(-4)}`;

    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO petty_cash_accounts
         (location_key, name, destination, treasury_account_code, opening_amount, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, location_key, name, destination, treasury_account_code,
                 opening_amount::float AS opening_amount, created_by, created_at`,
      [key, name, destination, treasuryCode, amount, req.user.id]
    );
    await client.query(
      `INSERT INTO petty_cash_settings (location, opening_balance, updated_at)
       VALUES ($1,$2,now())
       ON CONFLICT (location) DO UPDATE SET opening_balance = EXCLUDED.opening_balance, updated_at = now()`,
      [key, amount]
    );
    await client.query(
      `INSERT INTO financial_manual_entries
         (entry_type, misc_flow, description, amount, entry_date, notes, unit_id, created_by,
          debit_account_code, credit_account_code)
       VALUES ('journal', NULL, $1, $2, $3::date, $4, NULL, $5, '108000', $6)`,
      [
        `Petty cash ${name}`,
        amount,
        today,
        destination ? `Linked to ${destination}` : 'Petty cash float from treasury',
        req.user.id,
        treasuryCode,
      ]
    );
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
