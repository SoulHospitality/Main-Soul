const XLSX = require('xlsx');
const { round2, calcReservationFinancials } = require('../commission');
const { ACCOUNT_GROUPS } = require('./chartOfAccounts');
const { bookingSplit } = require('./taxEngine');

function money(n) {
  return round2(Number(n) || 0);
}

function iso(d) {
  return String(d || '').slice(0, 10);
}

function sheetFromAoA(rows, colWidths = []) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (colWidths.length) {
    ws['!cols'] = colWidths.map((wch) => ({ wch }));
  }
  // Light number format for numeric cells in column B+ where values look like money
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let R = range.s.r; R <= range.e.r; R += 1) {
    for (let C = range.s.c; C <= range.e.c; C += 1) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr];
      if (cell && typeof cell.v === 'number') {
        cell.t = 'n';
        cell.z = '#,##0.00';
      }
    }
  }
  return ws;
}

function blank() {
  return [];
}

function title(text) {
  return [String(text || '')];
}

function kv(label, value) {
  return [label, value == null || value === '' ? '—' : value];
}

function header(...cols) {
  return cols;
}

function addSheet(wb, name, rows, widths) {
  const safe = String(name || 'Sheet').slice(0, 31);
  XLSX.utils.book_append_sheet(wb, sheetFromAoA(rows, widths), safe);
}

function buildCoverSheet({ from, to, generatedAt, kpis, outstanding }) {
  const rows = [
    title('SOUL HOSPITALITY'),
    title('Financial System — Full Period Report'),
    blank(),
    kv('Period from', from),
    kv('Period to', to || 'Open'),
    kv('Filter basis', 'Created / booked date'),
    kv('Generated at', generatedAt),
    kv('Currency', 'EGP'),
    blank(),
    title('EXECUTIVE SUMMARY'),
    blank(),
    header('Metric', 'Amount (EGP)'),
    kv('Gross revenue', money(kpis.gross_revenue ?? kpis.revenue)),
    kv('Owner share', money(kpis.owner_share)),
    kv('Company / Soul fees', money(kpis.soul_fees ?? kpis.commission)),
    kv('Net revenue (company view)', money(kpis.net_revenue)),
    kv('COGS / direct costs', money(kpis.cogs)),
    kv('Gross profit', money(kpis.gross_profit)),
    kv('Operating expenses', money(kpis.opex)),
    kv('Net profit', money(kpis.net_profit)),
    blank(),
    title('TREASURY & WORKING CAPITAL'),
    blank(),
    header('Metric', 'Amount (EGP)'),
    kv('Collected in period', money(kpis.collected)),
    kv('Treasury total', money(kpis.treasury_total)),
    kv('Treasury inflows', money(kpis.treasury_in)),
    kv('Bank EGP', money(kpis.bank_egp)),
    kv('Cash EGP', money(kpis.cash_egp)),
    kv('Gateway clearing', money(kpis.gateway_clearing)),
    kv('Guest AR', money(kpis.guest_ar)),
    kv('Outstanding (unpaid stays)', money(kpis.uncollected ?? outstanding?.amount)),
    kv('Outstanding stay count', outstanding?.count ?? 0),
    kv('Owner trust held', money(kpis.owner_trust)),
    blank(),
    title('TAX'),
    blank(),
    header('Metric', 'Amount (EGP)'),
    kv('VAT output', money(kpis.vat_output)),
    kv('VAT input', money(kpis.vat_input)),
    kv('VAT payable (net)', money(kpis.vat_payable)),
  ];
  return rows;
}

function pushAccountSection(rows, sectionLabel, accounts) {
  rows.push([sectionLabel, '', '']);
  for (const a of accounts || []) {
    if (a.virtual) continue;
    rows.push(['', `${a.code || ''}  ${a.name || ''}`.trim(), money(a.balance)]);
  }
}

