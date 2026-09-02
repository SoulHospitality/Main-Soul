export const ROLES = {
  ADMIN: 'admin',
  RESERVATIONS: 'reservations',
  RESERVATIONS_WEB: 'reservations_web',
  RESERVATIONS_MANUAL: 'reservations_manual',
  RESERVATIONS_MANAGER: 'reservations_manager',
  UNIT_ACQUISITION_AGENT: 'unit_acquisition_agent',
  UNIT_ACQUISITION_MANAGER: 'unit_acquisition_manager',
  OPERATIONS: 'operations',
  OPERATIONS_SUPERVISOR: 'operations_supervisor',
  HOUSEKEEPING: 'housekeeping',
  HOUSEKEEPING_SUPERVISOR: 'housekeeping_supervisor',
  RESALE: 'resale',
  RESALE_MANAGER: 'resale_manager',
  FINANCE: 'finance',
  FINANCE_MANAGER: 'finance_manager',
  HR: 'hr',
  HR_SUPERVISOR: 'hr_supervisor',
  OWNERS_RELATIONS: 'owners_relations',
  OWNER: 'owner',
  MARKETING_PR: 'marketing_pr',
  WEB_DEVELOPER: 'web_developer',
};

const RESERVATIONS_TEAM = new Set([
  'reservations',
  'reservations_web',
  'reservations_manual',
]);

const RESERVATIONS_PAGE_ACCESS = new Set([
  'dashboard',
  'reservations',
  'schedule',
  'calendar_sync',
  'housekeeping',
  'commissions',
  'holiday_requests',
  'profile',
]);


const RESERVATIONS_MANUAL_PAGE_ACCESS = new Set([
  'reservations',
  'schedule',
  'calendar_sync',
  'holiday_requests',
  'profile',
]);

const RESERVATIONS_WEB_PAGE_ACCESS = new Set([
  ...RESERVATIONS_PAGE_ACCESS,
  'website_bookings',
  'units',
]);

const RESALE_PAGE_ACCESS = new Set(['units_sale', 'acquisition', 'commissions', 'profile']);

const RESALE_MANAGER_PAGE_ACCESS = new Set([
  'units_sale',
  'acquisition',
  'commissions',
  'performance',
  'profile',
]);

const FINANCE_PAGE_ACCESS = new Set(['financial_system', 'profile']);

const FINANCE_MANAGER_PAGE_ACCESS = new Set(['financial_system', 'finance_audit', 'profile']);

const RESERVATIONS_MANAGER_PAGE_ACCESS = new Set([
  'reservations',
  'schedule',
  'calendar_sync',
  'performance',
  'holiday_requests',
  'profile',
]);

const RESERVATIONS_PERMISSIONS = [
  'dashboard:read',
  'units:read',
  'reservations:read',
  'reservations:write',
  'reservations:confirm',
  'reservations:delete',
  'schedule:read',
  'housekeeping:read',
  'housekeeping:write',
  'notifications:read',
  'documents:read',
  'documents:write',
];

const RESERVATIONS_MANUAL_PERMISSIONS = [
  'units:read',
  'reservations:read',
  'reservations:write',
  'reservations:confirm',
  'reservations:delete',
  'schedule:read',
  'notifications:read',
  'documents:read',
  'documents:write',
];

const RESERVATIONS_WEB_PERMISSIONS = [
  ...RESERVATIONS_PERMISSIONS,
  'units:write',
];

const HR_PERMISSIONS = [
  'users:read',
  'users:write',
  'payroll:read',
  'payroll:write',
  'deductions:read',
  'deductions:write',
  'holiday_requests:read',
  'holiday_requests:write',
  'job_offers:read',
  'job_offers:write',
  'attendance:read',
  'attendance:write',
  'loans:read',
  'loans:write',
  'wfh:read',
  'wfh:write',
  'notifications:read',
  'documents:read',
  'documents:write',
];

const HR_PAGE_ACCESS = new Set([
  'users',
  'payroll',
  'deductions',
  'holiday_requests',
  'holiday_access',
  'job_offers',
  'attendance',
  'loans',
  'wfh',
  'payslip',
  'profile',
]);

