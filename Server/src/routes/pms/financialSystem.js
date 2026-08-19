
const express = require('express');
const XLSX = require('xlsx');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { clampFromDate, FINANCIAL_EPOCH } = require('../../lib/financialEpoch');
const { calcReservationFinancials, round2 } = require('../../lib/commission');
const { isWebsiteOriginReservation } = require('../../lib/reservationScope');
const {
  CHART_OF_ACCOUNTS,
  EXPENSE_CATEGORY_TO_ACCOUNT,
  accountsByGroup,
  getAccount,
} = require('../../lib/finance/chartOfAccounts');
const {
  outputVatOnCommission,
  withholdingTax,
  bookingSplit,
  monthlyTaxLiability,
  VAT_OUTPUT_PCT,
} = require('../../lib/finance/taxEngine');
const {
  buildFinancialPortal,
  buildYtdStatements,
  buildJournal,
  loadPortalData,
  mirrorTransactions,
  accountLabel,
  lastDayOfMonth,
  isPeriodClosed,
  vatReturn,
  agingFromReservations,
  closeMonthEntry,
} = require('../../lib/finance/ledgerEngine');

const router = express.Router();

const MANUAL_ENTRY_TYPES = new Set(['revenue', 'expense']);

async function assertPeriodOpen(date) {
  if (await isPeriodClosed(date)) {
    const err = new Error(`Books are closed for ${String(date).slice(0, 7)}`);
    err.status = 400;
    throw err;
  }
}

function dateRange(req) {
  const from = clampFromDate(req.query.from_date);
  const to = req.query.to_date || null;
  const params = [from];
  let resSql = `r.status <> 'cancelled' AND r.check_in >= $1::date`;
  if (to) {
    params.push(to);
    resSql += ` AND r.check_out <= $${params.length}::date`;
  }
  return { from, to, params, resSql };
}

async function loadReservations(req) {
  const { params, resSql } = dateRange(req);
  const unitId = req.query.unit_id ? String(req.query.unit_id).trim() : '';
  const ownerId = req.query.owner_id ? String(req.query.owner_id).trim() : '';
  const extraParams = [...params];
  let joinSql = '';
  let filterSql = '';

  if (unitId) {
    extraParams.push(unitId);
    filterSql += ` AND r.unit_id = $${extraParams.length}`;
  }
  if (ownerId) {
    extraParams.push(ownerId);
    joinSql = ` JOIN owner_units ou ON ou.unit_id = r.unit_id AND ou.owner_id = $${extraParams.length}`;
  }

  const { rows } = await query(
    `SELECT r.*,
            COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
            COALESCE(u.project, u.compound) AS project,
            u.commission_mode, u.company_commission_pct,
            u.company_commission_owner_pct, u.commission_tenant_pct,
            COALESCE(u.utilities_cost, 0) AS utilities_cost,
            COALESCE(sp.full_name, '—') AS sales_person_name,
            COALESCE(sp.sales_commission_pct, 0) AS agent_commission_pct
     FROM reservations r
     JOIN units u ON u.id = r.unit_id
     ${joinSql}
     LEFT JOIN staff_users sp ON sp.id = r.sales_person_id
     WHERE ${resSql}${filterSql}
     ORDER BY r.check_in DESC`,
    extraParams
  );
  return rows;
}

function journalLine(account, debit, credit, memo) {
  return {
    account,
    account_name: accountLabel(account),
    debit,
    credit,
    memo,
  };
}

async function loadManualEntries(from, to) {
  const params = [from];
  let where = 'm.entry_date >= $1::date';
  if (to) {
    params.push(to);
    where += ` AND m.entry_date <= $${params.length}::date`;
  }
  try {
    const { rows } = await query(
      `SELECT m.*,
              COALESCE(u.unit_number, u.title) AS unit_name,
              su.full_name AS created_by_name
       FROM financial_manual_entries m
       LEFT JOIN units u ON u.id = m.unit_id
       LEFT JOIN staff_users su ON su.id = m.created_by
       WHERE ${where}
       ORDER BY m.entry_date DESC, m.created_at DESC`,
      params
    );
    return rows;
  } catch (e) {
    if (e.code === '42P01') return [];
    throw e;
  }
}

function summarizeManualEntries(entries) {
  let revenue = 0;
  let expense = 0;
  let miscIn = 0;
  let miscOut = 0;
  for (const e of entries) {
    const amt = parseFloat(e.amount) || 0;
    if (e.entry_type === 'revenue') revenue += amt;
    else if (e.entry_type === 'expense') expense += amt;
    else if (e.misc_flow === 'out') miscOut += amt;
    else miscIn += amt;
  }
  return {
    revenue: round2(revenue),
    expense: round2(expense),
    misc_in: round2(miscIn),
    misc_out: round2(miscOut),
    misc_net: round2(miscIn - miscOut),
  };
}

