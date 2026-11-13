/**
 * Report builder: every Financial System report as one table format (title, headline figures,
 * sections of columns and rows) that the client saves as PDF, Excel or CSV.
 * Period reports cover from → to; position reports (balance sheet, trial balance) are as of `to`.
 */
const { FINANCE_BOOKS_START } = require('../financialEpoch');
const { round2 } = require('../commission');
const {
  buildFinancialPortal,
  balancesFromJournal,
  agingFromReservations,
  ownerTrustSubledger,
  accountLabel,
} = require('./ledgerEngine');
const { CHART_OF_ACCOUNTS, isTreasuryCode, getAccount } = require('./chartOfAccounts');
const { query } = require('../../config/db');

const R = { align: 'right' };
const money = (n) => round2(Number(n) || 0);

const DATASETS = {
  income_statement: 'Income statement (P&L)',
  balance_sheet: 'Balance sheet',
  trial_balance: 'Trial balance',
  general_ledger: 'General ledger',
  cash_book: 'Cash & bank book',
  revenue_by: 'Revenue analysis',
  payments_received: 'Money received & refunded',
  receivables_aging: 'Receivables aging',
  owner_trust: 'Owner balances (trust)',
  vendor_payables: 'Vendor payables',
  expenses_by_account: 'Expenses by account and month',
  tax_summary: 'Tax summary (VAT & WHT)',
};

const GROUPS = { unit: 'Unit', project: 'Project', channel: 'Channel', owner: 'Owner', month: 'Month', sales_person: 'Sales person' };

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function priorPeriod(from, to) {
  const span = Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);
  const priorTo = addDays(from, -1);
  return { from: addDays(priorTo, -span), to: priorTo };
}

function operating(journal) {
  return journal.filter((e) => e.type !== 'period_close');
}

function balancesByCode(journal) {
  return Object.fromEntries(balancesFromJournal(journal).map((a) => [a.code, a]));
}

async function incomeStatement(from, to) {
  const prior = priorPeriod(from, to);
  const [cur, prev] = await Promise.all([buildFinancialPortal(from, to), buildFinancialPortal(prior.from, prior.to)]);
  const a = balancesByCode(operating(cur.journal));
  const b = balancesByCode(operating(prev.journal));
  const pick = (type, prefix) => CHART_OF_ACCOUNTS.filter((x) => x.type === type && !x.virtual && (!prefix || String(x.code).startsWith(prefix)))
    .filter((x) => Math.abs(a[x.code]?.balance || 0) > 0.009 || Math.abs(b[x.code]?.balance || 0) > 0.009);
  const row = (x) => {
    const now = money(a[x.code]?.balance);
    const before = money(b[x.code]?.balance);
    return [x.code, x.name, now, before, money(now - before)];
  };
  const sum = (list, src) => money(list.reduce((s, x) => s + (src[x.code]?.balance || 0), 0));
  const revenue = pick('revenue');
  const direct = pick('expense', '5');
  const overhead = pick('expense', '6');
  const rev = [sum(revenue, a), sum(revenue, b)];
  const dir = [sum(direct, a), sum(direct, b)];
  const ovh = [sum(overhead, a), sum(overhead, b)];
  const gross = [money(rev[0] - dir[0]), money(rev[1] - dir[1])];
  const net = [money(gross[0] - ovh[0]), money(gross[1] - ovh[1])];
  const cols = [{ label: 'Account' }, { label: 'Name' }, { label: `${from} → ${to}`, ...R }, { label: `${prior.from} → ${prior.to}`, ...R }, { label: 'Change', ...R }];
  const tot = (label, pair) => ['', label, pair[0], pair[1], money(pair[0] - pair[1])];
  return {
    stats: [
      { label: 'Revenue', value: rev[0] },
      { label: 'Gross profit', value: gross[0] },
      { label: 'Net profit', value: net[0] },
      { label: 'Net margin', value: rev[0] ? `${round2((net[0] / rev[0]) * 100)}%` : '—' },
    ],
    sections: [
      { title: 'Revenue', columns: cols, rows: revenue.map(row), totals: tot('Total revenue', rev) },
      { title: 'Direct costs (owner share, gateway, housekeeping)', columns: cols, rows: direct.map(row), totals: tot('Gross profit', gross) },
      { title: 'Operating expenses', columns: cols, rows: overhead.map(row), totals: tot('Net profit', net) },
    ],
    note: 'Accrual basis: stay revenue is earned night by night; nights in a later month are deferred to that month. The comparison column is the period of the same length just before.',
  };
}

