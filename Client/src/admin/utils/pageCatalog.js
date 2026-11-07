/**
 * Every PMS page a CEO can grant per user, with the access levels and data scopes it supports.
 * Keep keys, levels and scopes in sync with Server/src/lib/pageAccess.js (the server enforces them).
 */

export const LEVEL_LABELS = { read: 'Read only', write: 'Read & write' };

export const SCOPE_LABELS = {
  role: 'Same as role',
  own: 'Own only',
  team: 'Own + team',
  all: 'All',
};

export const SCOPE_HINTS = {
  reservations: {
    role: 'Follow the role rule (e.g. finance sees website bookings, operations sees assigned stays).',
    own: 'Only reservations this person sold or created.',
    team: 'Their own plus everyone who reports to them.',
    all: 'Every reservation.',
  },
  website_bookings: {
    role: 'Follow the role rule.',
    own: 'Only requests assigned to this person.',
    team: 'Requests assigned to them or anyone who reports to them.',
    all: 'Every website request.',
  },
  audit_log: {
    team: 'Changes made by them and the people who report to them.',
    all: 'Every change by anyone.',
  },
};

const RW = ['read', 'write'];
const R = ['read'];

export const PAGE_GROUPS = [
  {
    id: 'overview',
    label: 'Overview',
    pages: [
      { key: 'dashboard', label: 'Dashboard', levels: R },
      { key: 'kpi', label: 'KPI', levels: RW },
      { key: 'audit_log', label: 'Audit Log', levels: R, scopes: ['team', 'all'] },
      { key: 'site_performance', label: 'Website Performance', levels: R },
      { key: 'website', label: 'Website', levels: RW },
    ],
  },
  {
    id: 'crm',
    label: 'CRM',
    pages: [
      { key: 'inbox', label: 'Live Inbox', levels: RW },
      { key: 'leads', label: 'Leads & Pipeline', levels: RW },
      { key: 'inbox_analytics', label: 'Inbox Analytics', levels: R },
      { key: 'inbox_settings', label: 'Inbox Settings', levels: RW },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    pages: [
      { key: 'units', label: 'Units (Short Term)', levels: RW },
      { key: 'units_long_term', label: 'Units (Long Term)', levels: RW },
      { key: 'projects', label: 'Destinations', levels: RW },
      { key: 'acquisition', label: 'Owner leads', levels: RW },
      { key: 'owner_statement', label: 'Owner Statement', levels: R },
      { key: 'owner_blocks', label: 'Owner blocks', levels: RW },
      { key: 'owners', label: 'Owners', levels: RW },
      { key: 'owner_comments', label: 'Owner comments', levels: RW },
      { key: 'damage_reports', label: 'Damage reports', levels: RW },
    ],
  },
  {
    id: 'bookings',
    label: 'Bookings',
    pages: [
      { key: 'reservations', label: 'Reservations', levels: RW, scopes: ['role', 'own', 'team', 'all'] },
      { key: 'website_bookings', label: 'Website Requests', levels: RW, scopes: ['role', 'own', 'team', 'all'] },
      { key: 'schedule', label: 'Schedule', levels: RW },
      { key: 'calendar_sync', label: 'Calendar Sync', levels: RW },
      { key: 'performance', label: 'Performance', levels: RW },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    pages: [
      { key: 'operations', label: 'Operations', levels: RW },
      { key: 'ops_checkins', label: 'Check-ins & check-outs', levels: RW },
      { key: 'ops_comments', label: 'Check-in comments', levels: RW },
      { key: 'hk_today', label: 'Today’s cleaning', levels: RW },
      { key: 'unit_inspections', label: 'Unit inspections', levels: RW },
      { key: 'ops_team', label: 'Operations team', levels: RW },
      { key: 'housekeeping', label: 'Housekeeping', levels: RW },
      { key: 'petty_cash', label: 'Petty Cash', levels: RW },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    pages: [
      { key: 'financial_system', label: 'Financial System', levels: RW },
      { key: 'reports', label: 'Reports', levels: R },
      { key: 'commissions', label: 'Commissions', levels: R },
      { key: 'promo_codes', label: 'Promo Codes', levels: RW },
    ],
  },
  {
    id: 'hr',
    label: 'HR',
    pages: [
      { key: 'users', label: 'User Management', levels: RW },
      { key: 'attendance', label: 'Attendance', levels: RW },
      { key: 'requests', label: 'Requests', levels: RW },
      { key: 'holiday_access', label: 'Holidays access', levels: RW },
      { key: 'deductions', label: 'Deductions/Bonus', levels: RW },
      { key: 'hr_rules', label: 'HR rules', levels: RW },
      { key: 'payslip', label: 'Payslip', levels: R },
      { key: 'payroll', label: 'Payrolls', levels: RW },
      { key: 'job_offers', label: 'Job offers', levels: RW },
    ],
  },
];

export const PAGE_DEFS = Object.fromEntries(PAGE_GROUPS.flatMap((g) => g.pages.map((p) => [p.key, p])));

/** Roles that always follow their built-in access (no per-user override). */
export const FIXED_ACCESS_ROLES = new Set(['admin', 'owner']);

/** The user's custom page map, or null when they follow their role. */
export function customPageAccess(user) {
  if (!user || FIXED_ACCESS_ROLES.has(user.role)) return null;
  const access = user.page_access;
  return access && typeof access === 'object' && !Array.isArray(access) ? access : null;
}