function manualJournalEntry(row) {
  const amt = parseFloat(row.amount) || 0;
  const ref = `MAN-${row.id}`;
  let lines = [];
  let type = 'manual';

  if (row.entry_type === 'revenue') {
    lines = [
      journalLine('101000', amt, 0, 'Manual revenue received'),
      journalLine('409000', 0, amt, row.description),
    ];
    type = 'manual_revenue';
  } else if (row.entry_type === 'expense') {
    lines = [
      journalLine('503000', amt, 0, row.description),
      journalLine('201000', 0, amt, 'Manual expense paid'),
    ];
    type = 'manual_expense';
  } else if (row.misc_flow === 'out') {
    lines = [
      journalLine('503000', amt, 0, row.description),
      journalLine('101000', 0, amt, 'Miscellaneous expense'),
    ];
    type = 'miscellaneous';
  } else {
    lines = [
      journalLine('101000', amt, 0, 'Miscellaneous income'),
      journalLine('409000', 0, amt, row.description),
    ];
    type = 'miscellaneous';
  }

  return {
    id: ref,
    date: row.entry_date,
    type,
    reference: ref,
    description: row.description,
    lines,
  };
}

function reservationJournalEntry(r, fin, split) {
  const ref = `RES-${r.id}`;
  const lines = [];
  const guestTotal = round2(parseFloat(r.total_amount) || split.gross_booking);

  lines.push(journalLine('105000', guestTotal, 0, 'Guest receivable'));
  if (split.soul_commission > 0) {
    lines.push(journalLine('401000', 0, split.soul_commission, 'Management commission'));
  }
  if (split.cleaning_fee > 0) {
    lines.push(journalLine('402000', 0, split.cleaning_fee, 'Cleaning & turnover'));
  }
  if (split.owner_trust_credit > 0) {
    lines.push(journalLine('202000', 0, split.owner_trust_credit, 'Owner trust payable'));
  }
  if (split.vat_on_commission > 0) {
    lines.push(journalLine('205000', 0, split.vat_on_commission, 'Output VAT on commission'));
  }

  const credits = lines.reduce((s, l) => s + l.credit, 0);
  const debits = lines.reduce((s, l) => s + l.debit, 0);
  const diff = round2(debits - credits);
  if (diff > 0) {
    lines.push(journalLine('409000', 0, diff, 'Guest fees / balancing'));
  }

  return {
    id: ref,
    date: r.check_in,
    type: 'booking',
    reference: ref,
    description: `${r.guest_name} — ${r.unit_name}`,
    lines,
  };
}