const HR_SUPERVISOR_PAGE_ACCESS = new Set([...HR_PAGE_ACCESS]);

const PERMISSIONS = {
  admin: ['*'],
  reservations: RESERVATIONS_WEB_PERMISSIONS,
  reservations_web: RESERVATIONS_WEB_PERMISSIONS,
  reservations_manual: RESERVATIONS_MANUAL_PERMISSIONS,
  reservations_manager: [
    'units:read',
    'reservations:read',
    'reservations:write',
    'reservations:confirm',
    'reservations:delete',
    'schedule:read',
    'calendar_sync:write',
    'performance:read',
    'notifications:read',
    'documents:read',
    'documents:write',
  ],
  unit_acquisition_agent: [
    'units:read',
    'units:write',
    'acquisition:read',
    'acquisition:write',
    'owners:read',
    'owners:write',
    'notifications:read',
    'documents:read',
    'documents:write',
  ],
  unit_acquisition_manager: [
    'units:read',
    'units:write',
    'acquisition:read',
    'acquisition:write',
    'acquisition_audit:read',
    'owners:read',
    'owners:write',
    'notifications:read',
    'documents:read',
    'documents:write',
  ],
  resale: [
    'units:read',
    'units:write',
    'units:delete',
    'acquisition:read',
    'acquisition:write',
    'commissions:read',
    'notifications:read',
    'documents:read',
    'documents:write',
  ],
  resale_manager: [
    'units:read',
    'units:write',
    'units:delete',
    'acquisition:read',
    'acquisition:write',
    'commissions:read',
    'performance:read',
    'notifications:read',
    'documents:read',
    'documents:write',
  ],
  hr: HR_PERMISSIONS,
  hr_supervisor: [...HR_PERMISSIONS, 'holiday_access:write'],
  operations: [
    'ops_checkins:read',
    'ops_checkins:write',
    'units:read',
    'reservations:read',
    'reservations:write',
    'schedule:read',
    'notifications:read',
    'profile:read',
  ],
  operations_supervisor: [
    'ops_checkins:read',
    'ops_checkins:write',
    'ops_checkins:assign',
    'ops_comments:read',
    'ops_comments:write',
    'units:read',
    'reservations:read',
    'reservations:write',
    'schedule:read',
    'notifications:read',
    'profile:read',
  ],
  housekeeping: [
    'hk_today:read',
    'hk_today:write',
    'housekeeping:read',
    'housekeeping:write',
    'notifications:read',
    'profile:read',
  ],
  housekeeping_supervisor: [
    'hk_today:read',
    'hk_today:write',
    'hk_today:assign',
    'housekeeping:read',
    'housekeeping:write',
    'notifications:read',
    'profile:read',
  ],
  owner: [
    'owner:dashboard',
    'owner:reservations',
    'owner:statement',
    'owner:payouts',
  ],
  owners_relations: [
    'reservations:read',
    'reservations:or_checklist',
    'notifications:read',
    'profile:read',
  ],
  finance: [
    'financial_system:read',
    'financial_system:write',
    'notifications:read',
    'profile:read',
  ],
  finance_manager: [
    'financial_system:read',
    'financial_system:write',
    'finance_audit:read',
    'notifications:read',
    'profile:read',
  ],
  marketing_pr: ['tasks:read', 'notifications:read', 'profile:read'],
  web_developer: ['tasks:read', 'notifications:read', 'profile:read'],
};


