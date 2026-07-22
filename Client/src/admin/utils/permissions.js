export const ROLES = {
  ADMIN: 'admin',
  RESERVATIONS: 'reservations',
  RESALE: 'resale',
  HR: 'hr',
  OWNER: 'owner',
};

const PERMISSIONS = {
  admin: ['*'],
  reservations: [
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
  ],
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

/** Three separate PMS surfaces + full admin + owner portal */
const PAGE_ACCESS = {
  admin: true,
  reservations: new Set(['dashboard', 'reservations', 'schedule', 'housekeeping', 'maintenance', 'profile']),
  resale: new Set(['units_sale', 'acquisition', 'sales', 'profile']),
  hr: new Set(['users', 'profile']),
  owner: new Set(['owner', 'owner_reservations', 'owner_statement', 'owner_payouts', 'owner_blocks', 'profile']),
};

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

export function canManageReservations(user) {
  return !!user && user.role === 'reservations';
}

export function canViewAllReservations(user) {
  return !!user && (user.role === 'admin' || user.role === 'reservations');
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
  if (actorRole === 'admin') return ['admin', 'reservations', 'resale', 'hr', 'owner'];
  if (actorRole === 'hr') return ['reservations', 'resale', 'hr'];
  return [];
}

export const ROLE_LABELS = {
  admin: 'Admin',
  reservations: 'Reservations',
  resale: 'Resale',
  hr: 'HR',
  owner: 'Owner',
};

export const ROLE_COLORS = {
  admin: 'badge-soul-accent',
  reservations: 'badge-soul-orange',
  resale: 'badge-soul-teal',
  hr: 'badge-soul-slate',
  owner: 'badge-soul-teal',
};

export const PMS_LABELS = {
  admin: 'Admin PMS',
  reservations: 'Reservations PMS',
  resale: 'Resale PMS',
  hr: 'HR PMS',
  owner: 'Owner Portal',
};