function buildPnlSheet(statements) {
  const pnl = statements?.profit_and_loss || {};
  const totals = pnl.totals || {};
  const receipts = pnl.receipts || {};
  const rows = [
    title('PROFIT & LOSS'),
    blank(),
    title('GROSS RECEIPTS'),
    blank(),
    header('Section', 'Account / Item', 'Amount (EGP)'),
    kv('Receipts', 'Gross reservation + custom revenue', money(receipts.total ?? totals.gross_revenue)),
    kv('Receipts', 'Stay revenue', money(receipts.stays)),
    kv('Receipts', 'Stay count', receipts.stay_count || 0),
    kv('Receipts', 'Custom / manual revenue', money(receipts.custom)),
    kv('Receipts', 'Custom revenue count', receipts.custom_count || 0),
    kv('Receipts', 'Owner share (of stays)', money(receipts.owner_share ?? totals.owner_share)),
    kv('Receipts', 'Company / commission share', money(totals.company_share ?? receipts.company_share)),
    blank(),
    title('LEDGER P&L ACCOUNTS'),
    blank(),
    header('Section', 'Account / Item', 'Amount (EGP)'),
  ];

  pushAccountSection(rows, 'REVENUE', pnl.revenue);
  rows.push(blank());
  pushAccountSection(rows, 'COGS', pnl.cogs);
  rows.push(blank());
  pushAccountSection(rows, 'OPEX', pnl.opex);

  rows.push(
    blank(),
    title('TOTALS'),
    blank(),
    header('Metric', 'Amount (EGP)'),
    kv('Gross revenue', money(totals.gross_revenue ?? receipts.total)),
    kv('Owner share', money(totals.owner_share)),
    kv('Net revenue (after owner share)', money(totals.net_revenue)),
    kv('Soul fees / posted revenue', money(totals.soul_fees ?? totals.revenue)),
    kv('COGS (ex owner share)', money(totals.cogs)),
    kv('Gross profit', money(totals.gross)),
    kv('Operating expenses', money(totals.opex)),
    kv('Net profit', money(totals.net))
  );
  return rows;
}

function buildTreasurySheet(treasury = [], kpis = {}) {
  const rows = [
    title('TREASURY'),
    blank(),
    header('Code', 'Account', 'Currency', 'Kind', 'Inflow', 'Outflow', 'Balance', 'Txns'),
  ];
  for (const t of treasury) {
    rows.push([
      t.code,
      t.name,
      t.currency || 'EGP',
      t.kind || '',
      money(t.inflow),
      money(t.outflow),
      money(t.balance),
      t.txn_count || 0,
    ]);
  }
  rows.push(
    blank(),
    kv('Treasury total', money(kpis.treasury_total)),
    kv('Treasury inflows', money(kpis.treasury_in)),
    kv('Collected (collections)', money(kpis.collected))
  );
  return rows;
}

function buildCoaSheet(groups = [], accounts = []) {
  const rows = [
    title('CHART OF ACCOUNTS — PERIOD BALANCES'),
    blank(),
    header('Group', 'Code', 'Account', 'Type', 'Debit', 'Credit', 'Balance', 'Txns'),
  ];
  const byCode = Object.fromEntries((accounts || []).map((a) => [a.code, a]));
  for (const g of groups) {
    rows.push([ACCOUNT_GROUPS[g.id] || g.label || g.id, '', '', '', '', '', money(g.balance), '']);
    for (const a of g.accounts || []) {
      const live = byCode[a.code] || a;
      rows.push([
        '',
        live.code || a.code,
        live.name || a.name,
        live.type || a.type || '',
        money(live.debit),
        money(live.credit),
        money(live.balance),
        live.txn_count || 0,
      ]);
    }
    rows.push(blank());
  }
  return rows;
}

function buildBalanceSheet(statements) {
  const bs = statements?.balance_sheet || {};
  const totals = bs.totals || {};
  const rows = [
    title('BALANCE SHEET'),
    blank(),
    header('Section', 'Code', 'Account', 'Amount (EGP)'),
  ];
  const sections = [
    ['ASSETS', bs.assets, totals.assets],
    ['LIABILITIES', bs.liabilities, totals.liabilities],
    ['EQUITY', bs.equity, totals.equity],
  ];
  for (const [label, list, sectionTotal] of sections) {
    rows.push([label, '', '', money(sectionTotal)]);
    for (const a of list || []) {
      rows.push(['', a.code, a.name, money(a.balance ?? a.amount)]);
    }
    rows.push(blank());
  }
  rows.push(kv('Assets total', money(totals.assets)));
  rows.push(kv('Liabilities total', money(totals.liabilities)));
  rows.push(kv('Equity total', money(totals.equity)));
  rows.push(kv('Liabilities + Equity', money(totals.liabilities_and_equity)));
  return rows;
}

function buildTrialBalance(statements) {
  const tb = statements?.trial_balance || {};
  const rows = [
    title('TRIAL BALANCE'),
    blank(),
    header('Code', 'Account', 'Type', 'Debit', 'Credit', 'Balance'),
  ];
  for (const a of tb.accounts || tb.rows || []) {
    rows.push([a.code, a.name, a.type || '', money(a.debit), money(a.credit), money(a.balance)]);
  }
  rows.push(blank());
  rows.push(kv('Total debit', money(tb.debit ?? tb.total_debit ?? tb.totals?.debit)));
  rows.push(kv('Total credit', money(tb.credit ?? tb.total_credit ?? tb.totals?.credit)));
  return rows;
}