const PAGE_ACCESS = {
  admin: true,
  reservations: RESERVATIONS_WEB_PAGE_ACCESS,
  reservations_web: RESERVATIONS_WEB_PAGE_ACCESS,
  reservations_manual: RESERVATIONS_MANUAL_PAGE_ACCESS,
  reservations_manager: RESERVATIONS_MANAGER_PAGE_ACCESS,
  unit_acquisition_agent: new Set(['units', 'acquisition', 'owners', 'profile']),
  unit_acquisition_manager: new Set(['units', 'acquisition', 'acquisition_audit', 'owners', 'profile']),
  operations: new Set(['operations', 'ops_checkins', 'reservations', 'schedule', 'profile']),
  operations_supervisor: new Set(['operations', 'ops_checkins', 'ops_comments', 'reservations', 'schedule', 'profile']),
  housekeeping: new Set(['housekeeping', 'hk_today', 'profile']),
  housekeeping_supervisor: new Set(['housekeeping', 'hk_today', 'profile']),
  resale: RESALE_PAGE_ACCESS,
  resale_manager: RESALE_MANAGER_PAGE_ACCESS,
  hr: HR_PAGE_ACCESS,
  hr_supervisor: HR_SUPERVISOR_PAGE_ACCESS,
  owners_relations: new Set(['reservations', 'profile', 'holiday_requests', 'loans', 'payslip']),
  finance: FINANCE_PAGE_ACCESS,
  finance_manager: FINANCE_MANAGER_PAGE_ACCESS,
  marketing_pr: new Set(['tasks', 'profile']),
  web_developer: new Set(['tasks', 'profile']),
  owner: new Set([
    'owner',
    'owner_reservations',
    'owner_statement',
    'owner_payouts',
    'owner_blocks',
    'profile',
  ]),
};

export function isReservationsTeam(user) {
  return !!user && RESERVATIONS_TEAM.has(user.role);
}

export function isWebsiteReservationsRole(user) {
  return !!user && (user.role === 'reservations_web' || user.role === 'reservations');
}

export function isManualReservationsRole(user) {
  return !!user && (user.role === 'reservations_manual' || user.role === 'reservations');
}

export function isReservationsManager(user) {
  return !!user && user.role === 'reservations_manager';
}

export function isFinanceAgent(user) {
  return !!user && user.role === 'finance';
}

export function isFinanceManager(user) {
  return !!user && user.role === 'finance_manager';
}

export function isFinanceStaff(user) {
  return isFinanceAgent(user) || isFinanceManager(user);
}

export function financeUsersForActor(users, actor) {
  if (!actor || actor.role === 'admin' || !isFinanceManager(actor)) return users || [];
  return (users || []).filter(
    (u) => String(u.id) === String(actor.id) || String(u.manager_id) === String(actor.id)
  );
}

export function isResaleAgent(user) {
  return !!user && user.role === 'resale';
}

export function isResaleManager(user) {
  return !!user && user.role === 'resale_manager';
}

export function isResaleStaff(user) {
  return isResaleAgent(user) || isResaleManager(user);
}

export function resaleUsersForActor(users, actor) {
  if (!actor || actor.role === 'admin' || !isResaleManager(actor)) return users || [];
  return (users || []).filter(
    (u) => String(u.id) === String(actor.id) || String(u.manager_id) === String(actor.id)
  );
}

export function isUnitAcquisitionRole(user) {
  return (
    !!user &&
    (user.role === 'unit_acquisition_agent' || user.role === 'unit_acquisition_manager')
  );
}

export function isUnitAcquisitionManager(user) {
  return !!user && user.role === 'unit_acquisition_manager';
}

export function isUnitAcquisitionAgent(user) {
  return !!user && user.role === 'unit_acquisition_agent';
}

export function salesUsersForActor(users, actor) {
  if (!actor || actor.role === 'admin' || !isReservationsManager(actor)) return users || [];
  return (users || []).filter(
    (u) => String(u.id) === String(actor.id) || String(u.manager_id) === String(actor.id)
  );
}

export function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return (PERMISSIONS[user.role] || []).includes(permission);
}

export function isTaskAssigneeRole(user) {
  return !!user && (user.role === 'marketing_pr' || user.role === 'web_developer');
}

export function canAssignStaffTasks(user) {
  return !!user && (user.role === 'admin' || isLineManagerRole(user.role));
}

export function canAccess(user, page) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (page === 'profile' || page === 'change-password') return true;
  if (page === 'tasks' && (isTaskAssigneeRole(user) || isLineManagerRole(user.role))) {
    return true;
  }
  if (
    (page === 'loans' || page === 'payslip' || page === 'holiday_requests') &&
    user.role !== 'owner' &&
    user.role !== 'finance' &&
    user.role !== 'finance_manager'
  ) {
    return true;
  }
  if (
    page === 'wfh' &&
    user.role !== 'owner' &&
    user.role !== 'admin' &&
    user.role !== 'finance' &&
    user.role !== 'finance_manager' &&
    user.role !== 'operations' &&
    user.role !== 'operations_supervisor'
  ) {
    return true;
  }
  const allowed = PAGE_ACCESS[user.role];
  if (allowed === true) return true;
  if (allowed instanceof Set) return allowed.has(page);
  return false;
}

