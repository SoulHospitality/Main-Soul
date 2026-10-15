const STAFF_HR = ['requests', 'payslip', 'profile'];

const STAFF_EDITOR = new Set([
  'admin',
  'reservations',
  'reservations_web',
  'reservations_manual',
  'reservations_manager',
  'unit_acquisition_agent',
  'unit_acquisition_manager',
  'operations',
  'operations_supervisor',
  'resale',
  'resale_manager',
  'finance',
  'finance_manager',
  'hr',
  'hr_supervisor',
  'owners_relations',
]);

const PAGE_ACCESS = {
  reservations: new Set([
    'tasks', 'reservations', 'schedule', 'calendar_sync', 'website_bookings',
    'units', 'projects', 'inbox', 'leads', ...STAFF_HR,
  ]),
  reservations_web: new Set([
    'tasks', 'reservations', 'schedule', 'calendar_sync', 'website_bookings',
    'units', 'projects', 'inbox', 'leads', ...STAFF_HR,
  ]),
  reservations_manual: new Set([
    'tasks', 'reservations', 'schedule', 'calendar_sync', 'units', 'projects',
    'inbox', 'leads', ...STAFF_HR,
  ]),
  reservations_manager: new Set([
    'tasks', 'reservations', 'schedule', 'calendar_sync', 'performance',
    'reservation_audit', 'units', 'projects', 'inbox', 'leads',
    'inbox_analytics', 'inbox_settings', ...STAFF_HR,
  ]),
  unit_acquisition_agent: new Set([
    'tasks', 'units', 'owner_comments', 'reservations', 'schedule', 'inbox', 'leads', ...STAFF_HR,
  ]),
  unit_acquisition_manager: new Set([
    'tasks', 'units', 'reservations', 'schedule', 'acquisition', 'acquisition_audit',
    'owner_statement', 'owners', 'owner_comments', 'inbox', 'leads', 'inbox_analytics', ...STAFF_HR,
  ]),
  operations: new Set([
    'tasks', 'units', 'operations', 'ops_checkins', 'hk_today', 'unit_inspections',
    'ops_team', 'reservations', 'schedule', 'inbox', ...STAFF_HR,
  ]),
  operations_supervisor: new Set([
    'tasks', 'units', 'operations', 'ops_checkins', 'ops_comments', 'hk_today',
    'unit_inspections', 'ops_team', 'damage_reports', 'reservations', 'schedule',
    'petty_cash', ...STAFF_HR,
  ]),
  resale: new Set(['tasks', 'units', 'reservations', 'inbox', ...STAFF_HR]),
  resale_manager: new Set(['tasks', 'units', 'reservations', 'inbox', ...STAFF_HR]),
  finance: new Set([
    'tasks', 'financial_system', 'units', 'reservations', 'schedule', 'inbox', ...STAFF_HR,
  ]),
  finance_manager: new Set([
    'tasks', 'financial_system', 'finance_audit', 'units', 'reservations', 'schedule', 'inbox', ...STAFF_HR,
  ]),
  hr: new Set([
    'users', 'payroll', 'deductions', 'requests', 'holiday_access', 'job_offers',
    'attendance', 'payslip', 'tasks', 'profile', 'reservations', 'units',
  ]),
  hr_supervisor: new Set([
    'users', 'payroll', 'deductions', 'requests', 'holiday_access', 'job_offers',
    'attendance', 'payslip', 'tasks', 'profile', 'reservations', 'units',
  ]),
  owners_relations: new Set([
    'units', 'reservations', 'schedule', 'owner_statement', 'owner_blocks',
    'owner_comments', 'damage_reports', 'tasks', ...STAFF_HR,
  ]),
  marketing_pr: new Set(['tasks', 'reservations', 'units', 'schedule', 'website', ...STAFF_HR]),
  web_developer: new Set(['tasks', 'site_performance', 'website', ...STAFF_HR]),
};

