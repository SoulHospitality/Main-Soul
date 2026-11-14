/**
 * Per-user page access.
 *
 * staff_users.page_access is either NULL (the user follows their role, exactly as before) or a map:
 *   { reservations: { level: 'write', scope: 'own' }, audit_log: { level: 'read', scope: 'all' }, ... }
 * A page missing from a custom map means "no access". Admins and owners always follow their role.
 *
 * Keep PAGE_KEYS / LEVELS / SCOPES in sync with Client/src/admin/utils/pageCatalog.js.
 */

const PAGES = {
  dashboard: { levels: ['read'] },
  kpi: { levels: ['read', 'write'] },
  audit_log: { levels: ['read'], scopes: ['team', 'all'] },
  tasks: { levels: ['read', 'write'] },
  website: { levels: ['read', 'write'] },
  inbox: { levels: ['read', 'write'] },
  leads: { levels: ['read', 'write'] },
  inbox_analytics: { levels: ['read'] },
  inbox_settings: { levels: ['read', 'write'] },
  units: { levels: ['read', 'write'] },
  projects: { levels: ['read', 'write'] },
  acquisition: { levels: ['read', 'write'] },
  owner_statement: { levels: ['read'] },
  owner_blocks: { levels: ['read', 'write'] },
  owners: { levels: ['read', 'write'] },
  owner_comments: { levels: ['read', 'write'] },
  damage_reports: { levels: ['read', 'write'] },
  reservations: { levels: ['read', 'write'], scopes: ['role', 'own', 'team', 'all'] },
  website_bookings: { levels: ['read', 'write'], scopes: ['role', 'own', 'team', 'all'] },
  schedule: { levels: ['read', 'write'] },
  calendar_sync: { levels: ['read', 'write'] },
  performance: { levels: ['read', 'write'] },
  operations: { levels: ['read', 'write'] },
  ops_checkins: { levels: ['read', 'write'] },
  ops_comments: { levels: ['read', 'write'] },
  hk_today: { levels: ['read', 'write'] },
  unit_inspections: { levels: ['read', 'write'] },
  ops_team: { levels: ['read', 'write'] },
  housekeeping: { levels: ['read', 'write'] },
  petty_cash: { levels: ['read', 'write'] },
  financial_system: { levels: ['read', 'write'] },
  reports: { levels: ['read'] },
  commissions: { levels: ['read'] },
  promo_codes: { levels: ['read', 'write'] },
  users: { levels: ['read', 'write'] },
  attendance: { levels: ['read', 'write'] },
  requests: { levels: ['read', 'write'] },
  holiday_access: { levels: ['read', 'write'] },
  deductions: { levels: ['read', 'write'] },
  hr_rules: { levels: ['read', 'write'] },
  payslip: { levels: ['read'] },
  payroll: { levels: ['read', 'write'] },
  job_offers: { levels: ['read', 'write'] },
};

const PAGE_KEYS = Object.keys(PAGES);

/** API path (under /api/pms) → page. The longest matching prefix wins. */
const API_PAGES = [
  ['/audit-log', 'audit_log'],
  ['/dashboard', 'dashboard'],
  ['/kpi', 'kpi'],
  ['/staff-tasks', 'tasks'],
  ['/tasks', 'tasks'],
  ['/site-settings', 'website'],
  ['/site-popup', 'website'],
  ['/inbox/leads', 'leads'],
  ['/inbox/analytics', 'inbox_analytics'],
  ['/inbox/settings', 'inbox_settings'],
  ['/inbox/channels', 'inbox_settings'],
  ['/inbox/stages', 'inbox_settings'],
  ['/inbox/lost-reasons', 'inbox_settings'],
  ['/inbox/team', 'inbox_settings'],
  ['/inbox', 'inbox'],
  ['/units', 'units'],
  ['/pricing-recommendations', 'units'],
  ['/price-change-log', 'units'],
  ['/acquisition-leads', 'acquisition'],
  ['/acquisition-performance', 'performance'],
  ['/resale-performance', 'performance'],
  ['/reservation-targets', 'performance'],
  ['/reports/owner-statement', 'owner_statement'],
  ['/reports/export/owner-statement', 'owner_statement'],
  ['/owner-comments', 'owner_comments'],
  ['/ops/insurance-damages', 'damage_reports'],
  ['/users/owners', 'owners'],
  ['/users', 'users'],
  ['/reservations', 'reservations'],
  ['/payments', 'reservations'],
  ['/id-documents', 'reservations'],
  ['/website-bookings', 'website_bookings'],
  ['/daily-prices', 'schedule'],
  ['/blocked-dates', 'schedule'],
  ['/calendar-blocks', 'schedule'],
  ['/listing-ical', 'calendar_sync'],
  ['/ota-calendar', 'calendar_sync'],
  ['/ops/checkins-today', 'ops_checkins'],
  ['/ops/checkins-history', 'ops_checkins'],
  ['/ops/checkouts-today', 'ops_checkins'],
  ['/ops/checkin-comments', 'ops_comments'],
  ['/ops/inspections', 'unit_inspections'],
  ['/ops/agents', 'ops_team'],
  ['/ops/attendance', 'ops_team'],
  ['/ops/performance', 'ops_team'],
  ['/ops', 'operations'],
  ['/maintenance-tickets', 'operations'],
  ['/housekeeping/today-cleans', 'hk_today'],
  ['/housekeeping/cleans', 'hk_today'],
  ['/housekeeping', 'housekeeping'],
  ['/housekeeping-tasks', 'housekeeping'],
  ['/housekeeping-service-orders', 'housekeeping'],
  ['/petty-cash', 'petty_cash'],
  ['/financial-system', 'financial_system'],
  ['/expenses', 'financial_system'],
  ['/treasury', 'financial_system'],
  ['/cashflow', 'financial_system'],
  ['/utilities', 'financial_system'],
  ['/finance', 'financial_system'],
  ['/reports', 'reports'],
  ['/commissions', 'commissions'],
  ['/promo-codes', 'promo_codes'],
  ['/offers', 'promo_codes'],
  ['/hr/attendance', 'attendance'],
  ['/hr/leave-requests', 'requests'],
  ['/hr/loans', 'requests'],
  ['/hr/wfh', 'requests'],
  ['/hr/my-leave', 'requests'],
  ['/hr/requests-history', 'requests'],
  ['/hr/holiday-access', 'holiday_access'],
  ['/hr/salary-deductions', 'deductions'],
  ['/hr/salary-bonuses', 'deductions'],
  ['/hr/deduction-rules', 'hr_rules'],
  ['/hr/payroll-rules', 'hr_rules'],
  ['/hr/payslip', 'payslip'],
  ['/hr/payroll', 'payroll'],
].sort((a, b) => b[0].length - a[0].length);