export function canManageUnits(user) {
  return (
    !!user &&
    (user.role === 'admin' ||
      isResaleStaff(user) ||
      user.role === 'reservations_web' ||
      user.role === 'reservations' ||
      isUnitAcquisitionRole(user))
  );
}

export function canDeleteUnits(user) {
  return !!user && (user.role === 'admin' || isResaleStaff(user));
}

function isOperationsRole(user) {
  return !!user && (user.role === 'operations' || user.role === 'operations_supervisor');
}


export function canManageReservations(user) {
  return (
    !!user &&
    (user.role === 'admin' ||
      isManualReservationsRole(user) ||
      isWebsiteReservationsRole(user) ||
      isReservationsManager(user) ||
      isOperationsRole(user))
  );
}


export function canHandleWebsiteBookings(user) {
  return !!user && (user.role === 'admin' || isWebsiteReservationsRole(user));
}

export function canViewAllReservations(user) {
  return !!user && (user.role === 'admin' || user.role === 'owners_relations');
}

export function canEditOrChecklist(user) {
  return !!user && (user.role === 'admin' || user.role === 'owners_relations');
}

export function isOwnersRelationsRole(user) {
  return !!user && user.role === 'owners_relations';
}


export function canViewOwnCommissions(user) {
  return !!user && (user.role === 'admin' || isReservationsTeam(user) || isResaleStaff(user));
}

export function isResaleRole(user) {
  return isResaleStaff(user);
}

export function isFinanceRole(user) {
  return isFinanceAgent(user);
}

export function canEditSchedulePricing(user) {
  return !!user && user.role === 'admin';
}

export function canAccessFinance(user) {
  return !!user && user.role === 'admin';
}


export function canAccessFinancialSystem(user) {
  return !!user && (user.role === 'admin' || isFinanceStaff(user));
}

export function canAccessReports(user) {
  return !!user && user.role === 'admin';
}

export function canManageUsers(user) {
  return !!user && (user.role === 'admin' || isHrTeamRole(user.role));
}

export function canManageOwners(user) {
  return !!user && (user.role === 'admin' || isUnitAcquisitionRole(user));
}

export function isHrTeamRole(role) {
  return role === 'hr' || role === 'hr_supervisor';
}

export function canSeeRequestQueue(user) {
  return (
    !!user &&
    (user.role === 'admin' ||
      isHrTeamRole(user.role) ||
      user.role === 'operations_supervisor' ||
      user.role === 'housekeeping_supervisor' ||
      user.role === 'reservations_manager' ||
      user.role === 'unit_acquisition_manager' ||
      user.role === 'resale_manager' ||
      user.role === 'finance_manager')
  );
}

export function canRequestStaffBenefits(user) {
  return !!user && user.role !== 'admin' && user.role !== 'owner';
}

export function canEditStaffCompensation(user, targetUserId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'hr_supervisor') {
    return targetUserId == null || String(user.id) !== String(targetUserId);
  }
  return false;
}

export function isOwnerRole(user) {
  return !!user && user.role === 'owner';
}

export const LINE_MANAGER_ROLES = [
  'admin',
  'hr_supervisor',
  'reservations_manager',
  'resale_manager',
  'finance_manager',
  'unit_acquisition_manager',
  'operations_supervisor',
];

export function isLineManagerRole(role) {
  return LINE_MANAGER_ROLES.includes(String(role || ''));
}

export function hasOfficeAttendance(role) {
  const r = String(role || '');
  if (['owner', 'operations', 'web_developer'].includes(r)) return false;
  if (isLineManagerRole(r)) return false;
  return true;
}

const RESERVATION_ROLES = ['reservations_web', 'reservations_manual', 'reservations_manager'];
const FIELD_ROLES = [
  'operations_supervisor',
  'operations',
  'housekeeping_supervisor',
  'housekeeping',
];

