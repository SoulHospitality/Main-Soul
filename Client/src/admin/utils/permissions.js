export const ROLES = {
  ADMIN: 'admin',
  RESERVATIONS: 'reservations',
  RESALE: 'resale',
  HR: 'hr',
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
    'notifications:read',
    'documents:read',
    'documents:write',
  ],
  resale: [
    'units:read',
    'units:write',
    'units:delete',
    'projects:read',
    'projects:write',
    'notifications:read',
    'documents:read',
    'documents:write',
  ],
  hr: [
    'users:read',
    'users:write',
    'hr:read',
    'hr:write',
    'recruitment:read',
    'recruitment:write',
    'notifications:read',
    'documents:read',
    'documents:write',
  ],
};

/** Three separate PMS surfaces + full admin */
const PAGE_ACCESS = {
  admin: true,
  reservations: new Set(['dashboard', 'reservations', 'schedule', 'profile']),
  resale: new Set(['units', 'projects', 'profile']),
  hr: new Set(['users', 'hr', 'recruitment', 'profile']),
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

export function creatableRoles(actorRole) {
  if (actorRole === 'admin') return ['admin', 'reservations', 'resale', 'hr'];
  if (actorRole === 'hr') return ['reservations', 'resale', 'hr'];
  return [];
}

export const ROLE_LABELS = {
  admin: 'Admin',
  reservations: 'Reservations',
  resale: 'Resale',
  hr: 'HR',
};

export const ROLE_COLORS = {
  admin: 'badge-soul-accent',
  reservations: 'badge-soul-orange',
  resale: 'badge-soul-teal',
  hr: 'badge-soul-slate',
};

export const PMS_LABELS = {
  admin: 'Admin PMS',
  reservations: 'Reservations PMS',
  resale: 'Resale PMS',
  hr: 'HR PMS',
};