async function position(to) {
  const built = await buildFinancialPortal(FINANCE_BOOKS_START, to);
  return { built, bals: balancesFromJournal(built.journal) };
}

async function balanceSheetReport(to) {
  const { bals } = await position(to);
  const pnl = bals.filter((x) => x.type === 'revenue' || x.type === 'expense');
  const earnings = money(pnl.reduce((s, x) => s + (x.type === 'revenue' && !x.virtual ? x.balance : x.type === 'expense' ? -x.balance : 0), 0));
  const list = (group) => bals.filter((x) => x.group === group && Math.abs(x.balance) > 0.009);
  const assets = list('assets');
  const liabilities = list('liabilities');
  const equity = list('equity').filter((x) => x.code !== '303000');
  const sum = (rows) => money(rows.reduce((s, x) => s + x.balance, 0));
  const cols = [{ label: 'Account' }, { label: 'Name' }, { label: `Balance at ${to}`, ...R }];
  const rows = (items) => items.map((x) => [x.code, x.name, money(x.balance)]);
  const equityRows = [...rows(equity), ['303000', 'Profit / loss not yet closed', earnings]];
  const totalAssets = sum(assets);
  const totalLiab = sum(liabilities);
  const totalEquity = money(sum(equity) + earnings);
  const diff = money(totalAssets - totalLiab - totalEquity);
  return {
    stats: [
      { label: 'Total assets', value: totalAssets },
      { label: 'Total liabilities', value: totalLiab },
      { label: 'Equity', value: totalEquity },
      { label: 'Balanced', value: Math.abs(diff) < 1 ? 'Yes' : `Off by ${diff}` },
    ],
    sections: [
      { title: 'Assets', columns: cols, rows: rows(assets), totals: ['', 'Total assets', totalAssets] },
      { title: 'Liabilities', columns: cols, rows: rows(liabilities), totals: ['', 'Total liabilities', totalLiab] },
      { title: 'Equity', columns: cols, rows: equityRows, totals: ['', 'Total liabilities and equity', money(totalLiab + totalEquity)] },
    ],
  };
}

async function trialBalanceReport(to) {
  const { bals } = await position(to);
  const rows = bals.filter((x) => !x.virtual && (x.debit > 0.009 || x.credit > 0.009));
  const net = (x) => money(x.debit - x.credit);
  const dr = money(rows.reduce((s, x) => s + Math.max(0, net(x)), 0));
  const cr = money(rows.reduce((s, x) => s + Math.max(0, -net(x)), 0));
  return {
    stats: [
      { label: 'Debit balances', value: dr },
      { label: 'Credit balances', value: cr },
      { label: 'Difference', value: money(dr - cr) },
    ],
    sections: [
      {
        title: `Trial balance at ${to}`,
        columns: [{ label: 'Account' }, { label: 'Name' }, { label: 'Type' }, { label: 'Total debits', ...R }, { label: 'Total credits', ...R }, { label: 'Debit balance', ...R }, { label: 'Credit balance', ...R }],
        rows: rows.map((x) => [x.code, x.name, x.type, money(x.debit), money(x.credit), Math.max(0, net(x)), Math.max(0, -net(x))]),
        totals: ['', 'Totals', '', money(rows.reduce((s, x) => s + x.debit, 0)), money(rows.reduce((s, x) => s + x.credit, 0)), dr, cr],
      },
    ],
  };
}

function ledgerLines(journal, filter) {
  const out = [];
  for (const e of [...journal].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)))) {
    for (const l of e.lines) if (!filter || filter(l, e)) out.push({ e, l });
  }
  return out;
}