/**
 * Lookups other pages depend on (unit pickers, staff pickers, the reservation drawer, sidebar badges).
 * Reading them stays open even when their own page is switched off; writes are still blocked, and
 * reservation reads are still narrowed by the reservation scope.
 */
const SHARED_READ_PAGES = new Set(['units', 'users', 'reservations', 'schedule', 'inbox', 'kpi', 'tasks', 'website_bookings']);

const ALWAYS_OPEN_ROLES = new Set(['admin', 'owner']);

function hasCustomAccess(user) {
  return Boolean(
    user && !ALWAYS_OPEN_ROLES.has(user.role) && user.page_access && typeof user.page_access === 'object'
  );
}

function pageForPath(pmsPath) {
  const path = String(pmsPath || '').split('?')[0];
  for (const [prefix, page] of API_PAGES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return page;
  }
  return null;
}

/** The PMS-relative path of a request, whichever sub-router it is in. */
function pmsPathOf(req) {
  const full = `${req.baseUrl || ''}${req.path || ''}`;
  return full.replace(/^\/api\/pms(?=\/|$)/, '') || '/';
}

function pageGrant(user, page) {
  if (!hasCustomAccess(user) || !page) return null;
  const grant = user.page_access[page];
  return grant && typeof grant === 'object' ? grant : null;
}

function isReadMethod(method) {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

/** Decide a request for a user with custom access: 'allow' | 'deny' | 'role' (fall back to role rules). */
function decide(user, method, pmsPath) {
  if (!hasCustomAccess(user)) return { verdict: 'role', page: null };
  const page = pageForPath(pmsPath);
  if (!page) return { verdict: 'role', page: null };
  const grant = pageGrant(user, page);
  const reading = isReadMethod(method);
  if (!grant) {
    if (reading && SHARED_READ_PAGES.has(page)) return { verdict: 'role', page };
    return { verdict: 'deny', page, reason: 'You do not have access to this page.' };
  }
  if (!reading && grant.level !== 'write') {
    return { verdict: 'deny', page, reason: 'You have read-only access to this page.' };
  }
  return { verdict: 'allow', page };
}

/** Express middleware for the PMS router: blocks switched-off pages and writes on read-only pages. */
function pageAccessGuard(req, res, next) {
  const result = decide(req.user, req.method, pmsPathOf(req));
  if (result.verdict === 'deny') return res.status(403).json({ error: result.reason });
  next();
}

/** Used by requireRoles: lets a user through a role-guarded route when their custom access grants its page. */
function grantsRoute(req) {
  return decide(req.user, req.method, pmsPathOf(req)).verdict === 'allow';
}

/** Reservation / website-booking scope from custom access, or null to use the role's rule. */
function customScope(user, page) {
  const grant = pageGrant(user, page);
  const scope = grant?.scope;
  return scope && scope !== 'role' && PAGES[page]?.scopes?.includes(scope) ? scope : null;
}

/** Cleans a submitted map: known pages, allowed levels and scopes only. Returns null for "use role". */
function sanitizePageAccess(input) {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Invalid page access'), { status: 400 });
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    const def = PAGES[key];
    if (!def || !value || typeof value !== 'object') continue;
    const level = def.levels.includes(value.level) ? value.level : def.levels[0];
    const entry = { level };
    if (def.scopes) entry.scope = def.scopes.includes(value.scope) ? value.scope : def.scopes[0];
    out[key] = entry;
  }
  return out;
}

module.exports = {
  PAGES,
  PAGE_KEYS,
  pageForPath,
  pmsPathOf,
  hasCustomAccess,
  pageGrant,
  decide,
  pageAccessGuard,
  grantsRoute,
  customScope,
  sanitizePageAccess,
};