/** Roles CEO / HR Supervisor can assign in User Management */
export const HR_MANAGED_STAFF_ROLES = [
  ...RESERVATION_ROLES,
  ...FIELD_ROLES,
  'resale',
  'resale_manager',
  'unit_acquisition_agent',
  'unit_acquisition_manager',
  'marketing_pr',
  'web_developer',
  'hr',
];

/** Staff list role filter (includes legacy / view-only roles) */
export const HR_STAFF_FILTER_ROLES = [
  ...HR_MANAGED_STAFF_ROLES,
  'reservations',
  'finance',
  'finance_manager',
  'hr_supervisor',
];

export function creatableRoles(actorRole) {
  if (actorRole === 'admin' || isHrTeamRole(actorRole)) return HR_MANAGED_STAFF_ROLES;
  if (actorRole === 'unit_acquisition_agent' || actorRole === 'unit_acquisition_manager') {
    return ['owner'];
  }
  return [];
}

export const ROLE_LABELS = {
  admin: 'CEO',
  reservations: 'Reservations (legacy)',
  reservations_web: 'Website Reservations',
  reservations_manual: 'Manual Reservations',
  reservations_manager: 'Reservations Manager',
  unit_acquisition_agent: 'Unit Acquisition Agent',
  unit_acquisition_manager: 'Unit Acquisition Manager',
  operations: 'Operations',
  operations_supervisor: 'Operations Supervisor',
  housekeeping: 'Housekeeping',
  housekeeping_supervisor: 'Housekeeping Supervisor',
  resale: 'Resale',
  resale_manager: 'Resale Manager',
  finance: 'Finance',
  finance_manager: 'Financial Manager',
  hr: 'HR',
  hr_supervisor: 'HR Supervisor',
  owners_relations: 'Owner Experience',
  marketing_pr: 'Marketing and PR',
  web_developer: 'Web Developer',
  owner: 'Owner',
};

export const ROLE_COLORS = {
  admin: 'badge-soul-accent',
  reservations: 'badge-soul-orange',
  reservations_web: 'badge-soul-orange',
  reservations_manual: 'badge-soul-orange',
  reservations_manager: 'badge-soul-orange',
  unit_acquisition_agent: 'badge-soul-teal',
  unit_acquisition_manager: 'badge-soul-teal',
  operations: 'badge-soul-teal',
  operations_supervisor: 'badge-soul-teal',
  housekeeping: 'badge-soul-slate',
  housekeeping_supervisor: 'badge-soul-slate',
  resale: 'badge-soul-teal',
  resale_manager: 'badge-soul-teal',
  finance: 'badge-soul-slate',
  finance_manager: 'badge-soul-slate',
  hr: 'badge-soul-slate',
  hr_supervisor: 'badge-soul-slate',
  owners_relations: 'badge-soul-teal',
  marketing_pr: 'badge-soul-orange',
  web_developer: 'badge-soul-slate',
  owner: 'badge-soul-teal',
};

export const PMS_LABELS = {
  admin: 'CEO PMS',
  reservations: 'Reservations PMS',
  reservations_web: 'Website Reservations PMS',
  reservations_manual: 'Manual Reservations PMS',
  reservations_manager: 'Reservations Manager PMS',
  unit_acquisition_agent: 'Unit Acquisition PMS',
  unit_acquisition_manager: 'Unit Acquisition Manager PMS',
  operations: 'Operations PMS',
  operations_supervisor: 'Operations Supervisor PMS',
  housekeeping: 'Housekeeping PMS',
  housekeeping_supervisor: 'Housekeeping Supervisor PMS',
  resale: 'Resale PMS',
  resale_manager: 'Resale Manager PMS',
  finance: 'Finance PMS',
  finance_manager: 'Finance Manager PMS',
  hr: 'HR PMS',
  hr_supervisor: 'HR Supervisor PMS',
  owners_relations: 'Owner Experience PMS',
  marketing_pr: 'Marketing and PR PMS',
  web_developer: 'Web Developer PMS',
  owner: 'Owner Portal',
};