const GUIDE = [
  { page: 'dashboard', path: '/admin/dashboard', label: 'Dashboard', hint: 'The home counts for this role.' },
  { page: 'tasks', path: '/admin/tasks', label: 'Tasks', hint: 'Open tasks, mark yours done with a photo, or assign one if you are a manager.' },
  { page: 'units', path: '/admin/units', label: 'Units', hint: 'Search and edit short-term chalets and apartments. Long-term units are a separate page.' },
  { page: 'units_long_term', path: '/admin/units-long-term', label: 'Long-term units', hint: 'Same inventory, monthly stays.' },
  { page: 'projects', path: '/admin/projects', label: 'Destinations', hint: 'Compounds and projects the units belong to.' },
  { page: 'reservations', path: '/admin/reservations', label: 'Reservations', hint: 'Create, edit, and collect on stays. Agents see their own book. Managers see their team.' },
  { page: 'schedule', path: '/admin/schedule', label: 'Schedule', hint: 'The calendar. Drag a stay only if your role is allowed to write the grid.' },
  { page: 'website_bookings', path: '/admin/website-bookings', label: 'Website requests', hint: 'Pending site bookings waiting to be assigned or accepted.' },
  { page: 'calendar_sync', path: '/admin/calendar-sync', label: 'Calendar sync', hint: 'OTA and iCal connections for a unit.' },
  { page: 'inbox', path: '/admin/inbox', label: 'Live inbox', hint: 'Guest chats. Reply from the thread; the list hides once a chat is open on a phone.' },
  { page: 'leads', path: '/admin/leads', label: 'Leads', hint: 'Pipeline of people who have not booked yet.' },
  { page: 'operations', path: '/admin/operations', label: 'Operations', hint: 'Check-in and check-out work for the ops team.' },
  { page: 'ops_checkins', path: '/admin/operations', label: 'Check-ins', hint: 'Today’s arrivals and departures live under Operations.' },
  { page: 'hk_today', path: '/admin/operations', label: 'Housekeeping today', hint: 'Cleans due around arrivals. Open Operations and the housekeeping tab.' },
  { page: 'housekeeping', path: '/admin/operations', label: 'Housekeeping', hint: 'Cleaning tasks tied to stays.' },
  { page: 'financial_system', path: '/admin/financial-system', label: 'Financial system', hint: 'Books, expenses, and reservation money. Finance roles only.' },
  { page: 'users', path: '/admin/users', label: 'User management', hint: 'Staff accounts, roles, and managers. HR and the CEO.' },
  { page: 'attendance', path: '/admin/attendance', label: 'Attendance', hint: 'Clock-in records. HR reviews them; staff see their own day.' },
  { page: 'requests', path: '/admin/requests', label: 'Requests', hint: 'Leave, loans, and work-from-home. Staff file their own. HR approves.' },
  { page: 'payslip', path: '/admin/payslip', label: 'Payslip', hint: 'Your own pay slip. Nobody else’s.' },
  { page: 'payroll', path: '/admin/payroll', label: 'Payrolls', hint: 'The payroll run. HR only.' },
  { page: 'owner_statement', path: '/admin/owner-statement', label: 'Owner statement', hint: 'Export a unit statement. Amounts are already available in chat.' },
  { page: 'acquisition', path: '/admin/acquisition', label: 'Owner leads', hint: 'Units the acquisition team is trying to sign.' },
  { page: 'website', path: '/admin/website', label: 'Website', hint: 'Public site content and popups.' },
  { page: 'site_performance', path: '/admin/website-performance', label: 'Website performance', hint: 'How the public site is behaving.' },
  { page: 'profile', path: '/admin/profile', label: 'Profile', hint: 'Your name, code, and password live here.' },
];

function soullyCan(user, page) {
  if (!user || user.role === 'owner') return false;
  if (user.role === 'admin') return true;
  let key = page;
  if (key === 'profile' || key === 'change-password') return true;
  if (key === 'holiday_requests' || key === 'loans' || key === 'wfh') key = 'requests';
  if (key === 'units_long_term') key = 'units';
  if (key === 'owner_statement' && STAFF_EDITOR.has(user.role)) return true;
  const allowed = PAGE_ACCESS[user.role];
  if (!allowed) return false;
  return allowed.has(key);
}

function allowedGuide(user) {
  return GUIDE.filter((item) => soullyCan(user, item.page));
}

function soullyEnabled(user) {
  return Boolean(user && user.role === 'admin' && user.is_active !== false);
}

module.exports = { soullyCan, allowedGuide, soullyEnabled, GUIDE };