async function generalLedger(from, to, account) {
  const built = await buildFinancialPortal(from, to);
  const lines = ledgerLines(operating(built.journal), account ? (l) => l.account === account : null);
  const dr = money(lines.reduce((s, x) => s + x.l.debit, 0));
  const cr = money(lines.reduce((s, x) => s + x.l.credit, 0));
  return {
    stats: [
      { label: 'Entries', value: new Set(lines.map((x) => x.e.id)).size },
      { label: 'Debits', value: dr },
      { label: 'Credits', value: cr },
    ],
    sections: [
      {
        title: account ? `${account} ${accountLabel(account)}` : 'All accounts',
        columns: [{ label: 'Date' }, { label: 'Entry' }, { label: 'Type' }, { label: 'Description' }, { label: 'Account' }, { label: 'Memo' }, { label: 'Debit', ...R }, { label: 'Credit', ...R }],
        rows: lines.map(({ e, l }) => [e.date, e.id, e.type, e.description, `${l.account} ${l.account_name || accountLabel(l.account)}`, l.memo || '', money(l.debit), money(l.credit)]),
        totals: ['', '', '', '', '', 'Totals', dr, cr],
      },
    ],
  };
}

async function cashBook(from, to, account) {
  const [period, opening] = await Promise.all([
    buildFinancialPortal(from, to),
    from > FINANCE_BOOKS_START ? buildFinancialPortal(FINANCE_BOOKS_START, addDays(from, -1)) : Promise.resolve({ journal: [] }),
  ]);
  const openBals = balancesByCode(opening.journal);
  const codes = [...new Set(ledgerLines(period.journal, (l) => isTreasuryCode(l.account) || String(l.account).startsWith('108')).map((x) => x.l.account))]
    .concat(Object.keys(openBals).filter((c) => (isTreasuryCode(c) || String(c).startsWith('108')) && Math.abs(openBals[c].balance) > 0.009))
    .filter((c, i, arr) => arr.indexOf(c) === i && (!account || c === account))
    .sort();
  const sections = [];
  const stats = [];
  for (const code of codes) {
    let running = money(openBals[code]?.balance);
    const openingBal = running;
    const rows = [[from, '', 'Opening balance', '', '', running]];
    for (const { e, l } of ledgerLines(period.journal, (x) => x.account === code)) {
      running = money(running + l.debit - l.credit);
      rows.push([e.date, e.id, e.description, money(l.debit), money(l.credit), running]);
    }
    const inflow = money(rows.slice(1).reduce((s, r) => s + r[3], 0));
    const outflow = money(rows.slice(1).reduce((s, r) => s + r[4], 0));
    sections.push({
      title: `${code} ${accountLabel(code)}`,
      columns: [{ label: 'Date' }, { label: 'Entry' }, { label: 'Description' }, { label: 'In', ...R }, { label: 'Out', ...R }, { label: 'Balance', ...R }],
      rows,
      totals: ['', '', `Closing balance (opening ${openingBal})`, inflow, outflow, running],
    });
    stats.push({ label: accountLabel(code), value: running });
  }
  return { stats: stats.slice(0, 8), sections };
}