function buildCashFlow(statements) {
  const cf = statements?.cash_flow || {};
  const rows = [
    title('CASH FLOW (treasury movements)'),
    blank(),
    header('Category', 'Amount (EGP)'),
    kv('Operating inflows', money(cf.operating_in)),
    kv('Operating outflows', money(cf.operating_out)),
    kv('Operating net', money(cf.operating_net)),
    kv('Financing outflows (owner payouts)', money(cf.financing_out)),
    kv('Net change in treasury', money(cf.net_change)),
  ];
  if (cf.note) {
    rows.push(blank(), kv('Note', cf.note));
  }
  return rows;
}

function buildBookingsSheet(reservations = []) {
  const rows = [
    title('BOOKINGS (by created date)'),
    blank(),
    header(
      'ID',
      'Guest',
      'Unit',
      'Project',
      'Created',
      'Check-in',
      'Check-out',
      'Status',
      'Gross',
      'Commission',
      'Cleaning',
      'VAT',
      'Owner share',
      'Amount paid',
      'Remaining'
    ),
  ];
  for (const r of reservations) {
    const fin = calcReservationFinancials(r, r);
    const split = bookingSplit(fin, r);
    const total = money(r.total_amount);
    const paid = money(r.amount_paid);
    rows.push([
      r.id,
      r.guest_name || '',
      r.unit_name || r.unit_number || '',
      r.project || '',
      iso(r.created_at),
      iso(r.check_in),
      iso(r.check_out),
      r.status || '',
      money(split.gross_booking),
      money(split.soul_commission),
      money(split.cleaning_fee),
      money(split.vat_on_commission),
      money(split.owner_trust_credit),
      paid,
      money(Math.max(0, total - paid)),
    ]);
  }
  return rows;
}

function buildExpensesSheet(expenses = []) {
  const rows = [
    title('EXPENSES (by created date)'),
    blank(),
    header('ID', 'Created', 'Expense date', 'Category', 'Description', 'Amount', 'Paid by', 'Unit'),
  ];
  for (const e of expenses) {
    rows.push([
      e.id,
      iso(e.created_at),
      iso(e.expense_date),
      e.category || '',
      e.description || '',
      money(e.amount),
      e.paid_by || 'company',
      e.unit_id || '',
    ]);
  }
  if (expenses.length === 0) rows.push(['', '', '', '', 'No expenses in period', '', '', '']);
  return rows;
}

function buildPaymentsSheet(payments = []) {
  const rows = [
    title('PAYMENTS / COLLECTIONS (by created date)'),
    blank(),
    header('ID', 'Created', 'Payment date', 'Reservation', 'Amount', 'Method', 'Status', 'Notes'),
  ];
  for (const p of payments) {
    rows.push([
      p.id,
      iso(p.created_at),
      iso(p.payment_date || p.paid_at),
      p.reservation_id || '',
      money(p.amount),
      p.payment_method || '',
      p.status || '',
      String(p.notes || '').slice(0, 120),
    ]);
  }
  if (payments.length === 0) rows.push(['', '', '', '', 'No payments in period', '', '', '']);
  return rows;
}

function buildHkSheet(orders = []) {
  const rows = [
    title('HOUSEKEEPING SERVICE ORDERS (by created date)'),
    blank(),
    header('ID', 'Created', 'Period start', 'Client / Unit', 'Amount', 'Status'),
  ];
  for (const hk of orders) {
    rows.push([
      hk.id,
      iso(hk.created_at),
      iso(hk.period_start),
      hk.client_name || hk.unit_number || '',
      money(hk.amount),
      hk.status || '',
    ]);
  }
  if (orders.length === 0) rows.push(['', '', '', 'No housekeeping orders in period', '', '']);
  return rows;
}

function buildManualSheet(entries = []) {
  const rows = [
    title('MANUAL ENTRIES (by created date)'),
    blank(),
    header('ID', 'Created', 'Entry date', 'Type', 'Flow', 'Description', 'Amount', 'Unit', 'Notes'),
  ];
  for (const m of entries) {
    rows.push([
      m.id,
      iso(m.created_at),
      iso(m.entry_date),
      m.entry_type || '',
      m.misc_flow || '',
      m.description || '',
      money(m.amount),
      m.unit_name || '',
      m.notes || '',
    ]);
  }
  if (entries.length === 0) rows.push(['', '', '', '', '', 'No manual entries in period', '', '', '']);
  return rows;
}

