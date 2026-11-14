import { PAGE_GROUPS, customPageAccess } from './pageCatalog';

const A = '/admin';

/** Admin path of each page in the access catalog (used to land custom-access users on a page they have). */
const PAGE_PATHS = {
  dashboard: 'dashboard', clock_in: 'clock', kpi: 'kpi', audit_log: 'audit',
  website: 'website', inbox: 'inbox', leads: 'leads', inbox_analytics: 'inbox-analytics', inbox_settings: 'inbox-settings',
  units: 'units', projects: 'projects', acquisition: 'acquisition',
  owner_statement: 'owner-statement', owner_blocks: 'owner/blocks', owners: 'users', owner_comments: 'owner-comments',
  damage_reports: 'damage-reports', reservations: 'reservations', website_bookings: 'website-bookings',
  schedule: 'schedule', calendar_sync: 'calendar-sync', performance: 'performance', operations: 'operations',
  ops_checkins: 'operations', ops_comments: 'operations', hk_today: 'operations', unit_inspections: 'operations',
  ops_team: 'operations', housekeeping: 'housekeeping', petty_cash: 'petty-cash', financial_system: 'financial-system',
  reports: 'reports', commissions: 'commissions', promo_codes: 'promo-codes', users: 'users', attendance: 'attendance',
  requests: 'requests', holiday_access: 'holiday-access', deductions: 'deductions', hr_rules: 'hr-rules',
  payslip: 'payslip', payroll: 'payroll', job_offers: 'job-offers',
};

// First page listed for a path wins (e.g. /admin/operations → operations, /admin/users → users).
const PATH_PAGE = {};
for (const [key, path] of Object.entries(PAGE_PATHS)) {
  if (key !== 'owners' && !PATH_PAGE[`${A}/${path}`]) PATH_PAGE[`${A}/${path}`] = key;
}

/** Landing page for a user (or a role). Custom-access users land on the first page they were given. */
export function defaultAdminPage(userOrRole) {
  const role = typeof userOrRole === 'object' && userOrRole ? userOrRole.role : userOrRole;
  const custom = typeof userOrRole === 'object' ? customPageAccess(userOrRole) : null;
  const byRole = roleLandingPage(role);
  if (!custom) return byRole;
  const rolePage = PATH_PAGE[byRole];
  if (rolePage && custom[rolePage]) return byRole;
  for (const group of PAGE_GROUPS) {
    for (const page of group.pages) {
      if (custom[page.key] && PAGE_PATHS[page.key]) return `${A}/${PAGE_PATHS[page.key]}`;
    }
  }
  return `${A}/profile`;
}

function roleLandingPage(role) {
  switch (role) {
    case 'reservations':
    case 'reservations_web':
    case 'reservations_manual':
    case 'reservations_manager':
      return `${A}/reservations`;
    case 'operations':
    case 'operations_supervisor':
      return `${A}/operations`;
    case 'housekeeping':
    case 'housekeeping_supervisor':
      return `${A}/housekeeping`;
    case 'resale':
    case 'resale_manager':
      return `${A}/units`;
    case 'unit_acquisition_agent':
    case 'unit_acquisition_manager':
      return `${A}/units`;
    case 'finance':
    case 'finance_manager':
      return `${A}/financial-system`;
    case 'hr':
    case 'hr_supervisor':
      return `${A}/users`;
    case 'owners_relations':
      return `${A}/reservations`;
    case 'marketing_pr':
      return `${A}/reservations`;
    case 'web_developer':
      return `${A}/website`;
    case 'owner':
      return `${A}/owner`;
    default:
      return `${A}/dashboard`;
  }
}


export const ADMIN_LOGIN = '/sign-in';
export const ADMIN_CHANGE_PASSWORD = `${A}/change-password`;
export const ADMIN_OWNER_STATEMENT = `${A}/financial-system?tool=owners`;