router.get('/financial-system/overview', requireRoles('admin'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const rows = await loadReservations(req);

    let ownerTrust = 0;
    let commissionRevenue = 0;
    let cleaningRevenue = 0;
    let guestDeposits = 0;
    let guestReceivable = 0;
    let gatewayClearing = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (const r of rows) {
      const utilitiesAmount =
        parseFloat(r.utilities_amount) ||
        (Number(r.nights) || 0) * (parseFloat(r.utilities_cost) || 0);
      const fin = calcReservationFinancials(r, { ...r, utilities_amount: utilitiesAmount });
      const split = bookingSplit(fin, r);
      ownerTrust += split.owner_trust_credit;
      commissionRevenue += split.soul_commission;
      cleaningRevenue += split.cleaning_fee;

      const paid = parseFloat(r.amount_paid) || 0;
      const total = parseFloat(r.total_amount) || 0;
      guestReceivable += Math.max(0, total - paid);

      if (String(r.check_in) > today && paid > 0) {
        guestDeposits += paid;
      }
      if (isWebsiteOriginReservation(r) && paid > 0) {
        gatewayClearing += paid;
      }
    }

    const vat = outputVatOnCommission(commissionRevenue);

    const expParams = [from];
    let expWhere = `expense_date >= $1::date AND COALESCE(paid_by, 'company') <> 'owner'`;
    if (to) {
      expParams.push(to);
      expWhere += ` AND expense_date <= $${expParams.length}::date`;
    }
    const { rows: expenseRows } = await query(
      `SELECT id, description, amount, category, expense_date
       FROM expenses WHERE ${expWhere}`,
      expParams
    );

    let expensesPayable = 0;
    let totalWht = 0;
    for (const e of expenseRows) {
      const amt = parseFloat(e.amount) || 0;
      expensesPayable += amt;
      const wht = withholdingTax(amt, {
        ratePct: e.category === 'professional' ? 1 : 3,
      });
      totalWht += wht.wht_amount;
    }

    const pcParams = [from];
    let pcWhere = `entry_type = 'out' AND COALESCE(status, 'open') <> 'moved'
      AND COALESCE(paid_by, 'company') <> 'owner' AND entry_date >= $1::date`;
    if (to) {
      pcParams.push(to);
      pcWhere += ` AND entry_date <= $${pcParams.length}::date`;
    }
    const { rows: pettyRows } = await query(
      `SELECT COALESCE(SUM(amount), 0)::float AS total FROM petty_cash WHERE ${pcWhere}`,
      pcParams
    );
    const pettyCash = Number(pettyRows[0]?.total) || 0;

    let pendingPayouts = 0;
    try {
      const { rows: payoutRows } = await query(
        `SELECT COALESCE(SUM(amount), 0)::float AS total
         FROM owner_payout_requests WHERE status IN ('requested', 'approved')`
      );
      pendingPayouts = Number(payoutRows[0]?.total) || 0;
    } catch (_) {}

    const manualEntries = await loadManualEntries(from, to);
    const manualTotals = summarizeManualEntries(manualEntries);

    res.json({
      from_date: from,
      to_date: to,
      financial_epoch: FINANCIAL_EPOCH,
      kpis: {
        owner_trust: {
          label: 'Funds held for owners',
          amount: round2(ownerTrust),
          sub: `${rows.length} bookings in period`,
        },
        guest_deposits: {
          label: 'Guest deposits (unearned)',
          amount: round2(guestDeposits),
          sub: 'Paid ahead of future stays',
        },
        commission: {
          label: 'Soul commission earned',
          amount: round2(commissionRevenue),
          sub: 'Management fee revenue',
        },
        vat_payable: {
          label: 'VAT payable',
          amount: vat.vat_amount,
          sub: `${VAT_OUTPUT_PCT}% on commission`,
        },
        wht_payable: {
          label: 'Withholding tax',
          amount: round2(totalWht),
          sub: 'On expenses in period',
        },
      },
      supplemental: {
        guest_receivable: round2(guestReceivable),
        gateway_clearing: round2(gatewayClearing),
        cleaning_revenue: round2(cleaningRevenue),
        expenses_payable: round2(expensesPayable),
        petty_cash_out: round2(pettyCash),
        pending_owner_payouts: round2(pendingPayouts),
        manual_revenue: manualTotals.revenue,
        manual_expense: manualTotals.expense,
        manual_misc_in: manualTotals.misc_in,
        manual_misc_out: manualTotals.misc_out,
        manual_misc_net: manualTotals.misc_net,
      },
      manual: manualTotals,
    });
  } catch (e) {
    next(e);
  }
});


router.get('/financial-system/booking-splits', requireRoles('admin'), async (req, res, next) => {
  try {
    const rows = await loadReservations(req);
    const splits = rows.map((r) => {
      const utilitiesAmount =
        parseFloat(r.utilities_amount) ||
        (Number(r.nights) || 0) * (parseFloat(r.utilities_cost) || 0);
      const fin = calcReservationFinancials(r, { ...r, utilities_amount: utilitiesAmount });
      return {
        ...bookingSplit(fin, r),
        sales_person: r.sales_person_name,
        from_website: isWebsiteOriginReservation(r),
        payment_status: r.payment_status,
        total_amount: round2(parseFloat(r.total_amount) || 0),
        amount_paid: round2(parseFloat(r.amount_paid) || 0),
      };
    });
    res.json({ splits, count: splits.length });
  } catch (e) {
    next(e);
  }
});