function buildPettySheet(rowsIn = []) {
  const rows = [
    title('PETTY CASH (by created date)'),
    blank(),
    header('ID', 'Created', 'Entry date', 'Type', 'Amount', 'Location', 'Description', 'Status'),
  ];
  for (const pc of rowsIn) {
    rows.push([
      pc.id,
      iso(pc.created_at),
      iso(pc.entry_date),
      pc.entry_type || '',
      money(pc.amount),
      pc.location || '',
      pc.description || '',
      pc.status || '',
    ]);
  }
  if (rowsIn.length === 0) rows.push(['', '', '', '', 'No petty cash in period', '', '', '']);
  return rows;
}

function buildOwnerTrustSheet(trust, payouts = [], holdbacks = []) {
  const rows = [
    title('OWNER TRUST & PAYOUTS'),
    blank(),
    kv('Control account 202000', money(trust?.control_202000)),
    kv('Subledger tied to control', trust?.tied ? 'Yes' : 'No / check reconciling items'),
    blank(),
    title('Owner balances'),
    blank(),
    header('Owner ID', 'Owner', 'Credits', 'Payouts', 'Holdbacks', 'Expenses', 'Balance'),
  ];
  for (const o of trust?.rows || []) {
    rows.push([
      o.owner_id || o.id || '',
      o.owner_name || o.full_name || '',
      money(o.credits),
      money(o.payouts),
      money(o.holdbacks ?? o.holdback),
      money(o.expenses),
      money(o.balance ?? o.amount ?? o.available ?? o.remaining),
    ]);
  }
  rows.push(blank(), title('Payout requests'), blank());
  rows.push(header('ID', 'Owner', 'Status', 'Gross', 'Commission', 'Net', 'Created', 'Reviewed'));
  for (const p of payouts) {
    rows.push([
      p.id,
      p.owner_name || p.owner_id,
      p.status || '',
      money(p.gross_amount),
      money(p.commission_amount),
      money(p.net_amount),
      iso(p.created_at),
      iso(p.reviewed_at),
    ]);
  }
  rows.push(blank(), title('Active holdbacks'), blank());
  rows.push(header('ID', 'Owner', 'Amount', 'Reason', 'Created'));
  for (const h of (holdbacks || []).filter((x) => !Number(x.is_released))) {
    rows.push([
      h.id,
      h.owner_name || h.owner_id,
      money(h.amount),
      h.reason || '',
      iso(h.created_at),
    ]);
  }
  return rows;
}

function buildVatSheet(vat) {
  return [
    title('VAT RETURN'),
    blank(),
    header('Item', 'Amount (EGP)'),
    kv('Output VAT', money(vat?.output_vat)),
    kv('Input VAT', money(vat?.input_vat)),
    kv('Net VAT payable', money(vat?.net_vat_payable)),
  ];
}

function buildAgingSheet(aging) {
  const buckets = aging?.buckets || {};
  const rows = [
    title('ACCOUNTS RECEIVABLE AGING'),
    blank(),
    kv('As of', aging?.as_of || '—'),
    kv('Total outstanding', money(aging?.total)),
    blank(),
    header('Bucket', 'Amount (EGP)', 'Count'),
  ];
  const order = ['current', 'd31', 'd61', 'd90'];
  for (const key of order) {
    const b = buckets[key];
    if (!b) continue;
    rows.push([b.label || key, money(b.amount), b.count || 0]);
  }

  const detail = [];
  for (const key of order) {
    for (const r of buckets[key]?.rows || []) detail.push(r);
  }
  if (detail.length) {
    rows.push(blank(), title('Outstanding stays'), blank());
    rows.push(header('Reservation', 'Guest', 'Unit', 'Check-in', 'Due', 'Days'));
    for (const r of detail) {
      rows.push([
        r.reservation_id || r.id,
        r.guest_name || '',
        r.unit_name || '',
        iso(r.check_in),
        money(r.amount ?? r.due ?? r.remaining),
        r.days ?? r.days_overdue ?? '',
      ]);
    }
  }
  return rows;
}

function buildJournalSheet(journal = []) {
  const rows = [
    title('JOURNAL (period)'),
    blank(),
    header('Date', 'Entry ID', 'Type', 'Description', 'Account', 'Account name', 'Debit', 'Credit', 'Memo'),
  ];
  const capped = journal.slice(0, 5000);
  for (const e of capped) {
    for (const line of e.lines || []) {
      rows.push([
        iso(e.date),
        e.id,
        e.type || '',
        e.description || '',
        line.account,
        line.account_name || '',
        money(line.debit),
        money(line.credit),
        line.memo || '',
      ]);
    }
  }
  if (journal.length > capped.length) {
    rows.push(blank(), [`… truncated ${journal.length - capped.length} additional entries`]);
  }
  return rows;
}