async function revenueBy(from, to, group) {
  const built = await buildFinancialPortal(from, to);
  const key = GROUPS[group] ? group : 'unit';
  const ownerByUnit = {};
  for (const link of built.ownerLinks || built.data?.ownerLinks || []) ownerByUnit[String(link.unit_id)] = link.owner_name;
  const rows = {};
  for (const e of built.journal) {
    if (e.type !== 'booking') continue;
    const m = e.meta || {};
    const label =
      key === 'unit' ? m.unit_name :
      key === 'project' ? m.project :
      key === 'channel' ? m.channel :
      key === 'owner' ? ownerByUnit[String(m.unit_id)] :
      key === 'month' ? String(e.date).slice(0, 7) :
      m.sales_person;
    const k = label || '—';
    if (!rows[k]) rows[k] = { stays: 0, nights: 0, invoice: 0, commission: 0, owner: 0, cleaning: 0, service: 0, vat: 0 };
    const r = rows[k];
    r.stays += 1;
    r.nights += Number(m.nights) || 0;
    r.invoice += Number(m.stay_invoice) || 0;
    r.commission += Number(m.commission) || 0;
    r.owner += Number(m.owner_share) || 0;
    r.cleaning += Number(m.cleaning) || 0;
    r.service += Number(m.service_fee) || 0;
    r.vat += Number(m.vat) || 0;
  }
  const list = Object.entries(rows).sort((a, b) => b[1].invoice - a[1].invoice);
  const t = list.reduce((s, [, r]) => {
    for (const f of Object.keys(r)) s[f] = (s[f] || 0) + r[f];
    return s;
  }, {});
  const adr = (r) => (r.nights ? money(r.invoice / r.nights) : 0);
  return {
    stats: [
      { label: 'Stays', value: t.stays || 0 },
      { label: 'Nights', value: t.nights || 0 },
      { label: 'Guest invoices', value: money(t.invoice) },
      { label: 'Company commission', value: money(t.commission) },
      { label: 'Average per night', value: adr(t) },
    ],
    sections: [
      {
        title: `By ${GROUPS[key].toLowerCase()} (stays checking in ${from} → ${to})`,
        columns: [{ label: GROUPS[key] }, { label: 'Stays', ...R }, { label: 'Nights', ...R }, { label: 'Guest invoices', ...R }, { label: 'Avg per night', ...R }, { label: 'Owner share', ...R }, { label: 'Company commission', ...R }, { label: 'Cleaning', ...R }, { label: 'Service', ...R }, { label: 'VAT', ...R }, { label: 'Share of invoices', ...R }],
        rows: list.map(([k, r]) => [k, r.stays, r.nights, money(r.invoice), adr(r), money(r.owner), money(r.commission), money(r.cleaning), money(r.service), money(r.vat), t.invoice ? `${round2((r.invoice / t.invoice) * 100)}%` : '—']),
        totals: ['Total', t.stays || 0, t.nights || 0, money(t.invoice), adr(t), money(t.owner), money(t.commission), money(t.cleaning), money(t.service), money(t.vat), '100%'],
      },
    ],
    note: 'Stays are counted in the month they check in. The income statement spreads stays that cross a month end over their nights.',
  };
}

async function paymentsReceived(from, to) {
  const built = await buildFinancialPortal(from, to);
  const items = built.journal.filter((e) => e.type === 'collection' || e.type === 'refund')
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const rows = items.map((e) => {
    const m = e.meta || {};
    const amt = e.type === 'refund' ? -e.debit : e.debit;
    return [e.date, m.guest_name || '—', m.unit_name || '—', m.payment_method || '—', accountLabel(m.treasury_account || ''), m.reference_number || '', money(amt)];
  });
  const byTreasury = {};
  for (const r of rows) byTreasury[r[4]] = money((byTreasury[r[4]] || 0) + r[6]);
  const received = money(rows.filter((r) => r[6] > 0).reduce((s, r) => s + r[6], 0));
  const refunded = money(rows.filter((r) => r[6] < 0).reduce((s, r) => s - r[6], 0));
  return {
    stats: [
      { label: 'Received', value: received },
      { label: 'Refunded', value: refunded },
      { label: 'Net', value: money(received - refunded) },
    ],
    sections: [
      {
        title: 'Payments and refunds',
        columns: [{ label: 'Date' }, { label: 'Guest' }, { label: 'Unit' }, { label: 'Method' }, { label: 'Into / out of' }, { label: 'Reference' }, { label: 'Amount', ...R }],
        rows,
        totals: ['', '', '', '', '', 'Net', money(received - refunded)],
      },
      {
        title: 'By treasury',
        columns: [{ label: 'Treasury' }, { label: 'Net amount', ...R }],
        rows: Object.entries(byTreasury).map(([k, v]) => [k, v]),
      },
    ],
  };
}