router.get('/financial-system/owner-statements', requireRoles('admin'), async (req, res, next) => {
  try {
    const { from, to, params, resSql } = dateRange(req);
    const unitId = req.query.unit_id || null;
    const unitParams = [...params];
    let unitFilter = '';
    if (unitId) {
      unitParams.push(unitId);
      unitFilter = ` AND u.id = $${unitParams.length}`;
    }

    const { rows: units } = await query(
      `SELECT DISTINCT u.id, COALESCE(u.unit_number, u.title) AS unit_name,
              COALESCE(u.project, u.compound) AS project
       FROM units u
       JOIN reservations r ON r.unit_id = u.id
       WHERE ${resSql}${unitFilter}
       ORDER BY project, unit_name`,
      unitParams
    );

    const statements = [];
    for (const unit of units) {
      const uParams = [unit.id, from];
      let uResSql = `r.unit_id = $1 AND r.status <> 'cancelled' AND r.check_in >= $2::date`;
      if (to) {
        uParams.push(to);
        uResSql += ` AND r.check_out <= $${uParams.length}::date`;
      }
      const { rows: resRows } = await query(
        `SELECT r.*, COALESCE(u.unit_number, u.title) AS unit_name,
                u.commission_mode, u.company_commission_pct,
                u.company_commission_owner_pct, u.commission_tenant_pct,
                COALESCE(u.utilities_cost, 0) AS utilities_cost
         FROM reservations r
         JOIN units u ON u.id = r.unit_id
         WHERE ${uResSql}`,
        uParams
      );

      let grossCredits = 0;
      for (const r of resRows) {
        const fin = calcReservationFinancials(r, r);
        grossCredits += fin.ownerNet;
      }

      const expParams = [unit.id, from];
      let expWhere = `unit_id = $1 AND paid_by = 'owner' AND expense_date >= $2::date`;
      if (to) {
        expParams.push(to);
        expWhere += ` AND expense_date <= $${expParams.length}::date`;
      }
      const { rows: expRows } = await query(
        `SELECT COALESCE(SUM(amount), 0)::float AS total FROM expenses WHERE ${expWhere}`,
        expParams
      );
      const maintenanceDeductions = Number(expRows[0]?.total) || 0;
      const netPayout = round2(grossCredits - maintenanceDeductions);

      const { rows: owners } = await query(
        `SELECT su.id, su.full_name FROM owner_units ou
         JOIN staff_users su ON su.id = ou.owner_id
         WHERE ou.unit_id = $1`,
        [unit.id]
      );

      statements.push({
        unit_id: unit.id,
        unit_name: unit.unit_name,
        project: unit.project,
        owner_names: owners.map((o) => o.full_name).join(', ') || '—',
        reservation_count: resRows.length,
        gross_credits: round2(grossCredits),
        maintenance_deductions: round2(maintenanceDeductions),
        net_payout_due: netPayout,
      });
    }

    let payouts = [];
    try {
      const { rows } = await query(
        `SELECT p.*, su.full_name AS owner_name
         FROM owner_payout_requests p
         LEFT JOIN staff_users su ON su.id = p.owner_id
         ORDER BY p.created_at DESC LIMIT 200`
      );
      payouts = rows;
    } catch (_) {}

    res.json({ statements, payouts, from_date: from, to_date: to });
  } catch (e) {
    next(e);
  }
});


router.post('/financial-system/payouts/:id/settle', requireRoles('admin'), async (req, res, next) => {
  try {
    const id = req.params.id;
    const { rows } = await query(`SELECT * FROM owner_payout_requests WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Payout not found' });
    if (rows[0].status === 'paid') return res.json({ ok: true, payout: rows[0] });

    await query(
      `UPDATE owner_payout_requests SET
         status = 'paid',
         reviewed_by = $2,
         reviewed_at = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      [id, req.user.id]
    );
    const { rows: updated } = await query(`SELECT * FROM owner_payout_requests WHERE id = $1`, [id]);
    res.json({ ok: true, payout: updated[0] });
  } catch (e) {
    next(e);
  }
});