function buildContentsSheet() {
  return [
    title('REPORT CONTENTS'),
    blank(),
    header('Sheet', 'Contents'),
    ['01 Summary', 'Executive KPIs — revenue, profit, treasury, VAT'],
    ['02 P&L', 'Gross receipts and profit & loss accounts'],
    ['03 Treasury', 'Bank, cash, gateway balances and flows'],
    ['04 Chart of Accounts', 'Period account balances by group'],
    ['05 Balance Sheet', 'Assets, liabilities, and equity'],
    ['06 Trial Balance', 'Debits and credits by account'],
    ['07 Cash Flow', 'Treasury operating and financing movements'],
    ['08 Bookings', 'Reservations with commission / owner splits'],
    ['09 Expenses', 'Operating and unit expenses'],
    ['10 Payments', 'Guest collections and refunds'],
    ['11 Housekeeping', 'Housekeeping service orders'],
    ['12 Manual Entries', 'Manual revenue and expense entries'],
    ['13 Petty Cash', 'Petty cash movements'],
    ['14 Owner Trust', 'Owner subledger, payouts, holdbacks'],
    ['15 VAT', 'Output / input VAT return'],
    ['16 AR Aging', 'Outstanding guest receivables by age'],
    ['17 Journal', 'Full period journal lines (capped)'],
  ];
}

/**
 * Build a full Soul financial workbook for the given period.
 * @param {{ from: string, to: string|null, portal: object, statements: object, vat: object, aging: object, trust: object }} pack
 */
function buildFinancialWorkbook(pack) {
  const { from, to, portal, statements, vat, aging, trust } = pack;
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const data = portal?.data || {};
  const wb = XLSX.utils.book_new();

  addSheet(wb, '00 Contents', buildContentsSheet(), [18, 52]);
  addSheet(
    wb,
    '01 Summary',
    buildCoverSheet({
      from,
      to,
      generatedAt,
      kpis: portal?.kpis || {},
      outstanding: portal?.outstanding,
    }),
    [36, 18]
  );
  addSheet(wb, '02 P&L', buildPnlSheet(statements), [16, 48, 16]);
  addSheet(wb, '03 Treasury', buildTreasurySheet(portal?.treasury || [], portal?.kpis || {}), [
    10, 42, 10, 10, 14, 14, 14, 8,
  ]);
  addSheet(wb, '04 Chart of Accounts', buildCoaSheet(portal?.groups || [], portal?.accounts || []), [
    18, 10, 48, 12, 14, 14, 14, 8,
  ]);
  addSheet(wb, '05 Balance Sheet', buildBalanceSheet(statements), [16, 10, 48, 16]);
  addSheet(wb, '06 Trial Balance', buildTrialBalance(statements), [10, 48, 12, 14, 14, 14]);
  addSheet(wb, '07 Cash Flow', buildCashFlow(statements), [42, 16]);
  addSheet(wb, '08 Bookings', buildBookingsSheet(portal?.reservations || []), [
    8, 22, 14, 16, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12,
  ]);
  addSheet(wb, '09 Expenses', buildExpensesSheet(data.expenses || []), [8, 12, 12, 16, 40, 12, 12, 12]);
  addSheet(wb, '10 Payments', buildPaymentsSheet(data.payments || []), [8, 12, 12, 12, 12, 14, 12, 28]);
  addSheet(wb, '11 Housekeeping', buildHkSheet(data.hkOrders || []), [8, 12, 12, 28, 12, 12]);
  addSheet(wb, '12 Manual Entries', buildManualSheet(data.manuals || []), [
    8, 12, 12, 12, 10, 36, 12, 14, 24,
  ]);
  addSheet(wb, '13 Petty Cash', buildPettySheet(data.petty || []), [8, 12, 12, 10, 12, 14, 32, 10]);
  addSheet(
    wb,
    '14 Owner Trust',
    buildOwnerTrustSheet(trust, portal?.payouts || [], data.holdbacks || portal?.holdbacks || []),
    [12, 24, 12, 12, 12, 12, 12]
  );
  addSheet(wb, '15 VAT', buildVatSheet(vat), [28, 16]);
  addSheet(wb, '16 AR Aging', buildAgingSheet(aging), [14, 16, 10, 22, 14, 12, 12]);
  addSheet(wb, '17 Journal', buildJournalSheet(portal?.journal || []), [
    12, 18, 16, 36, 10, 28, 12, 12, 24,
  ]);

  return wb;
}

function workbookToBuffer(wb) {
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  buildFinancialWorkbook,
  workbookToBuffer,
};
