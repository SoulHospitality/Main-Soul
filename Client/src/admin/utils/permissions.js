export const ROLES = {
  ADMIN: 'admin',
  RESERVATIONS: 'reservations',
  RESERVATIONS_WEB: 'reservations_web',
  RESERVATIONS_MANUAL: 'reservations_manual',
  OPERATIONS: 'operations',
  OPERATIONS_SUPERVISOR: 'operations_supervisor',
  HOUSEKEEPING: 'housekeeping',
  HOUSEKEEPING_SUPERVISOR: 'housekeeping_supervisor',
  RESALE: 'resale',
  HR: 'hr',
  HR_SUPERVISOR: 'hr_supervisor',
  OWNER: 'owner',
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

const PERMISSIONS = {
  admin: ['*'],
  reservations: RESERVATIONS_WEB_PERMISSIONS,
  reservations_web: RESERVATIONS_WEB_PERMISSIONS,
  reservations_manual: RESERVATIONS_MANUAL_PERMISSIONS,
  resale: [
    'units:read',
    'units:write',
    'units:delete',
    'acquisition:read',
    'acquisition:write',
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
};


const PAGE_ACCESS = {
  admin: true,
  reservations: RESERVATIONS_WEB_PAGE_ACCESS,
  reservations_web: RESERVATIONS_WEB_PAGE_ACCESS,
  reservations_manual: RESERVATIONS_MANUAL_PAGE_ACCESS,
  operations: new Set(['operations', 'ops_checkins', 'reservations', 'schedule', 'profile']),
  operations_supervisor: new Set(['operations', 'ops_checkins', 'ops_comments', 'reservations', 'schedule', 'profile']),
  housekeeping: new Set(['housekeeping', 'hk_today', 'profile']),
  housekeeping_supervisor: new Set(['housekeeping', 'hk_today', 'profile']),
  resale: new Set(['units_sale', 'acquisition', 'profile']),
  hr: HR_PAGE_ACCESS,
  hr_supervisor: HR_PAGE_ACCESS,
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

export function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return (PERMISSIONS[user.role] || []).includes(permission);
}

export function canAccess(user, page) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (page === 'profile' || page === 'change-password') return true;
  if ((page === 'loans' || page === 'payslip' || page === 'holiday_requests') && user.role !== 'owner') return true;
  if (
    page === 'wfh' &&
    user.role !== 'owner' &&
    user.role !== 'admin' &&
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
      user.role === 'resale' ||
      user.role === 'reservations_web' ||
      user.role === 'reservations')
  );
}

export function canDeleteUnits(user) {
  return !!user && (user.role === 'admin' || user.role === 'resale');
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
      isOperationsRole(user))
  );
}


export function canHandleWebsiteBookings(user) {
  return !!user && (user.role === 'admin' || isWebsiteReservationsRole(user));
}

export function canViewAllReservations(user) {
  return !!user && user.role === 'admin';
}


export function canViewOwnCommissions(user) {
  return !!user && (user.role === 'admin' || isReservationsTeam(user));
}

export function canEditSchedulePricing(user) {
  return !!user && user.role === 'admin';
}

export function canAccessFinance(user) {
  return !!user && user.role === 'admin';
}


export function canAccessFinancialSystem(user) {
  return !!user && user.role === 'admin';
}

export function canAccessReports(user) {
  return !!user && user.role === 'admin';
}

export function canManageUsers(user) {
  return !!user && (user.role === 'admin' || isHrTeamRole(user.role));
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
      user.role === 'housekeeping_supervisor')
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

export function creatableRoles(actorRole) {
  const reservationRoles = ['reservations_web', 'reservations_manual'];
  const fieldRoles = [
    'operations_supervisor',
    'operations',
    'housekeeping_supervisor',
    'housekeeping',
  ];
  const hrCreatable = [...reservationRoles, ...fieldRoles, 'resale', 'hr'];
  if (actorRole === 'admin') {
    return ['admin', ...reservationRoles, ...fieldRoles, 'resale', 'hr', 'hr_supervisor', 'owner'];
  }
  if (isHrTeamRole(actorRole)) return hrCreatable;
  return [];
}

export const ROLE_LABELS = {
  admin: 'Admin',
  reservations: 'Reservations (legacy)',
  reservations_web: 'Website Reservations',
  reservations_manual: 'Manual Reservations',
  operations: 'Operations',
  operations_supervisor: 'Operations Supervisor',
  housekeeping: 'Housekeeping',
  housekeeping_supervisor: 'Housekeeping Supervisor',
  resale: 'Resale',
  hr: 'HR',
  hr_supervisor: 'HR Supervisor',
  owner: 'Owner',
};

export const ROLE_COLORS = {
  admin: 'badge-soul-accent',
  reservations: 'badge-soul-orange',
  reservations_web: 'badge-soul-orange',
  reservations_manual: 'badge-soul-orange',
  operations: 'badge-soul-teal',
  operations_supervisor: 'badge-soul-teal',
  housekeeping: 'badge-soul-slate',
  housekeeping_supervisor: 'badge-soul-slate',
  resale: 'badge-soul-teal',
  hr: 'badge-soul-slate',
  hr_supervisor: 'badge-soul-slate',
  owner: 'badge-soul-teal',
};

export const PMS_LABELS = {
  admin: 'Admin PMS',
  reservations: 'Reservations PMS',
  reservations_web: 'Website Reservations PMS',
  reservations_manual: 'Manual Reservations PMS',
  operations: 'Operations PMS',
  operations_supervisor: 'Operations Supervisor PMS',
  housekeeping: 'Housekeeping PMS',
  housekeeping_supervisor: 'Housekeeping Supervisor PMS',
  resale: 'Resale PMS',
  hr: 'HR PMS',
  hr_supervisor: 'HR Supervisor PMS',
  owner: 'Owner Portal',
};