router.get('/financial-system/ledger', requireRoles('admin'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const rows = await loadReservations(req);
    const journal = [];

    for (const r of rows.slice(0, 500)) {
      const fin = calcReservationFinancials(r, r);
      const split = bookingSplit(fin, r);
      journal.push(reservationJournalEntry(r, fin, split));
    }

    const expParams = [from];
    let expWhere = `expense_date >= $1::date`;
    if (to) {
      expParams.push(to);
      expWhere += ` AND expense_date <= $${expParams.length}::date`;
    }
    const { rows: expenses } = await query(
      `SELECT id, description, amount, category, expense_date
       FROM expenses WHERE ${expWhere} ORDER BY expense_date DESC LIMIT 200`,
      expParams
    );

    for (const e of expenses) {
      const amt = parseFloat(e.amount) || 0;
      const acct = EXPENSE_CATEGORY_TO_ACCOUNT[e.category] || '503000';
      const wht = withholdingTax(amt, { ratePct: e.category === 'professional' ? 1 : 3 });
      journal.push({
        id: `EXP-${e.id}`,
        date: e.expense_date,
        type: 'expense',
        reference: `EXP-${e.id}`,
        description: e.description || 'Expense',
        lines: [
          journalLine(acct, amt, 0, e.category || 'expense'),
          journalLine('201000', 0, round2(amt - wht.wht_amount), 'Payable'),
          ...(wht.wht_amount > 0
            ? [journalLine('206000', 0, wht.wht_amount, 'WHT withheld')]
            : []),
        ],
      });
    }

    const manualEntries = await loadManualEntries(from, to);
    for (const m of manualEntries) {
      journal.push(manualJournalEntry(m));
    }

    journal.sort((a, b) => String(b.date).localeCompare(String(a.date)));

    const balances = {};
    for (const entry of journal) {
      for (const line of entry.lines) {
        if (!balances[line.account]) balances[line.account] = { debit: 0, credit: 0 };
        balances[line.account].debit += line.debit;
        balances[line.account].credit += line.credit;
      }
    }

    const accountBalances = CHART_OF_ACCOUNTS.map((acct) => ({
      name: acct.name,
      group: acct.group,
      type: acct.type,
      debit: round2(balances[acct.code]?.debit || 0),
      credit: round2(balances[acct.code]?.credit || 0),
      balance: round2(
        (balances[acct.code]?.debit || 0) - (balances[acct.code]?.credit || 0)
      ),
      code: acct.code,
    })).filter((a) => a.debit > 0 || a.credit > 0);

    res.json({
      chart_of_accounts: CHART_OF_ACCOUNTS.map(({ name, group, type }) => ({ name, group, type })),
      accounts_by_group: accountsByGroup(),
      journal,
      account_balances: accountBalances,
      from_date: from,
      to_date: to,
    });
  } catch (e) {
    next(e);
  }
});


router.get('/financial-system/tax', requireRoles('admin'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const built = await buildFinancialPortal(from, to);
    const vat = vatReturn(built.journal);
    const rows = built.reservations || [];

    let commissionTotal = 0;
    let cleaningTotal = 0;
    for (const r of rows) {
      if (String(r.status || '').toLowerCase() === 'cancelled') continue;
      const fin = calcReservationFinancials(r, r);
      commissionTotal += fin.companyCommission || 0;
      cleaningTotal += fin.housekeepingFees || 0;
    }

    const expParams = [from];
    let expWhere = `expense_date >= $1::date AND COALESCE(paid_by, 'company') <> 'owner'`;
    if (to) {
      expParams.push(to);
      expWhere += ` AND expense_date <= $${expParams.length}::date`;
    }
    const { rows: expenseRows } = await query(
      `SELECT id, description, amount, category, expense_date FROM expenses WHERE ${expWhere}`,
      expParams
    );

    const vendorBills = expenseRows.map((e) => ({
      vendor: e.description || 'Expense',
      amount: parseFloat(e.amount) || 0,
      wht_rate_pct: e.category === 'professional' ? 1 : 3,
      date: e.expense_date,
    }));

    const monthLabel = to ? `${from} → ${to}` : `From ${from}`;
    const liability = monthlyTaxLiability({
      commissionTotal,
      cleaningTotal,
      vendorBills,
      monthLabel,
    });

    res.json({
      from_date: from,
      to_date: to,
      vat_output_pct: VAT_OUTPUT_PCT,
      liability,
      vat_return: vat,
      commission_taxable_base: round2(commissionTotal),
      cleaning_taxable_base: round2(cleaningTotal),
    });
  } catch (e) {
    next(e);
  }
});


router.get('/financial-system/export', requireRoles('admin'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const rows = await loadReservations(req);
    const sheetRows = rows.map((r) => {
      const fin = calcReservationFinancials(r, r);
      const split = bookingSplit(fin, r);
      return {
        ID: r.id,
        Guest: r.guest_name,
        Unit: r.unit_name,
        Project: r.project,
        'Check-in': r.check_in,
        'Check-out': r.check_out,
        Gross: split.gross_booking,
        Commission: split.soul_commission,
        Cleaning: split.cleaning_fee,
        VAT: split.vat_on_commission,
        'Owner share': split.owner_trust_credit,
      };
    });

    const manualEntries = await loadManualEntries(from, to);
    const manualRows = manualEntries.map((m) => ({
      ID: m.id,
      Date: m.entry_date,
      Type: m.entry_type,
      Flow: m.misc_flow || '',
      Description: m.description,
      Amount: m.amount,
      Unit: m.unit_name || '',
      Notes: m.notes || '',
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), 'Bookings');
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        manualRows.length
          ? manualRows
          : [{ Date: '', Type: '', Description: '', Amount: '', Notes: 'No manual entries' }]
      ),
      'Manual entries'
    );
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="soul-financial-system.xlsx"');
    res.send(buf);
  } catch (e) {
    next(e);
  }
});


