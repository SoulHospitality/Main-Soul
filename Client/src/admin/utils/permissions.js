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
  'housekeeping',
  'commissions',
  'profile',
]);


const RESERVATIONS_MANUAL_PAGE_ACCESS = new Set([
  'reservations',
  'schedule',
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
  hr: [
    'users:read',
    'users:write',
    'payroll:read',
    'payroll:write',
    'deductions:read',
    'deductions:write',
    'holiday_requests:read',
    'holiday_requests:write',
    'notifications:read',
    'documents:read',
    'documents:write',
  ],
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
  hr: new Set(['users', 'payroll', 'deductions', 'holiday_requests', 'profile']),
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

export function canManageUsers(user) {
  return !!user && (user.role === 'admin' || user.role === 'hr');
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
  if (actorRole === 'admin') {
    return ['admin', ...reservationRoles, ...fieldRoles, 'resale', 'hr', 'owner'];
  }
  if (actorRole === 'hr') return [...reservationRoles, ...fieldRoles, 'resale', 'hr'];
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
  owner: 'Owner Portal',
};
