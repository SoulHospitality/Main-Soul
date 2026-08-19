export const ACCOUNT_GROUPS = {
  assets: 'Assets',
  liabilities: 'Liabilities',
  equity: 'Equity',
  revenue: 'Revenue',
  cogs: 'COGS & Direct Costs',
  opex: 'Operating Expenses',
};

export const CHART_OF_ACCOUNTS = [
  { code: '101000', name: 'Bank - EGP Main Operating Account', group: 'assets', type: 'asset', treasury: 'bank', currency: 'EGP' },
  { code: '102000', name: 'Bank - USD Foreign Currency Account', group: 'assets', type: 'asset', treasury: 'bank', currency: 'USD' },
  { code: '103000', name: 'Cash - Operations & Field Petty Cash (EGP)', group: 'assets', type: 'asset', treasury: 'cash', currency: 'EGP' },
  { code: '104000', name: 'Cash - USD Field & Guest Cash', group: 'assets', type: 'asset', treasury: 'cash', currency: 'USD' },
  { code: '105000', name: 'Guest Accounts Receivable', group: 'assets', type: 'asset' },
  { code: '106000', name: 'Payment Gateway Clearing (Paymob / Stripe / Fawry)', group: 'assets', type: 'asset' },
  { code: '107000', name: 'VAT Receivable (Input VAT 14%)', group: 'assets', type: 'asset' },
  { code: '110000', name: 'Accrued Owner Recoverables (Utilities & Maintenance)', group: 'assets', type: 'asset' },
  { code: '150000', name: 'Fixed Assets - Linens, Towels & Guest Equipment', group: 'assets', type: 'asset' },
  { code: '151000', name: 'Fixed Assets - Smart Locks & Field Tech Hardware', group: 'assets', type: 'asset' },
  { code: '159000', name: 'Accumulated Depreciation - Operating Assets', group: 'assets', type: 'asset', contra: true },
  { code: '201000', name: 'Vendor Accounts Payable', group: 'liabilities', type: 'liability' },
  { code: '202000', name: 'Owner Accounts Payable (Funds Held in Trust)', group: 'liabilities', type: 'liability' },
  { code: '203000', name: 'Guest Advance Deposits (Unearned Revenue)', group: 'liabilities', type: 'liability' },
  { code: '204000', name: 'Security Deposits Payable (Guest Escrow Holdings)', group: 'liabilities', type: 'liability' },
  { code: '205000', name: 'Tax / VAT Payable (14% Egyptian VAT)', group: 'liabilities', type: 'liability' },
  { code: '206000', name: 'Withholding Tax Payable (WHT - Egyptian Tax Authority)', group: 'liabilities', type: 'liability' },
  { code: '208000', name: 'Broker Accounts Payable', group: 'liabilities', type: 'liability' },
  { code: '209000', name: 'Sales Agent Commission Payable', group: 'liabilities', type: 'liability' },
  { code: '301000', name: 'Share Capital', group: 'equity', type: 'equity' },
  { code: '302000', name: 'Retained Earnings', group: 'equity', type: 'equity' },
  { code: '303000', name: 'Current Year Profit / Loss', group: 'equity', type: 'equity' },
  { code: '400000', name: 'Gross guest receipts (every penny in from stays & housekeeping)', group: 'revenue', type: 'revenue', virtual: true },
  { code: '401000', name: 'Management Fee / Commission Revenue (Agent Split)', group: 'revenue', type: 'revenue' },
  { code: '402000', name: 'Cleaning & Turnover Fee Revenue', group: 'revenue', type: 'revenue' },
  { code: '403000', name: 'Maintenance Markup & Service Fee Revenue', group: 'revenue', type: 'revenue' },
  { code: '404000', name: 'Direct Rental Revenue (Owned / Master-Leased)', group: 'revenue', type: 'revenue' },
  { code: '409000', name: 'Miscellaneous Guest Revenue (Early Check-in, Extra Amenities)', group: 'revenue', type: 'revenue' },
  { code: '501000', name: 'Housekeeping & Laundry Direct Costs', group: 'cogs', type: 'expense' },
  { code: '502000', name: 'Guest Welcome Amenities & Refreshments', group: 'cogs', type: 'expense' },
  { code: '503000', name: 'Direct Villa Repairs & Maintenance (Soul Cost)', group: 'cogs', type: 'expense' },
  { code: '504000', name: 'Merchant / Payment Gateway Transaction Fees', group: 'cogs', type: 'expense' },
  { code: '505000', name: 'Master-Lease Rent Expense (Principal Units)', group: 'cogs', type: 'expense' },
  { code: '508000', name: 'Staff Buffet & Meals', group: 'cogs', type: 'expense', recurring: 'buffet' },
  { code: '601000', name: 'Software & Tech Stack (Odoo, Channel Manager, PriceLabs)', group: 'opex', type: 'expense' },
  { code: '602000', name: 'Salaries, Wages & Field Staff Payroll', group: 'opex', type: 'expense' },
  { code: '603000', name: 'Marketing, OTA Promotions & Guest Acquisition', group: 'opex', type: 'expense' },
  { code: '604000', name: 'Office Rent', group: 'opex', type: 'expense', recurring: 'rent' },
  { code: '605000', name: 'Professional, CPA & Legal Fees', group: 'opex', type: 'expense' },
  { code: '606000', name: 'Depreciation & Amortization', group: 'opex', type: 'expense' },
  { code: '607000', name: 'Realized & Unrealized Foreign Exchange Gain/Loss', group: 'opex', type: 'expense' },
  { code: '608000', name: 'Company Campus Utilities', group: 'opex', type: 'expense', recurring: 'utilities' },
  { code: '609000', name: 'Sales Agent Commission Expense', group: 'opex', type: 'expense' },
];

const BY_CODE = Object.fromEntries(CHART_OF_ACCOUNTS.map((a) => [a.code, a]));

export function getAccount(code) {
  return BY_CODE[code] || null;
}

export function accountsByGroup() {
  const map = {};
  for (const acct of CHART_OF_ACCOUNTS) {
    if (!map[acct.group]) map[acct.group] = { id: acct.group, label: ACCOUNT_GROUPS[acct.group], accounts: [] };
    map[acct.group].accounts.push(acct);
  }
  return map;
}

export function signedBalance(type, debit, credit, contra = false) {
  const d = Number(debit) || 0;
  const c = Number(credit) || 0;
  const normalDebit = type === 'asset' || type === 'expense';
  const raw = normalDebit ? d - c : c - d;
  return contra ? -raw : raw;
}

export const EXPENSE_CATEGORY_TO_ACCOUNT = {
  housekeeping_cost: '501000',
  utilities_cost: '608000',
  salary: '602000',
  marketing: '603000',
  maintenance: '503000',
  professional: '605000',
  software: '601000',
  gateway_fees: '504000',
  rent: '604000',
  buffet: '508000',
  other: '503000',
};

export const TREASURY_CODES = ['101000', '102000', '103000', '104000'];
export const KPI_ACCOUNTS = ['owner_trust', 'guest_deposits', 'commission', 'vat_payable', 'wht_payable'];
export const INPUT_VAT_CATEGORIES = ['professional', 'software', 'rent', 'utilities_cost'];