router.get('/financial-system/units', requireRoles('admin'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, COALESCE(unit_number, title) AS unit_name,
              COALESCE(project, compound) AS project
       FROM units ORDER BY project, unit_name`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});


router.get('/financial-system/manual-entries', requireRoles('admin'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const entries = await loadManualEntries(from, to);
    res.json({ entries, totals: summarizeManualEntries(entries), from_date: from, to_date: to });
  } catch (e) {
    next(e);
  }
});


router.post('/financial-system/manual-entries', requireRoles('admin'), async (req, res, next) => {
  try {
    const entryType = String(req.body.entry_type || '').toLowerCase();
    if (!MANUAL_ENTRY_TYPES.has(entryType)) {
      return res.status(400).json({ error: 'entry_type must be revenue or expense' });
    }

    const amount = parseFloat(req.body.amount);
    if (!(amount > 0)) {
      return res.status(400).json({ error: 'amount must be greater than zero' });
    }

    const description = String(req.body.description || '').trim();
    if (!description) {
      return res.status(400).json({ error: 'description is required' });
    }

    const entryDate = req.body.entry_date || new Date().toISOString().slice(0, 10);
    if (String(entryDate) < FINANCIAL_EPOCH) {
      return res.status(400).json({ error: `entry_date cannot be before ${FINANCIAL_EPOCH}` });
    }
    await assertPeriodOpen(entryDate);

    const unitId = req.body.unit_id || null;
    const notes = req.body.notes ? String(req.body.notes).trim() : null;

    const { rows } = await query(
      `INSERT INTO financial_manual_entries
         (entry_type, misc_flow, description, amount, entry_date, notes, unit_id, created_by)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [entryType, description, amount, entryDate, notes, unitId, req.user.id]
    );

    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});