async function receivablesAging(to) {
  const built = await buildFinancialPortal(FINANCE_BOOKS_START, to);
  const aging = agingFromReservations(built.reservations, to);
  const rows = [];
  for (const [key, bucket] of Object.entries(aging.buckets)) {
    for (const r of bucket.rows) rows.push([bucket.label, r.guest_name || '—', r.unit_name || '—', r.check_in, r.check_out, money(r.full_bill), money(r.paid), r.days, money(r.amount), key]);
  }
  rows.sort((a, b) => b[7] - a[7]);
  return {
    stats: Object.values(aging.buckets).map((b) => ({ label: b.label, value: money(b.amount) })).concat([{ label: 'Total owed', value: money(aging.total) }]),
    sections: [
      {
        title: `Who owes, as of ${to}`,
        columns: [{ label: 'Age' }, { label: 'Guest' }, { label: 'Unit' }, { label: 'Check-in' }, { label: 'Check-out' }, { label: 'Full bill', ...R }, { label: 'Paid', ...R }, { label: 'Days', ...R }, { label: 'Owed', ...R }],
        rows: rows.map((r) => r.slice(0, 9)),
        totals: ['', '', '', '', '', '', '', 'Total', money(aging.total)],
      },
    ],
  };
}

async function ownerTrust(from, to) {
  const built = await buildFinancialPortal(from, to);
  const trust = ownerTrustSubledger(built.journal, built.data || {});
  const rows = trust.rows.map((r) => [r.owner_name, money(r.credits), money(r.expenses), money(r.holdbacks), money(r.payouts), money(r.balance)]);
  const sum = (i) => money(rows.reduce((s, r) => s + r[i], 0));
  return {
    stats: [
      { label: 'Owed to owners', value: sum(5) },
      { label: 'Paid out', value: sum(4) },
      { label: 'Ties to 202000', value: trust.tied ? 'Yes' : `No (books ${money(trust.control_202000)})` },
    ],
    sections: [
      {
        title: 'Owner trust movements',
        columns: [{ label: 'Owner' }, { label: 'Share earned', ...R }, { label: 'Expenses charged', ...R }, { label: 'Held back', ...R }, { label: 'Paid out', ...R }, { label: 'Balance owed', ...R }],
        rows,
        totals: ['Total', sum(1), sum(2), sum(3), sum(4), sum(5)],
      },
    ],
  };
}

