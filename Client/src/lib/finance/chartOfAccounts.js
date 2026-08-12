

export const ACCOUNT_GROUPS = {
  assets: 'Assets',
  liabilities: 'Liabilities',
  equity: 'Equity',
  revenue: 'Revenue',
  expenses: 'Operating expenses',
};

export const CHART_OF_ACCOUNTS = [
  { code: '101000', name: 'Bank - EGP Main Operating Account', group: 'assets', type: 'asset' },
  { code: '102000', name: 'Bank - USD Foreign Currency Account', group: 'assets', type: 'asset' },
  { code: '103000', name: 'Cash - Operations & Field Petty Cash', group: 'assets', type: 'asset' },
  { code: '105000', name: 'Guest Accounts Receivable', group: 'assets', type: 'asset' },
  { code: '106000', name: 'Payment Gateway Clearing (Paymob / Stripe / Fawry)', group: 'assets', type: 'asset' },
  { code: '110000', name: 'Accrued Owner Recoverables (Maintenance Reimbursables)', group: 'assets', type: 'asset' },
  { code: '150000', name: 'Fixed Assets - Linens, Towels & Guest Equipment', group: 'assets', type: 'asset' },
  { code: '151000', name: 'Fixed Assets - Smart Locks & Field Tech Hardware', group: 'assets', type: 'asset' },
  { code: '159000', name: 'Accumulated Depreciation - Operating Assets', group: 'assets', type: 'asset' },
  { code: '201000', name: 'Vendor Accounts Payable', group: 'liabilities', type: 'liability' },
  { code: '202000', name: 'Owner Accounts Payable (Funds Held in Trust)', group: 'liabilities', type: 'liability' },
  { code: '203000', name: 'Guest Advance Deposits (Unearned Revenue)', group: 'liabilities', type: 'liability' },
  { code: '204000', name: 'Security Deposits Payable (Guest Escrow Holdings)', group: 'liabilities', type: 'liability' },
  { code: '205000', name: 'Tax / VAT Payable (14% Egyptian VAT)', group: 'liabilities', type: 'liability' },
  { code: '206000', name: 'Withholding Tax Payable (WHT - Egyptian Tax Authority)', group: 'liabilities', type: 'liability' },
  { code: '301000', name: 'Share Capital', group: 'equity', type: 'equity' },
  { code: '302000', name: 'Retained Earnings', group: 'equity', type: 'equity' },
  { code: '303000', name: 'Current Year Profit / Loss', group: 'equity', type: 'equity' },
  { code: '401000', name: 'Management Fee / Commission Revenue (Agent Split)', group: 'revenue', type: 'revenue' },
  { code: '402000', name: 'Cleaning & Turnover Fee Revenue', group: 'revenue', type: 'revenue' },
  { code: '403000', name: 'Maintenance Markup & Service Fee Revenue', group: 'revenue', type: 'revenue' },
  { code: '404000', name: 'Direct Rental Revenue (Owned / Master-Leased)', group: 'revenue', type: 'revenue' },
  { code: '409000', name: 'Miscellaneous Guest Revenue (Early Check-in, Extra Amenities)', group: 'revenue', type: 'revenue' },
  { code: '501000', name: 'Housekeeping & Laundry Direct Costs', group: 'expenses', type: 'expense' },
  { code: '502000', name: 'Guest Welcome Amenities & Refreshments', group: 'expenses', type: 'expense' },
  { code: '503000', name: 'Direct Villa Repairs & Maintenance (Soul Cost)', group: 'expenses', type: 'expense' },
  { code: '504000', name: 'Merchant / Payment Gateway Transaction Fees', group: 'expenses', type: 'expense' },
  { code: '505000', name: 'Master-Lease Rent Expense (Principal Units)', group: 'expenses', type: 'expense' },
  { code: '506000', name: 'Software & Tech Stack (Odoo, Channel Manager, PriceLabs)', group: 'expenses', type: 'expense' },
  { code: '507000', name: 'Salaries, Wages & Field Staff Payroll', group: 'expenses', type: 'expense' },
  { code: '508000', name: 'Marketing, OTA Promotions & Guest Acquisition', group: 'expenses', type: 'expense' },
  { code: '509000', name: 'Office Rent & Regional Base Utilities (North Coast / Sokhna)', group: 'expenses', type: 'expense' },
  { code: '510000', name: 'Professional, CPA & Legal Fees', group: 'expenses', type: 'expense' },
  { code: '511000', name: 'Depreciation & Amortization', group: 'expenses', type: 'expense' },
  { code: '512000', name: 'Realized & Unrealized Foreign Exchange Gain/Loss', group: 'expenses', type: 'expense' },
];

const BY_CODE = Object.fromEntries(CHART_OF_ACCOUNTS.map((a) => [a.code, a]));

export function getAccount(code) {
  return BY_CODE[code] || null;
}

export function accountsByGroup() {
  const map = {};
  for (const acct of CHART_OF_ACCOUNTS) {
    if (!map[acct.group]) map[acct.group] = { label: ACCOUNT_GROUPS[acct.group], accounts: [] };
    map[acct.group].accounts.push(acct);
  }
  return map;
}

export const KPI_ACCOUNTS = ['owner_trust', 'guest_deposits', 'commission', 'vat_payable', 'wht_payable'];