router.get('/financial-system/portal', requireRoles('admin'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const built = await buildFinancialPortal(from, to);
    res.json({
      from_date: from,
      to_date: to,
      financial_epoch: FINANCIAL_EPOCH,
      kpis: built.kpis,
      treasury: built.treasury,
      groups: built.groups,
      outstanding: built.outstanding,
      recurring: built.recurring,
      payouts: built.payouts || [],
      closes: built.closes || [],
      settings: built.settings || {},
    });
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/accounts/:code', requireRoles('admin'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const code = String(req.params.code || '').trim();
    const acct = getAccount(code);
    if (!acct) return res.status(404).json({ error: 'Unknown account' });
    const built = await buildFinancialPortal(from, to);
    const summary = (built.accounts || []).find((a) => a.code === code) || {
      ...acct,
      debit: 0,
      credit: 0,
      balance: 0,
      txn_count: 0,
    };
    res.json({
      from_date: from,
      to_date: to,
      account: summary,
      transactions: mirrorTransactions(built.journal, code),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/transactions/:id', requireRoles('admin'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const id = decodeURIComponent(req.params.id || '');
    const built = await buildFinancialPortal(from, to);
    const entry = built.journal.find((e) => e.id === id);
    if (!entry) return res.status(404).json({ error: 'Transaction not found in this period' });
    const fromLine = entry.lines.find((l) => l.credit > 0);
    const toLine = entry.lines.find((l) => l.debit > 0);
    res.json({
      ...entry,
      flow: {
        from_account: fromLine?.account || entry.meta?.from_account || null,
        from_name: fromLine?.account_name || accountLabel(entry.meta?.from_account),
        to_account: toLine?.account || entry.meta?.to_account || null,
        to_name: toLine?.account_name || accountLabel(entry.meta?.to_account),
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/recurring', requireRoles('admin'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT kind, label, account_code, amount_egp, day_of_month, is_active
       FROM financial_recurring_charges ORDER BY kind`
    );
    res.json(rows);
  } catch (e) {
    if (e.code === '42P01') return res.json([]);
    next(e);
  }
});

router.put('/financial-system/recurring/:kind', requireRoles('admin'), async (req, res, next) => {
  try {
    const kind = String(req.params.kind || '').toLowerCase();
    if (!['rent', 'utilities', 'buffet'].includes(kind)) {
      return res.status(400).json({ error: 'Unknown recurring charge' });
    }
    await assertPeriodOpen(new Date().toISOString().slice(0, 10));
    const amount = Math.max(0, parseFloat(req.body.amount_egp) || 0);
    const day = Math.min(28, Math.max(1, parseInt(req.body.day_of_month, 10) || 1));
    const active = req.body.is_active === 0 || req.body.is_active === false ? 0 : 1;
    const { rows } = await query(
      `UPDATE financial_recurring_charges
       SET amount_egp = $2, day_of_month = $3, is_active = $4, updated_at = now(), updated_by = $5
       WHERE kind = $1
       RETURNING *`,
      [kind, amount, day, active, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Charge not found' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.delete('/financial-system/manual-entries/:id', requireRoles('admin'), async (req, res, next) => {
  try {
    const { rows: existing } = await query(
      `SELECT id, entry_date FROM financial_manual_entries WHERE id = $1`,
      [req.params.id]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Entry not found' });
    await assertPeriodOpen(existing[0].entry_date);
    await query(`DELETE FROM financial_manual_entries WHERE id = $1`, [req.params.id]);
    res.json({ ok: true, id: existing[0].id });
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/reports', requireRoles('admin'), async (req, res, next) => {
  try {
    const { to } = dateRange(req);
    const built = await buildYtdStatements(to);
    res.json({
      from_date: built.from_date,
      to_date: built.to_date,
      trial_balance: built.trial_balance,
      profit_and_loss: built.profit_and_loss,
      balance_sheet: built.balance_sheet,
      cash_flow: built.cash_flow,
      vat_return: built.vat_return,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/aging', requireRoles('admin'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const built = await buildFinancialPortal(from, to);
    const asOf = to || new Date().toISOString().slice(0, 10);
    res.json({
      from_date: from,
      to_date: to,
      ar_balance: built.kpis?.guest_ar || 0,
      ...agingFromReservations(built.reservations, asOf),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/owner-trust', requireRoles('admin'), async (req, res, next) => {
  try {
    const { to } = dateRange(req);
    const built = await buildYtdStatements(to);
    res.json({
      from_date: built.from_date,
      to_date: built.to_date,
      control_202000: built.owner_trust.control_202000,
      tied: built.owner_trust.tied,
      owners: built.owner_trust.rows,
      holdbacks: built.data?.holdbacks || [],
    });
  } catch (e) {
    next(e);
  }
});

router.post('/financial-system/holdbacks', requireRoles('admin'), async (req, res, next) => {
  try {
    const ownerId = parseInt(req.body.owner_id, 10);
    const amount = parseFloat(req.body.amount);
    if (!ownerId || !(amount > 0)) {
      return res.status(400).json({ error: 'owner_id and a positive amount are required' });
    }
    await assertPeriodOpen(new Date().toISOString().slice(0, 10));
    const { rows } = await query(
      `INSERT INTO financial_owner_holdbacks (owner_id, unit_id, amount, reason, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [ownerId, req.body.unit_id || null, amount, req.body.reason || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post('/financial-system/holdbacks/:id/release', requireRoles('admin'), async (req, res, next) => {
  try {
    await assertPeriodOpen(new Date().toISOString().slice(0, 10));
    const { rows } = await query(
      `UPDATE financial_owner_holdbacks SET is_released = 1 WHERE id = $1 AND is_released = 0 RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Holdback not found or already released' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/gateway', requireRoles('admin'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const built = await buildFinancialPortal(from, to);
    const settlements = (built.journal || []).filter((e) => e.type === 'gateway_settle');
    const clearingIn = (built.journal || [])
      .filter((e) => e.type === 'collection' && e.meta?.treasury_account === '106000')
      .reduce((s, e) => s + (e.debit || 0), 0);
    const mdr = settlements.reduce((s, e) => s + (Number(e.meta?.mdr_amount) || 0), 0);
    const net = settlements.reduce((s, e) => s + (Number(e.meta?.net) || 0), 0);
    res.json({
      from_date: from,
      to_date: to,
      mdr_pct: built.settings?.gateway_mdr_pct || 1.5,
      clearing_in: round2(clearingIn),
      settled_net: round2(net),
      mdr_expense: round2(mdr),
      uncleared: built.kpis?.gateway_clearing || 0,
      settlements,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/settings', requireRoles('admin'), async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT key, value_num, value_text FROM financial_settings`);
    res.json(Object.fromEntries(rows.map((r) => [r.key, r.value_num != null ? r.value_num : r.value_text])));
  } catch (e) {
    if (e.code === '42P01') return res.json({ gateway_mdr_pct: 1.5 });
    next(e);
  }
});

router.put('/financial-system/settings/:key', requireRoles('admin'), async (req, res, next) => {
  try {
    const key = String(req.params.key || '').trim();
    if (key !== 'gateway_mdr_pct') return res.status(400).json({ error: 'Unknown setting' });
    const value = Math.max(0, Math.min(15, parseFloat(req.body.value_num) || 0));
    const { rows } = await query(
      `INSERT INTO financial_settings (key, value_num, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value_num = $2, updated_at = now()
       RETURNING *`,
      [key, value]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/periods', requireRoles('admin'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*, su.full_name AS closed_by_name
       FROM financial_period_closes c
       LEFT JOIN staff_users su ON su.id = c.closed_by
       ORDER BY c.year_month DESC`
    );
    res.json(rows);
  } catch (e) {
    if (e.code === '42P01') return res.json([]);
    next(e);
  }
});

router.post('/financial-system/periods/:yearMonth/close', requireRoles('admin'), async (req, res, next) => {
  try {
    const yearMonth = String(req.params.yearMonth || '');
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      return res.status(400).json({ error: 'yearMonth must be YYYY-MM' });
    }
    const from = `${yearMonth}-01`;
    const to = lastDayOfMonth(yearMonth);
    const data = await loadPortalData(from, to);
    const journal = buildJournal(data, from, to, { includeCloses: false });
    const close = closeMonthEntry(yearMonth, journal);
    const pnl = Number(close.meta?.pnl) || 0;
    const { rows } = await query(
      `INSERT INTO financial_period_closes (year_month, pnl_amount, closed_by, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (year_month) DO NOTHING
       RETURNING *`,
      [yearMonth, pnl, req.user.id, req.body.notes || null]
    );
    if (!rows[0]) return res.status(409).json({ error: `${yearMonth} is already closed` });
    res.status(201).json({ close: rows[0], pnl, entry: close });
  } catch (e) {
    next(e);
  }
});

router.delete('/financial-system/periods/:yearMonth/close', requireRoles('admin'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM financial_period_closes WHERE year_month = $1 RETURNING year_month`,
      [req.params.yearMonth]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Period is not closed' });
    res.json({ ok: true, year_month: rows[0].year_month });
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/bank-rec', requireRoles('admin'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const code = String(req.query.account || '101000');
    if (!['101000', '102000', '103000', '104000'].includes(code)) {
      return res.status(400).json({ error: 'Treasury account required' });
    }
    const built = await buildFinancialPortal(from, to);
    const reconciled = new Set((built.reconciled || []).filter((r) => r.account_code === code).map((r) => r.entry_id));
    const lines = mirrorTransactions(built.journal, code).map((row) => ({
      ...row,
      reconciled: reconciled.has(row.id),
    }));
    const book = (built.accounts || []).find((a) => a.code === code);
    let snapshots = [];
    try {
      const { rows } = await query(
        `SELECT * FROM financial_bank_snapshots WHERE account_code = $1 ORDER BY statement_date DESC, id DESC LIMIT 20`,
        [code]
      );
      snapshots = rows;
    } catch (_) {}
    res.json({
      account: book,
      lines,
      snapshots,
      unreconciled: round2(lines.filter((l) => !l.reconciled).reduce((s, l) => s + (l.side === 'debit' ? l.amount : -l.amount), 0)),
    });
  } catch (e) {
    next(e);
  }
});

router.post('/financial-system/bank-rec/toggle', requireRoles('admin'), async (req, res, next) => {
  try {
    const entryId = String(req.body.entry_id || '').trim();
    const accountCode = String(req.body.account_code || '101000');
    if (!entryId) return res.status(400).json({ error: 'entry_id is required' });
    const { rows: existing } = await query(
      `SELECT entry_id FROM financial_reconciled_entries WHERE entry_id = $1`,
      [entryId]
    );
    if (existing[0]) {
      await query(`DELETE FROM financial_reconciled_entries WHERE entry_id = $1`, [entryId]);
      return res.json({ ok: true, reconciled: false });
    }
    await query(
      `INSERT INTO financial_reconciled_entries (entry_id, account_code, reconciled_by)
       VALUES ($1, $2, $3)`,
      [entryId, accountCode, req.user.id]
    );
    res.json({ ok: true, reconciled: true });
  } catch (e) {
    next(e);
  }
});

router.post('/financial-system/bank-rec/snapshot', requireRoles('admin'), async (req, res, next) => {
  try {
    const accountCode = String(req.body.account_code || '101000');
    const statementDate = req.body.statement_date || new Date().toISOString().slice(0, 10);
    const balance = parseFloat(req.body.statement_balance);
    if (!Number.isFinite(balance)) return res.status(400).json({ error: 'statement_balance is required' });
    const { rows } = await query(
      `INSERT INTO financial_bank_snapshots (account_code, statement_date, statement_balance, notes, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [accountCode, statementDate, balance, req.body.notes || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
