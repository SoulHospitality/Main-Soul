export const ROLES = {
  ADMIN: 'admin',
  RESERVATIONS: 'reservations',
  RESERVATIONS_WEB: 'reservations_web',
  RESERVATIONS_MANUAL: 'reservations_manual',
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

const PERMISSIONS = {
  admin: ['*'],
  reservations: RESERVATIONS_PERMISSIONS,
  reservations_web: RESERVATIONS_PERMISSIONS,
  reservations_manual: RESERVATIONS_PERMISSIONS,
  resale: [
    'units:read',
    'units:write',
    'units:delete',
    'acquisition:read',
    'acquisition:write',
    'sales:read',
    'notifications:read',
    'documents:read',
    'documents:write',
  ],
  hr: [
    'users:read',
    'users:write',
    'notifications:read',
    'documents:read',
    'documents:write',
  ],
  owner: [
    'owner:dashboard',
    'owner:reservations',
    'owner:statement',
    'owner:payouts',
  ],
};

/** Separate PMS surfaces + full admin + owner portal */
const PAGE_ACCESS = {
  admin: true,
  reservations: RESERVATIONS_PAGE_ACCESS,
  reservations_web: RESERVATIONS_PAGE_ACCESS,
  reservations_manual: RESERVATIONS_PAGE_ACCESS,
  resale: new Set(['units_sale', 'acquisition', 'sales', 'profile']),
  hr: new Set(['users', 'profile']),
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
  return !!user && (user.role === 'admin' || user.role === 'resale');
}

export function canDeleteUnits(user) {
  return canManageUnits(user);
}

/** Create / edit manual reservations */
export function canManageReservations(user) {
  return !!user && (user.role === 'admin' || isManualReservationsRole(user));
}

/** Accept / reject website booking requests */
export function canHandleWebsiteBookings(user) {
  return !!user && (user.role === 'admin' || isWebsiteReservationsRole(user));
}

export function canViewAllReservations(user) {
  return !!user && (user.role === 'admin' || isReservationsTeam(user));
}

export function canEditSchedulePricing(user) {
  return !!user && user.role === 'admin';
}

export function canAccessFinance(user) {
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
  if (actorRole === 'admin') return ['admin', ...reservationRoles, 'resale', 'hr', 'owner'];
  if (actorRole === 'hr') return [...reservationRoles, 'resale', 'hr'];
  return [];
}

export const ROLE_LABELS = {
  admin: 'Admin',
  reservations: 'Reservations (legacy)',
  reservations_web: 'Website Reservations',
  reservations_manual: 'Manual Reservations',
  resale: 'Resale',
  hr: 'HR',
  owner: 'Owner',
};

export const ROLE_COLORS = {
  admin: 'badge-soul-accent',
  reservations: 'badge-soul-orange',
  reservations_web: 'badge-soul-orange',
  reservations_manual: 'badge-soul-orange',
  resale: 'badge-soul-teal',
  hr: 'badge-soul-slate',
  owner: 'badge-soul-teal',
};

export const PMS_LABELS = {
  admin: 'Admin PMS',
  reservations: 'Reservations PMS',
  reservations_web: 'Website Reservations PMS',
  reservations_manual: 'Manual Reservations PMS',
  resale: 'Resale PMS',
  hr: 'HR PMS',
  owner: 'Owner Portal',
};