async function vendorPayables(to) {
  let rows = [];
  try {
    const { rows: bills } = await query(
      `SELECT vi.*, v.name AS vendor_name FROM vendor_invoices vi LEFT JOIN vendors v ON v.id = vi.vendor_id
       WHERE vi.status IN ('pending', 'approved') AND vi.invoice_date <= $1::date ORDER BY vi.due_date`,
      [to]
    );
    rows = bills.map((b) => {
      const due = b.due_date instanceof Date ? b.due_date.toISOString().slice(0, 10) : String(b.due_date).slice(0, 10);
      const inv = b.invoice_date instanceof Date ? b.invoice_date.toISOString().slice(0, 10) : String(b.invoice_date).slice(0, 10);
      const late = Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${due}T00:00:00Z`)) / 86400000);
      return [b.vendor_name || '—', b.invoice_number || '', inv, due, b.status, late > 0 ? late : 0, money(b.amount), money(b.wht_amount), money(b.net_payable)];
    });
  } catch (e) {
    if (e.code !== '42P01') throw e;
  }
  const sum = (i) => money(rows.reduce((s, r) => s + r[i], 0));
  return {
    stats: [
      { label: 'Open bills', value: rows.length },
      { label: 'To pay (net)', value: sum(8) },
      { label: 'Overdue', value: money(rows.filter((r) => r[5] > 0).reduce((s, r) => s + r[8], 0)) },
    ],
    sections: [
      {
        title: `Open vendor bills at ${to}`,
        columns: [{ label: 'Vendor' }, { label: 'Invoice' }, { label: 'Invoice date' }, { label: 'Due' }, { label: 'Status' }, { label: 'Days late', ...R }, { label: 'Amount', ...R }, { label: 'WHT', ...R }, { label: 'Net to pay', ...R }],
        rows,
        totals: ['Total', '', '', '', '', '', sum(6), sum(7), sum(8)],
      },
    ],
    note: 'Approved bills are already in the books as costs and vendor payable; pending bills are not yet.',
  };
}

async function expensesByAccount(from, to) {
  const built = await buildFinancialPortal(from, to);
  const months = new Set();
  const map = {};
  for (const { e, l } of ledgerLines(operating(built.journal), (x) => getAccount(x.account)?.type === 'expense')) {
    const m = String(e.date).slice(0, 7);
    months.add(m);
    if (!map[l.account]) map[l.account] = {};
    map[l.account][m] = money((map[l.account][m] || 0) + l.debit - l.credit);
  }
  const ms = [...months].sort();
  const rows = Object.keys(map).sort().map((code) => {
    const vals = ms.map((m) => map[code][m] || 0);
    return [code, accountLabel(code), ...vals, money(vals.reduce((s, v) => s + v, 0))];
  });
  const totals = ['', 'Total', ...ms.map((_, i) => money(rows.reduce((s, r) => s + r[2 + i], 0))), money(rows.reduce((s, r) => s + r[r.length - 1], 0))];
  return {
    stats: [{ label: 'Total expenses', value: totals[totals.length - 1] }],
    sections: [
      {
        title: 'Expenses by account',
        columns: [{ label: 'Account' }, { label: 'Name' }, ...ms.map((m) => ({ label: m, ...R })), { label: 'Total', ...R }],
        rows,
        totals,
      },
    ],
  };
}

async function taxSummary(from, to) {
  const built = await buildFinancialPortal(from, to);
  const months = {};
  for (const { e, l } of ledgerLines(operating(built.journal), (x) => ['205000', '107000', '206000'].includes(x.account))) {
    const m = String(e.date).slice(0, 7);
    if (!months[m]) months[m] = { out: 0, in: 0, wht: 0 };
    if (l.account === '205000') months[m].out += l.credit - l.debit;
    if (l.account === '107000') months[m].in += l.debit - l.credit;
    if (l.account === '206000') months[m].wht += l.credit - l.debit;
  }
  const rows = Object.keys(months).sort().map((m) => {
    const x = months[m];
    return [m, money(x.out), money(x.in), money(x.out - x.in), money(x.wht)];
  });
  const sum = (i) => money(rows.reduce((s, r) => s + r[i], 0));
  return {
    stats: [
      { label: 'Output VAT', value: sum(1) },
      { label: 'Input VAT', value: sum(2) },
      { label: 'Net VAT due', value: sum(3) },
      { label: 'WHT withheld', value: sum(4) },
    ],
    sections: [
      {
        title: 'VAT and withholding by month',
        columns: [{ label: 'Month' }, { label: 'Output VAT', ...R }, { label: 'Input VAT', ...R }, { label: 'Net VAT due', ...R }, { label: 'WHT withheld', ...R }],
        rows,
        totals: ['Total', sum(1), sum(2), sum(3), sum(4)],
      },
    ],
  };
}

async function buildReport({ dataset, from, to, group, account }) {
  const ds = DATASETS[dataset] ? dataset : 'income_statement';
  let body;
  if (ds === 'income_statement') body = await incomeStatement(from, to);
  else if (ds === 'balance_sheet') body = await balanceSheetReport(to);
  else if (ds === 'trial_balance') body = await trialBalanceReport(to);
  else if (ds === 'general_ledger') body = await generalLedger(from, to, account);
  else if (ds === 'cash_book') body = await cashBook(from, to, account);
  else if (ds === 'revenue_by') body = await revenueBy(from, to, group);
  else if (ds === 'payments_received') body = await paymentsReceived(from, to);
  else if (ds === 'receivables_aging') body = await receivablesAging(to);
  else if (ds === 'owner_trust') body = await ownerTrust(from, to);
  else if (ds === 'vendor_payables') body = await vendorPayables(to);
  else if (ds === 'expenses_by_account') body = await expensesByAccount(from, to);
  else body = await taxSummary(from, to);
  const asOf = ['balance_sheet', 'trial_balance', 'receivables_aging', 'vendor_payables'].includes(ds);
  return {
    dataset: ds,
    title: DATASETS[ds] + (ds === 'revenue_by' ? ` by ${(GROUPS[group] || 'Unit').toLowerCase()}` : ''),
    subtitle: asOf ? `As of ${to}` : `${from} → ${to}`,
    meta: [{ label: asOf ? 'As of' : 'Period', value: asOf ? to : `${from} → ${to}` }, { label: 'Currency', value: 'EGP' }],
    ...body,
  };
}

module.exports = { buildReport, DATASETS, GROUPS };
